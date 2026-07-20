// Bhaiya-approved answers ("corrections"): the admin can edit any answer the bot
// gave. Edits are stored with an embedding of their question — an incoming
// question that means the same thing gets the approved answer verbatim, and a
// merely similar one sees it as the highest-authority excerpt.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
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

// LATEST KNOWLEDGE WINS — as a REVIEW, never automatically (owner, 2026-07-20).
// When a file/article is added that REPUBLISHES a correction's teaching, the admin
// is shown it and can UPDATE the correction's answer to the latest content. It is
// never auto-applied, because:
//   • DELETING the correction degrades answers — the correction is the retrieval
//     GUARANTEE for its question; a newer source matching the correction's ANSWER
//     does NOT mean the QUESTION will retrieve that source (measured: after retiring
//     the Gupt Navratri correction its own newer source was not in the top 8).
//   • An LLM cannot judge "is this superseded?" reliably — the same model on the
//     same input returned 6, 7, and 16 retirements across three runs, some clearly
//     wrong. So detection is deterministic (near-identical answer content) and the
//     human decides the actual update.
const SUPERSEDE_MIN = Number(process.env.SUPERSEDE_MIN || 0.9);
const DISMISS_FILE = path.join(STATE_DIR, "supersede-dismissed.json");
const loadDismissed = () => {
  try {
    return new Set(JSON.parse(readFileSync(DISMISS_FILE, "utf8")));
  } catch {
    return new Set();
  }
};

// Report-only: which corrections a NEWER source now republishes, for the admin to
// review. Returns the correction, the newer source's title, and its best excerpt
// (a starting point for the updated answer). Nothing is changed.
export async function supersedeReview({ bestNewerMatch }) {
  const all = await load();
  if (!all.length || typeof bestNewerMatch !== "function") return [];
  const dismissed = loadDismissed();
  const out = [];
  for (const c of all) {
    const afterMs = new Date(c.at).getTime();
    if (!afterMs) continue;
    const av = await embedQuery(String(c.answer || "").slice(0, 1500));
    const m = bestNewerMatch([av], afterMs);
    if (!m || m.score < SUPERSEDE_MIN) continue;
    if (dismissed.has(`${c.id}::${m.title}`)) continue; // admin already said "keep"
    out.push({
      id: c.id,
      q: c.q,
      currentAnswer: c.answer,
      source: m.title,
      excerpt: String(m.content || "").slice(0, 1200),
      score: Number(m.score.toFixed(3)),
    });
  }
  return out;
}

// The admin chose to KEEP a correction despite a newer source — remember it so
// that same pairing is not flagged again.
export function dismissSupersede(correctionId, sourceTitle) {
  const d = loadDismissed();
  d.add(`${correctionId}::${sourceTitle}`);
  try {
    writeFileSync(DISMISS_FILE, JSON.stringify([...d], null, 2));
  } catch {
    /* best effort */
  }
}

// The admin chose to UPDATE a correction's answer to the newer content. Reuses
// addCorrection (replaces by question, regenerates alt-wordings) so the question
// stays the retrieval anchor — only the answer is refreshed to the latest.
export async function updateCorrectionAnswer(correctionId, newAnswer, alts = []) {
  const c = (await load()).find((x) => x.id === correctionId);
  if (!c) throw new Error("That correction no longer exists.");
  return addCorrection(c.q, newAnswer, alts);
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
