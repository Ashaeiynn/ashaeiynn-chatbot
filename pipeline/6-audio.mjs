// Step 6: Add a local audio file (mp3/wav/m4a…) to the knowledge base.
// Transcribes in Hindi with the same engine as the videos.
// Usage: node pipeline/6-audio.mjs "/path/to/file.mp3" "Title for the knowledge base"
//        (then: npm run ingest)
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "data", "transcripts");
const tmpDir = path.join(root, "data", "audio");
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const HOME = process.env.HOME;
const FFMPEG = `${HOME}/.local/bin/ffmpeg`;
const MLX_WHISPER = `${HOME}/Library/Python/3.9/bin/mlx_whisper`;
// FULL large-v3, not turbo: turbo trades away multilingual accuracy and was
// mangling Hindi badly (measured 2026-07-18 — "जय सिया राम" came out wrong in
// 100% of cases). Slower, but this is Bhaiya's teaching — accuracy wins.
// Override with WHISPER_MODEL=… if you ever need the fast one.
const WHISPER_MODEL = process.env.WHISPER_MODEL || "mlx-community/whisper-large-v3";
// Seeds the transcriber with the vocabulary it kept getting wrong. Same trick
// that fixed the iPhone's Hindi ear.
const VOCAB_PROMPT =
  "जय सिया राम। गुरुदेव, भैया, साधना, जाप, ध्यान, मंत्र, हवन, कृपा, आभामंडल, शक्ति, दुर्गा, नवरात्रि, सत्संग, पाठशाला, आशाईन।";
// Whisper's #1 failure mode: it "conditions on previous text" and can get stuck
// emitting one word (or "!") thousands of times — that is exactly what wrecked
// ~12.6% of this knowledge base. Turning it off prevents the loop.
const QUALITY_ARGS = ["--initial-prompt", VOCAB_PROMPT, "--condition-on-previous-text", "False"];

const [, , inputPath, titleArg] = process.argv;
if (!inputPath || !existsSync(inputPath)) {
  console.error('Usage: node pipeline/6-audio.mjs "/path/to/file.mp3" "Title"');
  process.exit(1);
}
const baseName = path.basename(inputPath).replace(/\.[^.]+$/, "");
const title = (titleArg || baseName).trim();
const slug = "audio_" + baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

// Resume-safe: if this file was already transcribed (e.g. before a restart),
// don't burn time doing it again.
if (existsSync(path.join(outDir, `${slug}.json`))) {
  console.log(`✓ already transcribed — skipping (${slug}.json exists)`);
  process.exit(0);
}

const wav = path.join(tmpDir, `${slug}.wav`);
console.log(`♫ extracting audio → ${slug}.wav`);
execFileSync(FFMPEG, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], {
  stdio: "ignore",
});

console.log(`✎ transcribing (large-v3, hi, anti-repeat): ${title}`);
const baseArgs = [wav, "--model", WHISPER_MODEL, "--language", "hi", "--output-format", "json",
  "--output-dir", tmpDir, "--output-name", slug];
try {
  execFileSync(MLX_WHISPER, [...baseArgs, ...QUALITY_ARGS], { stdio: "ignore" });
} catch (err) {
  // older mlx_whisper builds may not know these flags — never fail the job over it
  console.warn("⚠️  quality flags rejected by this whisper build — retrying plain");
  execFileSync(MLX_WHISPER, baseArgs, { stdio: "ignore" });
}

const rawText = readFileSync(path.join(tmpDir, `${slug}.json`), "utf8")
  .replace(/\bNaN\b/g, "null")
  .replace(/-?\bInfinity\b/g, "null");
const raw = JSON.parse(rawText);
const segments = (raw.segments ?? []).map((s) => ({
  start: Math.round(s.start),
  end: Math.round(s.end),
  text: (s.text ?? "").trim(),
}));

writeFileSync(
  path.join(outDir, `${slug}.json`),
  JSON.stringify({ title, url: "", videoId: slug, language: "hi", minutes: Math.round((segments.at(-1)?.end ?? 0) / 60), segments }, null, 2),
);
rmSync(wav, { force: true });
rmSync(path.join(tmpDir, `${slug}.json`), { force: true });
console.log(`✔ saved data/transcripts/${slug}.json (${segments.length} segments)`);
console.log("Next: npm run ingest");
