// Bhaiya-approved answers ("corrections"): the admin can edit any answer the bot
// gave. Edits are stored with an embedding of their question — an incoming
// question that means the same thing gets the approved answer verbatim, and a
// merely similar one sees it as the highest-authority excerpt.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { embedQuery, cosine } from "./embed.mjs";

// Corrections are runtime state (edited in the live admin portal). Like
// questions.log they live under LOG_DIR when it is set — on the cloud host
// that's a mounted persistent disk, so approved answers survive restarts and
// redeploys. A fresh disk is seeded once from the repo's own copy.
const REPO_FILE = path.join(ROOT, "data", "corrections.json");
const STATE_DIR = process.env.LOG_DIR || path.join(ROOT, "data");
const FILE = path.join(STATE_DIR, "corrections.json");
try {
  mkdirSync(STATE_DIR, { recursive: true });
  if (FILE !== REPO_FILE && !existsSync(FILE) && existsSync(REPO_FILE)) copyFileSync(REPO_FILE, FILE);
} catch {
  /* best effort — load() tolerates a missing file */
}

// Calibrated against the live corrections with this exact embedding model
// (measured 2026-07-18, e5 gives a HIGH similarity floor for same-language,
// same-domain text — so a low bar matches everything):
//   unrelated / a bare greeting …… 0.75 – 0.84   ← must NOT match
//   genuine rewording of the Q …… 0.86 – 0.93   ← should match
//   the identical question ………… 0.975
// The old HINT of 0.80 sat INSIDE the noise band, so a correction was injected
// as "Bhaiya's approved answer — outranks every excerpt" on nearly every
// question (even greetings), dragging answers off-topic and generic.
// Bias high on purpose: missing a borderline correction only means the bot
// answers normally from the teachings, while a false match poisons every answer.
export const DIRECT_MATCH = Number(process.env.CORRECTION_DIRECT || 0.93);
export const HINT_MATCH = Number(process.env.CORRECTION_HINT || 0.88);

let items = null; // [{ id, q, answer, at, vec }]

// A correction is keyed by its question AND a few natural rewordings of it, so
// the same ask in different words — or the other language — still finds it.
const keyVecs = (it) =>
  Promise.all([it.q, ...(Array.isArray(it.alts) ? it.alts : [])].map((t) => embedQuery(t)));

async function load() {
  if (items) return items;
  items = [];
  if (existsSync(FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      for (const it of raw) items.push({ ...it, vecs: await keyVecs(it) });
    } catch (err) {
      console.error("corrections load failed:", err?.message);
    }
  }
  return items;
}

function persist() {
  writeFileSync(FILE, JSON.stringify(items.map(({ vecs, ...it }) => it), null, 2));
}

// LATEST KNOWLEDGE WINS (owner, 2026-07-20). When a file is uploaded or a website
// article is found that covers the SAME question as an older admin correction,
// the newer source is the authority — the correction is retired so the bot
// answers from the latest teaching. Runs after every ingest (see teach.mjs).
//
// SAFETY: embedding similarity alone is far too blunt here — a big topical file
// (a whole havan session) scores 0.85+ against every havan correction without
// actually answering the specific question (measured 2026-07-20). Deleting on
// that would silently wipe careful corrections. So cosine is only a cheap SCREEN;
// the LLM then confirms the newer source genuinely answers THAT question before
// anything is removed. `complete` is injected so this module needs no LLM import.
const SUPERSEDE_SCREEN = Number(process.env.SUPERSEDE_SCREEN || 0.86);
const SUPERSEDE_SYS =
  "You prune an admin-corrected answer bank for a spiritual guide bot. Each item has: the QUESTION a seeker asks, the older APPROVED answer an admin wrote, and an EXCERPT from a NEWER teaching source added after that correction. Retire an id ONLY when the newer excerpt genuinely and specifically ANSWERS that exact question — the actual information is there (whether it agrees with or updates the old answer), so the bot can now rely on the newer source and the correction is no longer needed. Do NOT retire when the excerpt is merely on a related or broader topic, only mentions the words, or when you are unsure. When in doubt, keep it. Output ONLY a JSON array of the ids to retire (may be empty).";

