// "Teach the bot" — the admin portal hands us videos, audios, links, documents
// or pasted text; each becomes a transcript JSON via the existing pipeline, then
// the knowledge base is rebuilt once per batch and hot-reloaded into the server.
// The queue is PERSISTED (data/teach-queue.json): a server restart or Mac reboot
// resumes unfinished studying instead of silently dropping it.
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
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
const queueFile = path.join(ROOT, "data", "teach-queue.json");
mkdirSync(uploadsDir, { recursive: true });

export const MEDIA_RE = /\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|amr|3gp|mp4|mov|mkv|webm|avi|mts)$/i;
export const DOC_RE = /\.(pdf|docx|doc|rtf|txt|md|html?)$/i;

// ——— job queue (persisted; jobs are plain data + a runner per kind) ———
export const jobs = [];
let seq = 1;
let pumping = false;

// Has a recording with this original file name already been studied? (Compares
// the name minus the per-upload id prefix against existing transcript slugs.)
function alreadyStudied(filePath) {
  const base = path.basename(filePath).replace(/^[a-z0-9]+-/, "");
  const core = base.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return readdirSync(transcriptsDir).some((f) => {
    if (!f.startsWith("audio_") || !f.endsWith(".json")) return false;
    return f.slice(6, -5).replace(/^[a-z0-9]{8}-/, "") === core;
  });
}

const RUNNERS = {
  media: async (job) => {
    if (alreadyStudied(job.spec.path)) {
      job.detail = "same recording already studied earlier — skipped";
      return;
    }
    // Live progress: we know the recording's length and transcription runs at
    // roughly 5× realtime on this Mac, so elapsed time gives an honest live %.
    let estMs = null;
    try {
      const out = await captureProcess(`${HOME}/.local/bin/ffprobe`, [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", job.spec.path,
      ]);
      const durSec = parseFloat(out.trim());
      if (durSec > 0) estMs = (durSec / 5 + 45) * 1000;
    } catch { /* no estimate — show elapsed time instead */ }
    const started = Date.now();
    const tick = setInterval(() => {
      const el = Date.now() - started;
      const mins = Math.max(1, Math.round(el / 60000));
      job.detail = estMs
        ? `सुन रहे हैं — transcribing… ~${Math.min(95, Math.round((el / estMs) * 100))}% (${mins} min of ~${Math.max(1, Math.round(estMs / 60000))} min)`
        : `सुन रहे हैं — transcribing… ${mins} min elapsed`;
    }, 10000);
    try {
      await runProcess(
        process.execPath,
        [path.join(ROOT, "pipeline", "6-audio.mjs"), job.spec.path, job.title],
        job,
        "सुन रहे हैं — transcribing…",
      );
    } finally {
      clearInterval(tick);
    }
  },
  document: async (job) => {
    job.detail = "reading the document…";
    saveTextTranscript(job.title, await extractDocText(job.spec.path), "", "doc_");
  },
  note: async (job) => saveTextTranscript(job.title, job.spec.content, "", "note_"),
  forget: async (job) => rmSync(path.join(transcriptsDir, path.basename(job.spec.file)), { force: true }),
  article: async (job) => {
    job.detail = "reading the page…";
    const r = await fetch(job.spec.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AshaeiynnBot)" } });
    if (!r.ok) throw new Error(`The page returned ${r.status}.`);
    const html = await r.text();
    const pageTitle = /<title[^>]*>([^<]*)/i.exec(html)?.[1]?.trim();
    const t = (job.title || pageTitle || new URL(job.spec.url).hostname).trim();
    job.title = t;
    saveTextTranscript("Article: " + t.replace(/^Article:\s*/i, ""), htmlToText(html), job.spec.url, "web_");
  },
  "video-link": async (job) => {
    const base = path.join(uploadsDir, "link-" + Date.now().toString(36));
    await runProcess(
      `${HOME}/.local/bin/yt-dlp`,
      ["-f", "ba/b", "--socket-timeout", "30", "--retries", "3", "--no-part", "-o", `${base}.%(ext)s`, job.spec.url],
      job,
      "downloading from the link…",
    );
    const dl = readdirSync(uploadsDir).find((f) => f.startsWith(path.basename(base)));
    if (!dl) throw new Error("Download produced no file.");
    let t = (job.title || "").trim();
    if (!t || t === job.spec.url) {
      try {
        t = (await captureProcess(`${HOME}/.local/bin/yt-dlp`, ["--get-title", "--socket-timeout", "20", job.spec.url]))
          .trim().split("\n")[0];
      } catch { /* fall back */ }
    }
    job.title = t || "New recording";
    await runProcess(
      process.execPath,
      [path.join(ROOT, "pipeline", "6-audio.mjs"), path.join(uploadsDir, dl), job.title],
      job,
      "सुन रहे हैं — transcribing (long recordings take a while)…",
    );
  },
};

