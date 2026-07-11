// Step 2: Transcribe downloaded audio into timestamped transcripts (JSON).
// Usage: npm run transcribe
// Tries, in order: mlx_whisper (fast on Apple Silicon), whisper-cli (whisper.cpp), whisper (openai-whisper).
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(root, "data", "audio");
const outDir = path.join(root, "data", "transcripts");
mkdirSync(outDir, { recursive: true });

function available(cmd, args = ["--help"]) {
  try {
    const r = spawnSync(cmd, args, { stdio: "ignore" });
    return r.status !== null && !r.error;
  } catch {
    return false;
  }
}

const engine = ["mlx_whisper", "whisper-cli", "whisper"].find((e) => available(e));
if (!engine) {
  console.error(
    "No transcription engine found. Easiest install (needs Python 3):\n" +
      "  python3 -m pip install --user mlx-whisper   # Apple Silicon, fast\n" +
      "  # or: python3 -m pip install --user openai-whisper",
  );
  process.exit(1);
}
console.log(`Using transcription engine: ${engine}`);

const audioFiles = existsSync(audioDir)
  ? readdirSync(audioDir).filter((f) => /\.(m4a|mp3|wav|webm|opus)$/i.test(f))
  : [];

if (audioFiles.length === 0) {
  console.error("No audio files in data/audio — run: npm run download first.");
  process.exit(1);
}

for (const file of audioFiles) {
  const base = file.replace(/\.[^.]+$/, "");
  const outFile = path.join(outDir, `${base}.json`);
  if (existsSync(outFile)) {
    console.log(`✓ already transcribed: ${base}`);
    continue;
  }

  // Title/URL metadata written by the download step.
  let title = base.replace(/-/g, " ");
  let url = "";
  const metaFile = path.join(audioDir, `${base}.meta`);
  if (existsSync(metaFile)) {
    const [t, u] = readFileSync(metaFile, "utf8").trim().split("\n");
    if (t) title = t;
    if (u) url = u;
  }

  console.log(`✎ transcribing: ${title} (this can take a while)`);
  const audioPath = path.join(audioDir, file);
  let segments = [];

  if (engine === "mlx_whisper" || engine === "whisper") {
    execFileSync(
      engine,
      [audioPath, "--output-format", "json", "--output-dir", outDir, "--task", "transcribe"],
      { stdio: "inherit" },
    );
    const raw = JSON.parse(readFileSync(path.join(outDir, `${base}.json`), "utf8"));
    segments = (raw.segments ?? []).map((s) => ({
      start: Math.round(s.start),
      end: Math.round(s.end),
      text: s.text.trim(),
    }));
  } else {
    // whisper.cpp CLI
    execFileSync(engine, ["-f", audioPath, "-oj", "-of", path.join(outDir, base)], {
      stdio: "inherit",
    });
    const raw = JSON.parse(readFileSync(path.join(outDir, `${base}.json`), "utf8"));
    segments = (raw.transcription ?? []).map((s) => ({
      start: Math.round((s.offsets?.from ?? 0) / 1000),
      end: Math.round((s.offsets?.to ?? 0) / 1000),
      text: (s.text ?? "").trim(),
    }));
  }

  writeFileSync(outFile, JSON.stringify({ title, url, segments }, null, 2));
  console.log(`  → saved ${outFile} (${segments.length} segments)`);
}

console.log("\nDone. Next step: npm run ingest");
