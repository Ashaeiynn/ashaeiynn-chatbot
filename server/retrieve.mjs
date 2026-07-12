// Cross-language semantic search over the transcript knowledge base.
// Loads all chunk vectors into memory once, then ranks by cosine similarity to the
// query embedding. Handles Hindi and English questions against Hindi content.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { embedQuery, cosine } from "./embed.mjs";

const dbFile = path.join(ROOT, "data", "knowledge.db");

let chunks = null; // in-memory: [{ id, title, content, start_seconds, url, vec }]

function load() {
  if (chunks) return chunks;
  if (!existsSync(dbFile)) throw new Error("Knowledge base not built yet — run: npm run ingest");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT c.title, c.content, c.start_seconds, c.embedding, v.url
       FROM chunks c JOIN videos v ON v.id = c.video_id`,
    )
    .all();
  db.close();
  chunks = rows.map((r) => ({
    title: r.title,
    content: r.content,
    start_seconds: r.start_seconds,
    url: r.url,
    vec: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
  }));
  return chunks;
}

// Questions naming the organisation itself ("what is Ashaeiynn?", "Aqua Foundation
// kya hai?") must always see the curated About entry — lectures mention these names
// constantly, which drowns the About doc in embedding space.
const BRAND_PATTERN = /ashaeiynn|asha\b|aqua\s*foundation|pathshala|पाठशाला|bhaiya|भैया|parikshit|परीक्षित|gurudev|गुरुदेव/i;
const isAboutChunk = (c) => c.title.startsWith("About Ashaeiynn");

export async function search(question, limit = 8) {
  return searchMulti([question], limit);
}

// Search with several phrasings of the same question (e.g. the original + a
// translation) — each chunk is scored by its best match across the phrasings.
// Fixes cross-language misses: an English question also searches in Hindi.
export async function searchMulti(questions, limit = 8) {
  const all = load();
  const queries = questions.filter((q) => q && q.trim());
  if (all.length === 0 || queries.length === 0) return [];
  const question = queries.join(" ");
  const qvs = await Promise.all(queries.map(embedQuery));
  const scored = all.map((c) => ({
    chunk: c,
    score: Math.max(...qvs.map((qv) => cosine(qv, c.vec))),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Diversity cap: one long video can flood the ranking with near-duplicate chunks,
  // crowding out other videos that teach the same topic. Cap chunks per video so the
  // model sees material from several videos.
  const PER_VIDEO_CAP = 3;
  const perVideo = new Map();
  let top = [];
  for (const item of scored) {
    const key = item.chunk.title;
    const n = perVideo.get(key) ?? 0;
    if (n >= PER_VIDEO_CAP) continue;
    perVideo.set(key, n + 1);
    top.push(item);
    if (top.length >= limit) break;
  }
  if (BRAND_PATTERN.test(question) && !top.some(({ chunk }) => isAboutChunk(chunk))) {
    const aboutBest = scored.filter(({ chunk }) => isAboutChunk(chunk)).slice(0, 2);
    if (aboutBest.length) top = [...top.slice(0, limit - aboutBest.length), ...aboutBest];
  }

  return top.map(({ chunk, score }) => ({
    content: chunk.content,
    title: chunk.title,
    start_seconds: chunk.start_seconds,
    url: chunk.url,
    score,
  }));
}

export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
