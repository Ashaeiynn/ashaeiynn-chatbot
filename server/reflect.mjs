// Nightly self-review: the bot reads its own conversations from the last day
// and writes itself COMMUNICATION lessons — how to speak better (clarity,
// length, language match, warmth). Style only: knowledge always stays
// Bhaiya's teachings; these notes may never add or change content.
// Run by chatbot-reflect.timer on the live server:  node server/reflect.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { complete } from "./llm.mjs";

const LOG = path.join(process.env.LOG_DIR || path.join(ROOT, "data"), "questions.log");
const OUT = path.join(ROOT, "data", "style-notes.json");

const since = Date.now() - 24 * 3600 * 1000;
const entries = !existsSync(LOG)
  ? []
  : readFileSync(LOG, "utf8")
      .trim()
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.q && !e.testMode && new Date(e.at).getTime() > since);

if (entries.length < 5) {
  console.log(`reflect: only ${entries.length} conversations in the last day — nothing to learn yet`);
  process.exit(0);
}

const sample = entries
  .slice(-120)
  .map((e) => `Q: ${e.q}\nA: ${String(e.answer || e.error || "").slice(0, 400)}`)
  .join("\n---\n");

let current = [];
try {
  current = JSON.parse(readFileSync(OUT, "utf8")).notes || [];
} catch {
  /* first run */
}

try {
  const raw = await complete({
    system: `You review one day of real conversations between spiritual seekers and a voice chatbot that answers from a guru's recorded teachings. Your job is ONLY communication coaching for the bot — helping it converse like a warm, present human guide.

Output ONLY a JSON array (no prose) of at most 8 short guidelines in English about HOW the bot should communicate, judged across these dimensions:
- clarity & length: sentences spoken-simple, answers not lectures
- language match: seeker's language and register mirrored
- emotional attunement: did the bot notice and acknowledge feelings (fear, joy, confusion, gratitude) before answering? Where did it miss?
- conversational flow: did exchanges continue or die after one answer? Were the open doors varied and natural, or repetitive/mechanical? Was a question ignored by the seeker (a sign it felt forced)?
- repetition signals: the same seeker re-asking means the answer didn't land — coach a different approach.

STRICT rules:
- NEVER write guidelines about facts, content, teachings, or what the bot should know or claim — delivery, warmth and flow only.
- Start from the current guidelines given: keep the ones that still look right, drop stale ones, refine wording, and add at most 2 new ones per day — only if today's conversations genuinely show the need.
- If nothing needs to change, return the current list unchanged.`,
    messages: [
      {
        role: "user",
        content: `Current guidelines:\n${JSON.stringify(current, null, 1)}\n\nToday's conversations:\n${sample}`,
      },
    ],
    maxTokens: 600,
    light: true,
    retry: false,
  });
  const m = raw.match(/\[[\s\S]*\]/);
  const notes = (m ? JSON.parse(m[0]) : current)
    .filter((n) => typeof n === "string" && n.trim())
    .map((n) => n.trim().slice(0, 200))
    .slice(0, 8);
  writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), reviewed: entries.length, notes }, null, 2));
  console.log(`reflect: reviewed ${entries.length} conversations → ${notes.length} communication lessons`);
} catch (err) {
  console.error("reflect: skipped —", err?.message);
}
