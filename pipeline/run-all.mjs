// End-to-end processor for the Vimeo review-folder videos.
// For each video: download audio (public embed) → extract 16k mono wav → transcribe (Hindi, large-v3).
// Fully resumable: skips any video whose transcript already exists. Safe to re-run / restart.
// Usage: node pipeline/run-all.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(root, "data", "audio");
const transcriptsDir = path.join(root, "data", "transcripts");
const logFile = path.join(root, "data", "run-all.log");
mkdirSync(audioDir, { recursive: true });
mkdirSync(transcriptsDir, { recursive: true });

const HOME = process.env.HOME;
const YTDLP = `${HOME}/.local/bin/yt-dlp`;
const FFMPEG = `${HOME}/.local/bin/ffmpeg`;
const MLX_WHISPER = `${HOME}/Library/Python/3.9/bin/mlx_whisper`;
// large-v3-turbo: ~5x realtime on M1 with Hindi quality matching full large-v3.
const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";
const LANGUAGE = "hi"; // content is spoken in Hindi
const REFERER = "https://vimeo.com/";

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(logFile, line + "\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry a step a few times with backoff — download/extract can fail transiently
// (network blips, CDN fragment errors under load). Only give up after all tries.
async function withRetry(label, fn, attempts = 3) {
  for (let a = 1; a <= attempts; a++) {
    try {
      fn();
      return true;
    } catch (err) {
      if (a === attempts) throw err;
      const waitMs = a * 8000;
      log(`   ↻ ${label} failed (attempt ${a}/${attempts}) — retrying in ${waitMs / 1000}s`);
      await sleep(waitMs);
    }
  }
}

// Unified inventory: Vimeo (embeddable) + YouTube. Each entry has { platform, dlUrl, ... }.
const videos = JSON.parse(readFileSync(path.join(root, "data", "inventory.json"), "utf8"));
log(`Starting run: ${videos.length} videos, ~${Math.round(videos.reduce((a, v) => a + v.minutes, 0) / 60)} hours total.`);

let done = 0;
let failed = 0;
for (const [i, v] of videos.entries()) {
  const id = v.videoId;
  const slug = `${id}`;
  const transcriptFile = path.join(transcriptsDir, `${slug}.json`);
  const rawFile = path.join(audioDir, `${slug}.json`); // whisper writes here (named after the wav); transient
  const wavFile = path.join(audioDir, `${slug}.wav`);
  const dlFile = path.join(audioDir, `${slug}.audio.mp4`);
  const progress = `(${i + 1}/${videos.length})`;

  if (existsSync(transcriptFile)) {
    log(`${progress} ✓ skip (already transcribed): ${v.name}`);
    done++;
    continue;
  }

  try {
    // 1. Download audio via the public embed player (fresh signed URL each run).
    if (!existsSync(wavFile)) {
      log(`${progress} ↓ downloading: ${v.name} (${v.minutes}m)`);
      // Hard wall-clock cap so a hung CDN fragment can't freeze the whole run.
      const dlTimeout = Math.max(8 * 60_000, v.minutes * 15_000);
      await withRetry(`download ${id}`, () => {
        execFileSync("rm", ["-f", dlFile, `${dlFile}.part`]); // clear any partial before retry
        const args = [
          "-f", "bestaudio/best", "--no-playlist",
          "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "8",
          "--retry-sleep", "5", "--no-part", "--no-progress",
        ];
        if (v.platform === "vimeo") args.push("--referer", REFERER); // Vimeo embed needs a referer; YouTube doesn't
        args.push("-o", dlFile, v.dlUrl);
        execFileSync(YTDLP, args, { stdio: "ignore", timeout: dlTimeout, killSignal: "SIGKILL" });
      });
      // 2. Extract clean 16kHz mono wav for Whisper.
      log(`${progress} ♫ extracting audio`);
      await withRetry(`extract ${id}`, () =>
        execFileSync(FFMPEG, ["-y", "-i", dlFile, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavFile], {
          stdio: "ignore",
        }),
      );
      execFileSync("rm", ["-f", dlFile]);
    }

    // 3. Transcribe (Hindi) to a RAW file. Generous cap: turbo runs ~5x realtime, so
    // minutes*45s leaves wide margin before a hang would trip it.
    log(`${progress} ✎ transcribing (turbo, hi): ${v.name}`);
    // Whisper writes <output-dir>/<wav-stem>.json (it ignores a dotted --output-name),
    // so send raw output to audioDir; the FINAL normalized file goes to transcriptsDir.
    execFileSync(
      MLX_WHISPER,
      [wavFile, "--model", WHISPER_MODEL, "--language", LANGUAGE, "--output-format", "json",
       "--output-dir", audioDir, "--output-name", slug],
      { stdio: "ignore", timeout: Math.max(15 * 60_000, v.minutes * 45_000), killSignal: "SIGKILL" },
    );

    // 4. Normalize into our transcript shape. Whisper sometimes emits bare NaN/Infinity
    // in logprob fields — invalid JSON — so sanitize before parsing. Only write the
    // FINAL transcript on success, so a failure never leaves a file that gets skipped.
    const rawText = readFileSync(rawFile, "utf8")
      .replace(/\bNaN\b/g, "null")
      .replace(/-?\bInfinity\b/g, "null");
    const raw = JSON.parse(rawText);
    const segments = (raw.segments ?? []).map((s) => ({
      start: Math.round(s.start),
      end: Math.round(s.end),
      text: (s.text ?? "").trim(),
    }));
    writeFileSync(
      transcriptFile,
      JSON.stringify({ title: v.name, url: v.link, videoId: id, language: LANGUAGE, minutes: v.minutes, segments }, null, 2),
    );
    execFileSync("rm", ["-f", rawFile, wavFile]);
    log(`${progress} ✔ done: ${v.name} (${segments.length} segments)`);
    done++;
  } catch (err) {
    failed++;
    // Clean up partials so a bad/half file isn't mistaken for a completed transcript on re-run.
    execFileSync("rm", ["-f", rawFile, transcriptFile]);
    log(`${progress} ✗ FAILED: ${v.name} — ${String(err.message).slice(0, 200)}`);
  }
}

log(`Run complete: ${done} transcribed, ${failed} failed, of ${videos.length}.`);
log(`Next: npm run ingest`);
