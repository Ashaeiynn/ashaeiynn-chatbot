// "Teach the bot" — the admin portal hands us videos, audios, links, documents
// or pasted text; each becomes a transcript JSON via the existing pipeline, then
// the knowledge base is rebuilt once per batch and hot-reloaded into the server.
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { reload } from "./retrieve.mjs";

const HOME = process.env.HOME;
// ffmpeg lives in ~/.local/bin, mlx_whisper in the Python user bin — neither is
// on the login PATH of this Mac (no shell-profile edits allowed).
const ENV = {
  ...process.env,
  PATH: `${HOME}/.local/bin:${HOME}/Library/Python/3.9/bin:${process.env.PATH}`,
};

export const uploadsDir = path.join(ROOT, "data", "uploads");
const transcriptsDir = path.join(ROOT, "data", "transcripts");
mkdirSync(uploadsDir, { recursive: true });

export const MEDIA_RE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|amr|3gp|mp4|mov|mkv|webm|avi|mts)$/i;
export const DOC_RE = /\.(pdf|docx|doc|rtf|txt|md|html?)$/i;

// ——— job queue (in-memory; files themselves persist on disk) ———
export const jobs = [];
let seq = 1;
let pumping = false;

export function publicJobs() {
  return jobs
    .map(({ run, ...j }) => j)
    .sort((a, b) => b.id - a.id)
    .slice(0, 100);
}

function addJob(kind, title, run) {
  const job = { id: seq++, kind, title, status: "queued", detail: "", at: new Date().toISOString(), run };
  jobs.push(job);
  setImmediate(pump);
  return { id: job.id, kind: job.kind, title: job.title, status: job.status };
}

// Convert every queued item, then ONE knowledge-base rebuild for the whole batch
// (the rebuild re-embeds everything, so batching keeps multi-file uploads fast).
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    let converted = false;
    for (;;) {
      const job = jobs.find((j) => j.status === "queued");
      if (!job) break;
      job.status = "working";
      try {
        await job.run(job);
        job.status = "ready";
        converted = true;
      } catch (err) {
        job.status = "failed";
        job.detail = String(err?.message || err).slice(0, 300);
        console.error("teach failed:", job.title, "-", job.detail);
      }
    }
    if (converted) {
      const batch = jobs.filter((j) => j.status === "ready");
      batch.forEach((j) => {
        j.status = "studying";
        j.detail = "पढ़ाई चल रही है — building searchable memory…";
      });
      try {
        await runProcess(process.execPath, [path.join(ROOT, "pipeline", "3-ingest.mjs")]);
        reload();
        batch.forEach((j) => {
          j.status = "done";
          j.detail = "";
        });
        console.log(`teach: knowledge refreshed (+${batch.length} source${batch.length > 1 ? "s" : ""})`);
      } catch (err) {
        batch.forEach((j) => {
          j.status = "failed";
          j.detail = "study step failed: " + String(err?.message || err).slice(0, 200);
        });
      }
    }
  } finally {
    pumping = false;
    if (jobs.some((j) => j.status === "queued")) setImmediate(pump);
  }
}

function runProcess(cmd, args, job, detail) {
  if (job && detail) job.detail = detail;
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: ENV, cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim().slice(-300) || `${path.basename(cmd)} exited ${code}`)),
    );
  });
}

function captureProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: ENV, cwd: ROOT });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().slice(-300) || `exit ${code}`))));
  });
}

// ——— saving text-based knowledge in the transcript format the ingester expects ———
function slugify(s, prefix) {
  const base = s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return `${prefix}${base || "untitled"}-${Date.now().toString(36)}`;
}

function saveTextTranscript(title, text, url, prefix) {
  const clean = String(text).replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (clean.replace(/\s/g, "").length < 40) throw new Error("No readable text found in this source.");
  const paras = clean
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 1);
  const slug = slugify(title, prefix);
  writeFileSync(
    path.join(transcriptsDir, `${slug}.json`),
    JSON.stringify(
      { title, url: url || "", videoId: slug, language: "hi", minutes: 0, segments: paras.map((p) => ({ start: 0, end: 0, text: p })) },
      null,
      2,
    ),
  );
}

