// Step 1: Download audio tracks from the Vimeo links in data/videos.txt
// Usage: npm run download
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(root, "data", "audio");
mkdirSync(audioDir, { recursive: true });

function findYtDlp() {
  const candidates = [
    "yt-dlp",
    path.join(process.env.HOME ?? "", ".local", "bin", "yt-dlp"),
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const ytdlp = findYtDlp();
if (!ytdlp) {
  console.error(
    "yt-dlp is not installed. Install it with:\n" +
      "  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos -o ~/.local/bin/yt-dlp && chmod +x ~/.local/bin/yt-dlp",
  );
  process.exit(1);
}

const listFile = path.join(root, "data", "videos.txt");
const lines = readFileSync(listFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (lines.length === 0) {
  console.error("No video links found in data/videos.txt — paste your Vimeo links there first.");
  process.exit(1);
}

for (const line of lines) {
  const [url, title] = line.split("|").map((s) => s.trim());
  const slug = (title || url)
    .toLowerCase()
    .replace(/https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  const outBase = path.join(audioDir, slug);
  if (existsSync(`${outBase}.m4a`) || existsSync(`${outBase}.mp3`)) {
    console.log(`✓ already downloaded: ${slug}`);
    continue;
  }

  console.log(`↓ downloading audio: ${url}`);
  // Audio only — much faster and smaller than full video.
  execFileSync(
    ytdlp,
    [
      "-f", "bestaudio",
      "--no-playlist",
      "--print-to-file", "%(title)s\n%(webpage_url)s", `${outBase}.meta`,
      "-o", `${outBase}.%(ext)s`,
      url,
    ],
    { stdio: "inherit" },
  );
}

console.log("\nDone. Next step: npm run transcribe");