function persistQueue() {
  try {
    const pending = jobs
      .filter((j) => ["queued", "working", "ready", "studying"].includes(j.status))
      .map(({ id, kind, title, spec, at }) => ({ id, kind, title, spec, at }));
    writeFileSync(queueFile, JSON.stringify(pending, null, 2));
  } catch (err) {
    console.error("teach queue persist failed:", err?.message);
  }
}

// Active work first (what's happening now, then what's next in line), then the
// history — so the working file is always visible even with a huge queue.
export function publicJobs() {
  const order = { working: 0, studying: 1, ready: 2, queued: 3, failed: 4, done: 5 };
  return jobs
    .map(({ spec, ...j }) => j)
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.id - b.id)
    .slice(0, 250);
}

export function jobTotals() {
  const t = { total: jobs.length };
  for (const j of jobs) t[j.status] = (t[j.status] || 0) + 1;
  return t;
}

function addJob(kind, title, spec) {
  const job = { id: seq++, kind, title, status: "queued", detail: "", at: new Date().toISOString(), spec };
  jobs.push(job);
  persistQueue();
  setImmediate(pump);
  return { id: job.id, kind: job.kind, title: job.title, status: job.status };
}

// Convert every queued item, then ONE knowledge-base rebuild for the whole batch
// (the rebuild re-embeds everything, so batching keeps multi-file uploads fast).
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    let converted = 0;
    // Absorb knowledge every 25 conversions rather than only at the very end —
    // huge queues then feed the live bot steadily instead of days later.
    while (converted < 25) {
      const job = jobs.find((j) => j.status === "queued");
      if (!job) break;
      job.status = "working";
      try {
        await RUNNERS[job.kind](job);
        job.status = "ready";
        converted++;
      } catch (err) {
        job.status = "failed";
        job.detail = String(err?.message || err).slice(0, 300);
        console.error("teach failed:", job.title, "-", job.detail);
      }
      persistQueue();
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
        await autoPushKnowledge(batch.length);
      } catch (err) {
        batch.forEach((j) => {
          j.status = "failed";
          j.detail = "study step failed: " + String(err?.message || err).slice(0, 200);
        });
      }
      persistQueue();
    }
  } finally {
    pumping = false;
    if (jobs.some((j) => j.status === "queued")) setImmediate(pump);
  }
}

// Resume anything that was still pending when the server last stopped.
try {
  if (existsSync(queueFile)) {
    const pending = JSON.parse(readFileSync(queueFile, "utf8"));
    for (const p of pending) {
      jobs.push({ ...p, id: seq++, status: "queued", detail: "resumed after restart" });
    }
    if (pending.length) {
      console.log(`teach: resumed ${pending.length} unfinished job(s) from the last run`);
      setImmediate(pump);
    }
  }
} catch (err) {
  console.error("teach queue resume failed:", err?.message);
}

