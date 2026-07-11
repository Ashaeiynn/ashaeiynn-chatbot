// Step 3: Build the knowledge base from transcripts, with multilingual embeddings
// for cross-language (Hindi↔English) semantic search.
// Usage: npm run ingest   (rebuilds data/knowledge.db from scratch — safe to re-run)
import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { embedPassages } from "../server/embed.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const transcriptsDir = path.join(root, "data", "transcripts");
const dbFile = path.join(root, "data", "knowledge.db");

const CHUNK_TARGET_CHARS = 1100; // ~60–90s of speech per chunk
const CHUNK_OVERLAP_CHARS = 200; // carry-over between chunks so boundaries don't split a concept
const EMBED_BATCH = 48;

// Whisper occasionally loops on a word ("अधिया अधिया अधिया…") on non-speech audio.
// Collapse any run of the same word to at most 2 in a row (natural emphasis survives).
// It can also stutter INSIDE a word ("गुरुतत्त्त्त्त्व…") — collapse any short character
// sequence repeated 3+ times in a row down to a single occurrence.
function cleanText(s) {
  s = s.replace(/(.{1,3}?)\1{2,}/gu, "$1");
  const words = s.split(/\s+/);
  const out = [];
  let prev = null;
  let run = 0;
  for (const w of words) {
    if (w === prev) {
      run++;
      if (run >= 2) continue;
    } else {
      prev = w;
      run = 0;
    }
    out.push(w);
  }
  return out.join(" ");
}

if (existsSync(dbFile)) rmSync(dbFile);
const db = new DatabaseSync(dbFile);
db.exec(`
  CREATE TABLE videos (id INTEGER PRIMARY KEY, title TEXT, url TEXT);
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    video_id INTEGER,
    title TEXT,
    content TEXT,
    start_seconds INTEGER,
    embedding BLOB
  );
`);
const insertVideo = db.prepare("INSERT INTO videos (title, url) VALUES (?, ?)");
const insertChunk = db.prepare(
  "INSERT INTO chunks (video_id, title, content, start_seconds, embedding) VALUES (?, ?, ?, ?, ?)",
);

// 1. Read transcripts and split into chunks.
const files = readdirSync(transcriptsDir).filter((f) => f.endsWith(".json") && !f.endsWith(".raw.json"));
if (files.length === 0) {
  console.error("No transcripts found in data/transcripts — run the transcription pipeline first.");
  process.exit(1);
}

const pending = []; // { videoId, title, content, start }
for (const file of files) {
  const t = JSON.parse(readFileSync(path.join(transcriptsDir, file), "utf8"));
  if (!t.title || !Array.isArray(t.segments)) continue;
  const videoId = insertVideo.run(t.title, t.url ?? "").lastInsertRowid;

  let buf = []; // [{ text, start }]
  let chars = 0;
  let dirty = false; // new segments added since the last boundary flush?
  const flush = (keepOverlap) => {
    if (!buf.length) return;
    const content = cleanText(buf.map((s) => s.text).join(" "));
    if (content.trim()) pending.push({ videoId, title: t.title, content, start: buf[0].start });
    if (keepOverlap) {
      // Carry the last ~OVERLAP_CHARS of segments into the next chunk so a concept
      // spanning a boundary appears whole in at least one chunk.
      const tail = [];
      let tc = 0;
      for (let i = buf.length - 1; i >= 0 && tc < CHUNK_OVERLAP_CHARS; i--) {
        tail.unshift(buf[i]);
        tc += buf[i].text.length;
      }
      buf = tail;
      chars = tc;
    } else {
      buf = [];
      chars = 0;
    }
  };
  for (const seg of t.segments) {
    if (!seg.text) continue;
    buf.push({ text: seg.text, start: seg.start ?? 0 });
    chars += seg.text.length;
    dirty = true;
    // Curated docs (e.g. the About entry) index each segment as its own chunk so a
    // short focused statement isn't diluted inside a large mixed chunk.
    if (t.chunkPerSegment || chars >= CHUNK_TARGET_CHARS) {
      flush(!t.chunkPerSegment);
      dirty = false;
    }
  }
  if (dirty) flush(false); // final partial chunk only if it has content beyond the carried overlap
}
console.log(`Prepared ${pending.length} chunks from ${files.length} transcript(s). Embedding…`);

// 2. Embed in batches and store.
let done = 0;
for (let i = 0; i < pending.length; i += EMBED_BATCH) {
  const batch = pending.slice(i, i + EMBED_BATCH);
  // Embed title + content together: titles carry strong topic signal ("Guru vs. Guru
  // Tattva") that spoken text alone can miss. Stored content stays unchanged.
  const vectors = await embedPassages(batch.map((c) => `${c.title}. ${c.content}`));
  for (let j = 0; j < batch.length; j++) {
    const c = batch[j];
    const blob = Buffer.from(vectors[j].buffer, vectors[j].byteOffset, vectors[j].byteLength);
    insertChunk.run(c.videoId, c.title, c.content, c.start, blob);
  }
  done += batch.length;
  process.stdout.write(`\r  embedded ${done}/${pending.length}`);
}
console.log("");

db.close();
console.log(`Knowledge base built: ${files.length} video(s), ${pending.length} searchable chunks.`);
console.log("Next: npm start  (then open http://localhost:3111 to test)");