async function extractDocText(filePath) {
  if (/\.pdf$/i.test(filePath)) {
    return captureProcess("python3", [
      "-c",
      "import sys\nfrom pypdf import PdfReader\nr = PdfReader(sys.argv[1])\nprint('\\n\\n'.join((p.extract_text() or '') for p in r.pages))",
      filePath,
    ]);
  }
  if (/\.(txt|md)$/i.test(filePath)) return readFileSync(filePath, "utf8");
  // docx / doc / rtf / html → macOS textutil
  const out = filePath + ".extracted.txt";
  await runProcess("/usr/bin/textutil", ["-convert", "txt", "-output", out, filePath]);
  const text = readFileSync(out, "utf8");
  rmSync(out, { force: true });
  return text;
}

function htmlToText(html) {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ");
  const main = /<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  if (main && main[2].replace(/<[^>]+>/g, "").trim().length > 300) s = main[2];
  return s
    .replace(/<(p|div|br|li|h[1-6]|tr)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/[ \t]+/g, " ");
}

// ——— the three ways to teach ———
export function teachFile(filePath, title) {
  const name = path.basename(filePath);
  const t = (title || name.replace(/\.[^.]+$/, "").replace(/^[a-z0-9]+-/, "")).trim();
  if (MEDIA_RE.test(name)) {
    return addJob("media", t, (job) =>
      runProcess(
        process.execPath,
        [path.join(ROOT, "pipeline", "6-audio.mjs"), filePath, t],
        job,
        "सुन रहे हैं — transcribing (long recordings take a while)…",
      ),
    );
  }
  if (DOC_RE.test(name)) {
    return addJob("document", t, async (job) => {
      job.detail = "reading the document…";
      saveTextTranscript(t, await extractDocText(filePath), "", "doc_");
    });
  }
  throw new Error("Unsupported file type: " + name);
}

export function teachLink(url, title) {
  const u = new URL(url); // throws on invalid
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links are supported.");
  if (/(^|\.)((youtube|vimeo)\.com|youtu\.be)$/i.test(u.hostname)) {
    return addJob("video-link", (title || url).trim(), async (job) => {
      const base = path.join(uploadsDir, "link-" + Date.now().toString(36));
      await runProcess(
        `${HOME}/.local/bin/yt-dlp`,
        ["-f", "ba/b", "--socket-timeout", "30", "--retries", "3", "--no-part", "-o", `${base}.%(ext)s`, url],
        job,
        "downloading from the link…",
      );
      const dl = readdirSync(uploadsDir).find((f) => f.startsWith(path.basename(base)));
      if (!dl) throw new Error("Download produced no file.");
      let t = (title || "").trim();
      if (!t) {
        try {
          t = (await captureProcess(`${HOME}/.local/bin/yt-dlp`, ["--get-title", "--socket-timeout", "20", url])).trim().split("\n")[0];
        } catch { /* fall back to filename */ }
      }
      job.title = t || job.title;
      await runProcess(
        process.execPath,
        [path.join(ROOT, "pipeline", "6-audio.mjs"), path.join(uploadsDir, dl), t || "New recording"],
        job,
        "सुन रहे हैं — transcribing (long recordings take a while)…",
      );
    });
  }
  return addJob("article", (title || url).trim(), async (job) => {
    job.detail = "reading the page…";
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AshaeiynnBot)" } });
    if (!r.ok) throw new Error(`The page returned ${r.status}.`);
    const html = await r.text();
    const pageTitle = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim();
    const t = (title || pageTitle || u.hostname).trim();
    job.title = t;
    saveTextTranscript("Article: " + t.replace(/^Article:\s*/i, ""), htmlToText(html), url, "web_");
  });
}

export function teachText(title, content) {
  const t = (title || "").trim();
  if (!t) throw new Error("Please give this teaching a title.");
  return addJob("note", t, async () => saveTextTranscript(t, content, "", "note_"));
}

// Remove one source from the knowledge (the transcript file is deleted, then the
// batch rebuild forgets it). Git history still holds the file if ever regretted.
export function forget(file, title) {
  return addJob("forget", title, async () => {
    rmSync(path.join(transcriptsDir, file), { force: true });
  });
}
