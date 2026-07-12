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
const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";

const [, , inputPath, titleArg] = process.argv;
if (!inputPath || !existsSync(inputPath)) {
  console.error('Usage: node pipeline/6-audio.mjs "/path/to/file.mp3" "Title"');
  process.exit(1);
}
const baseName = path.basename(inputPath).replace(/\.[^.]+$/, "");
const title = (titleArg || baseName).trim();
const slug = "audio_" + baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const wav = path.join(tmpDir, `${slug}.wav`);
console.log(`♫ extracting audio → ${slug}.wav`);
execFileSync(FFMPEG, ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], {
  stdio: "ignore",
});

console.log(`✎ transcribing (turbo, hi): ${title}`);
execFileSync(
  MLX_WHISPER,
  [wav, "--model", WHISPER_MODEL, "--language", "hi", "--output-format", "json",
   "--output-dir", tmpDir, "--output-name", slug],
  { stdio: "ignore" },
);

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