// The studio Mac reports its study progress to the live cloud portal every 30s,
// so the admin can watch the bot studying from anywhere. (Bonus: the steady
// heartbeat keeps the free cloud instance awake — no cold starts.)
const SYNC_URL = (process.env.STUDIO_SYNC_URL || "").replace(/\/+$/, "");
if (SYNC_URL) {
  setInterval(async () => {
    try {
      await fetch(`${SYNC_URL}/api/admin/studio-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": process.env.ADMIN_KEY || "" },
        body: JSON.stringify({ jobs: publicJobs().slice(0, 150), totals: jobTotals() }),
      });
    } catch {
      /* cloud unreachable — try again next tick */
    }
  }, 30_000).unref();
}

// After every successful study batch, send the new knowledge to GitHub — the
// live cloud bot redeploys itself with it automatically. Best-effort: on the
// deployed server there is no git repo, so this quietly does nothing there.
async function autoPushKnowledge(count) {
  try {
    await runProcess("/usr/bin/git", ["add", "data/transcripts", "data/knowledge.db", "data/corrections.json"]);
    await runProcess("/usr/bin/git", [
      "commit",
      "-m",
      `Knowledge update: ${count} new source${count > 1 ? "s" : ""} taught via the admin portal\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`,
    ]);
    await runProcess("/usr/bin/git", ["push"]);
    console.log("teach: knowledge pushed — the live bot will update itself in ~10 min");
  } catch (err) {
    console.error("teach: auto-push skipped —", String(err?.message || err).slice(0, 150));
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
  if (/\.html?$/i.test(filePath)) return htmlToText(readFileSync(filePath, "utf8"));
  if (/\.docx$/i.test(filePath)) {
    // .docx is a zip of XML — extract text with python3, works on Mac AND the
    // Linux VPS alike (textutil, used below, exists only on macOS).
    return captureProcess("python3", [
      "-c",
      'import sys, zipfile, re, html\nxml = zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8", "ignore")\nxml = re.sub(r"<w:tab[^>]*/>", "\\t", xml)\nxml = re.sub(r"</w:p>", "\\n\\n", xml)\nprint(html.unescape(re.sub(r"<[^>]+>", "", xml)))',
      filePath,
    ]);
  }
  // legacy .doc / .rtf → macOS textutil only; elsewhere fail with a clear message
  if (!existsSync("/usr/bin/textutil"))
    throw new Error("Old Word (.doc) and RTF files need the studio Mac's portal — or save the file as PDF/.docx and upload it again.");
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

// ——— the ways to teach ———
export function teachFile(filePath, title) {
  const name = path.basename(filePath);
  const t = (title || name.replace(/\.[^.]+$/, "").replace(/^[a-z0-9]+-/, "")).trim();
  // Recordings are no longer taught through the portal (owner's decision,
  // 2026-07-18): machine transcription proved unreliable enough to damage the
  // knowledge, so Bhaiya's recordings come in as human-checked transcripts.
  // The pipeline itself still exists for command-line use: pipeline/6-audio.mjs
  if (MEDIA_RE.test(name))
    throw new Error("Recordings aren't studied here — please upload the typed transcript (txt, Word or PDF) so the teaching is exact.");
  if (DOC_RE.test(name)) return addJob("document", t, { path: filePath });
  throw new Error("Unsupported file type: " + name);
}

export function teachLink(url, title) {
  const u = new URL(url); // throws on invalid
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) links are supported.");
  if (/(^|\.)((youtube|vimeo)\.com|youtu\.be)$/i.test(u.hostname))
    throw new Error("Video links aren't studied here — please add the typed transcript instead, so the teaching is exact.");
  return addJob("article", (title || url).trim(), { url });
}

export function teachText(title, content) {
  const t = (title || "").trim();
  if (!t) throw new Error("Please give this teaching a title.");
  return addJob("note", t, { content: String(content) });
}

// Remove one source from the knowledge (the transcript file is deleted, then the
// batch rebuild forgets it). Git history still holds the file if ever regretted.
export function forget(file, title) {
  return addJob("forget", title, { file });
}