export async function supersedeByNewer({ complete, bestNewerMatch, apply = true }) {
  const all = await load();
  if (!all.length || typeof bestNewerMatch !== "function") return { checked: all.length, candidates: 0, retired: [] };
  const candidates = [];
  for (const c of all) {
    const afterMs = new Date(c.at).getTime();
    if (!afterMs) continue;
    // screen on the ANSWER content (the precise signal) plus the question keys
    const av = await embedQuery(String(c.answer || "").slice(0, 1500));
    const m = bestNewerMatch([av, ...(c.vecs || [])], afterMs);
    if (m && m.score >= SUPERSEDE_SCREEN) candidates.push({ c, m });
  }
  if (!candidates.length) return { checked: all.length, candidates: 0, retired: [] };
  const payload = candidates.map(({ c, m }) => ({
    id: c.id,
    question: c.q,
    approved: String(c.answer || "").slice(0, 600),
    excerpt: String(m.content || "").slice(0, 900),
  }));
  let retireIds = [];
  try {
    const raw = await complete({
      system: SUPERSEDE_SYS,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
      maxTokens: 400,
      retry: false,
    });
    const mm = raw.match(/\[[\s\S]*\]/);
    if (mm) retireIds = JSON.parse(mm[0]).map(String);
  } catch {
    retireIds = []; // if the check fails, change nothing — never delete on error
  }
  const retired = [];
  for (const { c, m } of candidates) {
    if (!retireIds.includes(String(c.id))) continue;
    retired.push({ id: c.id, q: c.q, by: m.title, score: Number(m.score.toFixed(3)), at: new Date().toISOString() });
  }
  if (apply && retired.length) {
    const gone = new Set(retired.map((r) => r.id));
    items = items.filter((it) => !gone.has(it.id));
    persist();
    // a forensic trail — deletion has no UI undo (owner's choice), so keep a
    // server-side record of exactly what was retired and by which source
    try {
      appendFileSync(path.join(STATE_DIR, "corrections-retired.log"), retired.map((r) => JSON.stringify(r)).join("\n") + "\n");
    } catch {
      /* best effort */
    }
    for (const r of retired) console.log(`supersede: retired correction "${r.q.slice(0, 50)}" — newer source "${String(r.by).slice(0, 40)}" now covers it`);
  }
  return { checked: all.length, candidates: candidates.length, retired };
}

export async function listCorrections() {
  return (await load()).map(({ vecs, ...it }) => it).sort((a, b) => b.id.localeCompare(a.id));
}

export async function addCorrection(q, answer, alts = []) {
  const question = String(q || "").trim().slice(0, 2000);
  const text = String(answer || "").trim().slice(0, 8000);
  if (!question || !text) throw new Error("Both the question and the edited answer are needed.");
  await load();
  const qv = await embedQuery(question);
  // Rewordings are what make a correction survive a change of words OR script.
  // MEASURED 2026-07-18: this embedding model compares SCRIPT as much as meaning
  // across languages — against a Hinglish key, the very same question written in
  // Devanagari scored 0.758 while an unrelated question scored 0.858. So cosine
  // can only police a reworded key in the SAME script; a translation has to be
  // trusted (the model that wrote it is reliable at translating) or a Hinglish
  // correction would never reach the seekers who ask in Hindi.
  // Cosine is only trustworthy Devanagari-to-Devanagari: English and Hinglish
  // share the Latin alphabet, so gating those wrongly threw away the English
  // wording (measured — it dropped a perfectly good one). Where the check is
  // meaningful it still guards against a paraphrase broader than the question,
  // which is how one correction once swallowed every nearby question.
  const devanagari = (t) => /[ऀ-ॿ]/.test(t);
  const clean = [];
  for (const a of Array.isArray(alts) ? alts : []) {
    const t = String(a || "").trim().slice(0, 300);
    if (t.length < 8 || t.toLowerCase() === question.toLowerCase()) continue;
    const bothHindi = devanagari(t) && devanagari(question);
    if (!bothHindi || cosine(await embedQuery(t), qv) >= 0.85) clean.push(t);
    if (clean.length >= 4) break;
  }
  // one approved answer per question — editing again replaces the old one
  items = items.filter((it) => it.q.trim() !== question);
  const it = {
    id: Date.now().toString(36),
    q: question,
    ...(clean.length ? { alts: clean } : {}),
    answer: text,
    at: new Date().toISOString(),
  };
  items.push({ ...it, vecs: await keyVecs(it) });
  persist();
  return it;
}

export async function removeCorrection(id) {
  await load();
  const before = items.length;
  items = items.filter((it) => it.id !== id);
  if (items.length !== before) persist();
  return items.length !== before;
}

export async function matchCorrection(question) {
  const all = await load();
  if (!all.length) return null;
  const qv = await embedQuery(question);
  let best = null;
  for (const it of all) {
    // best of the question and its rewordings
    let score = 0;
    for (const v of it.vecs) score = Math.max(score, cosine(qv, v));
    if (!best || score > best.score) best = { id: it.id, q: it.q, answer: it.answer, score };
  }
  return best && best.score >= HINT_MATCH ? best : null;
}
