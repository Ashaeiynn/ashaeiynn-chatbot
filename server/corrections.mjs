// Bhaiya-approved answers ("corrections"): the admin can edit any answer the bot
// gave. Edits are stored with an embedding of their question — an incoming
// question that means the same thing gets the approved answer verbatim, and a
// merely similar one sees it as the highest-authority excerpt.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { embedQuery, cosine } from "./embed.mjs";

const FILE = path.join(ROOT, "data", "corrections.json");

// Same-meaning questions score ~0.9+ with e5 query embeddings; related ~0.8+.
export const DIRECT_MATCH = Number(process.env.CORRECTION_DIRECT || 0.9);
export const HINT_MATCH = Number(process.env.CORRECTION_HINT || 0.8);

let items = null; // [{ id, q, answer, at, vec }]

async function load() {
  if (items) return items;
  items = [];
  if (existsSync(FILE)) {
    try {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      for (const it of raw) items.push({ ...it, vec: await embedQuery(it.q) });
    } catch (err) {
      console.error("corrections load failed:", err?.message);
    }
  }
  return items;
}

function persist() {
  writeFileSync(FILE, JSON.stringify(items.map(({ vec, ...it }) => it), null, 2));
}

export async function listCorrections() {
  return (await load()).map(({ vec, ...it }) => it).sort((a, b) => b.id.localeCompare(a.id));
}

export async function addCorrection(q, answer) {
  const question = String(q || "").trim().slice(0, 2000);
  const text = String(answer || "").trim().slice(0, 8000);
  if (!question || !text) throw new Error("Both the question and the edited answer are needed.");
  await load();
  // one approved answer per question — editing again replaces the old one
  items = items.filter((it) => it.q.trim() !== question);
  const it = { id: Date.now().toString(36), q: question, answer: text, at: new Date().toISOString() };
  items.push({ ...it, vec: await embedQuery(question) });
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
    const score = cosine(qv, it.vec);
    if (!best || score > best.score) best = { id: it.id, q: it.q, answer: it.answer, score };
  }
  return best && best.score >= HINT_MATCH ? best : null;
}
