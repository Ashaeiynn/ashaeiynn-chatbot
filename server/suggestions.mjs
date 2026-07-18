// Seeker-suggested corrections: a MEMBER who feels an answer missed can share
// what Bhaiya actually teaches. These land here as PENDING — they NEVER touch
// the knowledge base until the admin approves one. On approval the server hands
// the (possibly edited) text to corrections.mjs, the same pipeline the admin's
// own edits use. Plain JSON storage only; no embeddings here.
//
// PRIVACY: this file holds seeker-written content + their uid — it lives under
// LOG_DIR (the VPS's permanent disk) and is gitignored, never pushed to GitHub.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const STATE_DIR = process.env.LOG_DIR || path.join(ROOT, "data");
const FILE = path.join(STATE_DIR, "suggestions.json");
try {
  mkdirSync(STATE_DIR, { recursive: true });
} catch {
  /* best effort */
}

const load = () => {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
};
const save = (v) => {
  try {
    writeFileSync(FILE, JSON.stringify(v, null, 2));
  } catch {
    /* disk best-effort */
  }
};

// A member flagged an answer. `suggestion` may be empty — that means "this was
// wrong but I don't have the right words" — still worth the admin's eyes.
export function addSuggestion({ q, askedQ, rawSuggestion, botAnswer, suggestion, uid, nick, member }) {
  const question = String(q || "").trim().slice(0, 2000);
  if (!question) return null;
  const all = load();
  const item = {
    id: Date.now().toString(36) + Math.floor(performance.now()).toString(36).slice(-3),
    // `q` is the question the bot will LEARN this for (worked out from the
    // exchange); askedQ/rawSuggestion keep what the member literally sent, so
    // the admin can always see the original.
    q: question,
    askedQ: String(askedQ || "").trim().slice(0, 2000),
    rawSuggestion: String(rawSuggestion || "").trim().slice(0, 4000),
    botAnswer: String(botAnswer || "").trim().slice(0, 4000),
    suggestion: String(suggestion || "").trim().slice(0, 4000),
    uid: String(uid || "").slice(0, 40),
    nick: String(nick || "").slice(0, 60),
    member: !!member,
    at: new Date().toISOString(),
  };
  all.push(item);
  save(all);
  return item;
}

export function listSuggestions() {
  return load().sort((a, b) => (a.at < b.at ? 1 : -1)); // newest first
}
export const pendingCount = () => load().length;

export function getSuggestion(id) {
  return load().find((s) => s.id === id) || null;
}

export function removeSuggestion(id) {
  const all = load();
  const left = all.filter((s) => s.id !== id);
  if (left.length !== all.length) save(left);
  return all.length !== left.length;
}
