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

// Some recordings transcribed badly — whisper got "stuck" and emitted the same
// word (or "!" / single letters) thousands of times. Measured 2026-07-18: ~12.6%
// of chunks are this garbage. Retrieving them gives the guide nothing to say, so
// answers from those videos came out vague or wrong. We keep them in the file
// (nothing is deleted) but exclude them from SEARCH.
// Tuned on real data: spoken Hindi is full of 2-letter words, so short-word
// share is NOT a junk signal — repetition and single-character spam are.
function isGarbled(text) {
  const w = String(text || "").split(/\s+/).filter(Boolean);
  if (w.length < 12) return true;
  const uniq = new Set(w).size / w.length;
  const counts = {};
  for (const x of w) counts[x] = (counts[x] || 0) + 1;
  const topShare = Math.max(...Object.values(counts)) / w.length;
  const singleShare = w.filter((x) => x.length <= 1).length / w.length;
  return uniq < 0.25 || topShare > 0.25 || singleShare > 0.4;
}

// Legal/admin pages carry no teaching, but they are text like any other, so a
// weak match could surface "Disclaimer" as the cited source under a spiritual
// answer. Excluded from SEARCH at the owner's request (2026-07-18); like the
// garbled chunks they stay in the library — nothing is deleted.
const BOILERPLATE_PAGE =
  /^website:\s*(disclaimer|terms|no refund|refund|shipping|privacy)/i;

function load() {
  if (chunks) return chunks;
  if (!existsSync(dbFile)) throw new Error("Knowledge base not built yet — run: npm run ingest");
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const all = db
    .prepare(
      `SELECT c.title, c.content, c.start_seconds, c.embedding, v.url
       FROM chunks c JOIN videos v ON v.id = c.video_id`,
    )
    .all();
  db.close();
  const rows = all.filter((r) => !isGarbled(r.content) && !BOILERPLATE_PAGE.test(r.title || ""));
  const dropped = all.length - rows.length;
  const legal = all.filter((r) => BOILERPLATE_PAGE.test(r.title || "")).length;
  if (dropped)
    console.log(
      `retrieval: ${rows.length} usable chunks (skipped ${dropped - legal} garbled from bad transcriptions, ${legal} legal/admin pages)`,
    );
  chunks = rows.map((r) => ({
    title: r.title,
    content: r.content,
    start_seconds: r.start_seconds,
    url: r.url,
    vec: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
  }));
  return chunks;
}

// Re-read knowledge.db after the admin portal teaches the bot something new,
// so fresh material answers questions without a server restart.
export function reload() {
  chunks = null;
  return load();
}

// Questions naming the organisation itself ("what is Ashaeiynn?", "Aqua Foundation
// kya hai?") must always see the curated About entry — lectures mention these names
// constantly, which drowns the About doc in embedding space.
const BRAND_PATTERN =
  /ashaeiynn|\basha[eiy]{1,3}nn?\b|asha\b|[अआ]शा\s?[ईइय]{1,2}न|\b(?:aashray|ashray|aashraya)\b|आश्रय|aqua\s*foundation|path\s?shala|पाठ\s?शाला|bhaiy?ya|भ[ैइ]या|par[ie]{0,2}ksh[ie]+t|पर[ीि]क्षित|gurudev|गुरुदेव/i;
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
  // …and the same guard across DIFFERENT sources. The cap above is keyed on the
  // title, so one teaching uploaded twice under two names took 3 slots EACH —
  // measured 2026-07-19: six of the twelve excerpts were the same teaching,
  // leaving six for everything else. MEASURED THRESHOLD: chunks of one teaching
  // in two versions score 0.925 median (up to 1.000); chunks from genuinely
  // different teachings never exceeded 0.874. 0.90 sits in that gap.
  const NEAR_DUPLICATE = 0.9;
  const perVideo = new Map();
  let top = [];
  for (const item of scored) {
    const key = item.chunk.title;
    const n = perVideo.get(key) ?? 0;
    if (n >= PER_VIDEO_CAP) continue;
    // Only ACROSS sources. Within one source, consecutive chunks deliberately
    // overlap by ~200 chars, so they score above this and would be thrown away —
    // which stripped the main teaching down to a single chunk and left answers
    // vague (measured, and immediately visible in the reply). Depth inside one
    // source is what PER_VIDEO_CAP is for; this guard is only about the same
    // teaching arriving twice under two different names.
    if (top.some((t) => t.chunk.title !== key && cosine(t.chunk.vec, item.chunk.vec) >= NEAR_DUPLICATE)) continue;
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

// Which sources are teaching the SAME thing? Uploading one teaching twice (a
// second copy, or the same material rewritten) is easy to do by accident, and
// the bot then spends part of every relevant answer repeating itself. This only
// REPORTS it — it never deletes, because two versions of one teaching are
// sometimes deliberate (prose + Q&A, say).
//
// MEASURED 2026-07-19, and the first attempt got this wrong. Counting "chunks
// above 0.90" flagged 45 pairs, most of them merely related articles. What
// actually separates them is the MEAN best match across a source:
//   the same document twice ……… 0.957 – 0.975
//   related but distinct teachings 0.929 – 0.941  (incl. the template hawan pages)
// so the line sits at 0.95.
const SAME_TEACHING = 0.95;

export function duplicateSources() {
  const all = load();
  const bySource = new Map();
  for (const c of all) {
    if (!bySource.has(c.title)) bySource.set(c.title, []);
    bySource.get(c.title).push(c);
  }
  const titles = [...bySource.keys()];
  const out = [];
  for (const title of titles) {
    const mine = bySource.get(title);
    if (mine.length < 2) continue; // too small to judge
    let best = { title: null, score: 0 };
    for (const other of titles) {
      if (other === title) continue;
      const theirs = bySource.get(other);
      // how well is EVERY part of this source already covered by that one?
      let sum = 0;
      for (const c of mine) {
        let top = 0;
        for (const o of theirs) {
          const sim = cosine(c.vec, o.vec);
          if (sim > top) top = sim;
        }
        sum += top;
      }
      const mean = sum / mine.length;
      if (mean > best.score) best = { title: other, score: mean };
    }
    if (best.title && best.score >= SAME_TEACHING)
      out.push({ title, twin: best.title, share: Math.round(best.score * 100) });
  }
  return out;
}

// आज का विचार: one substantive passage per day, the SAME for everyone —
// picked deterministically from the whole knowledge by the date key.
// Returns up to `n` candidate passages for the day's thought, deterministic by
// date but spread across the knowledge base — so if the first is a garbled
// transcript the caller can move on to the next and still get a clean thought.
export function thoughtCandidate(dayKey, n = 8) {
  const good = load().filter((c) => c.content.length >= 250 && c.content.length <= 900);
  if (!good.length) return [];
  let h = 0;
  for (const ch of dayKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < Math.min(n, good.length); i++) {
    const c = good[(h + i * 7919) % good.length]; // prime stride → varied passages
    out.push({ content: c.content, title: c.title, url: c.url, start_seconds: c.start_seconds });
  }
  return out;
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
