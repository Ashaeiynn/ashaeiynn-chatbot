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

export async function search(question, limit = 8) {
  const all = load();
  if (all.length === 0) return [];
  const qv = await embedQuery(question);
  const scored = all.map((c) => ({ chunk: c, score: cosine(qv, c.vec) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ chunk, score }) => ({
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
