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

const chats = entries.filter((e) => !e.feedback);
const votes = entries.filter((e) => e.feedback);
if (chats.length < 5) {
  console.log(`reflect: only ${chats.length} conversations in the last day — nothing to learn yet`);
  process.exit(0);
}

const sample = chats
  .slice(-120)
  .map(
    (e) =>
      `Q${e.via === "notification" ? " (seeker arrived by tapping a notification — judge the opener's warmth)" : e.via === "voice" ? " (spoken)" : ""}: ${e.q}\nA: ${String(e.answer || e.error || "").slice(0, 400)}`,
  )
  .join("\n---\n");

// the seekers' own verdicts: answers they explicitly marked unhelpful are the
// most precious study material of the day
const downs = votes
  .filter((v) => v.feedback === "down")
  .map((v) => chats.filter((c) => c.q === v.q && c.answer).pop())
  .filter(Boolean)
  .slice(0, 10);
const upCount = votes.filter((v) => v.feedback === "up").length;
const feedbackBlock = downs.length
  ? `\n\nAnswers the seekers THEMSELVES marked "not helpful" today (study what failed in the DELIVERY):\n` +
    downs.map((e) => `Q: ${e.q}\nA: ${String(e.answer).slice(0, 400)}`).join("\n---\n")
  : "";

let current = { notes: [], core: [] };
try {
  const raw = JSON.parse(readFileSync(OUT, "utf8"));
  current = { notes: raw.notes || [], core: raw.core || [] };
} catch {
  /* first run */
}

try {
  const raw = await complete({
    system: `You review one day of real conversations between spiritual seekers and a voice chatbot that answers from a guru's recorded teachings. Your job is ONLY communication coaching for the bot — helping it converse like a warm, present human guide.

The bot keeps TWO tiers of self-learned lessons:
- "core": PERMANENT lessons, proven again and again across many seekers and many days. These serve every user, old or new. Core changes RARELY: promote a daily lesson into core only when it has clearly kept proving itself (it already existed in the daily list before and today's conversations confirm it again). Remove a core lesson only if today's evidence plainly contradicts it. Refine wording freely. At most 10.
- "daily": today's reactive coaching from what you see right now. Fresh each day. At most 6.

Judge across these dimensions:
- clarity & length: sentences spoken-simple, answers not lectures
- language match: seeker's language and register mirrored
- emotional attunement: did the bot notice and acknowledge feelings before answering? Where did it miss?
- conversational flow: did exchanges continue or die after one answer? Were the open doors varied and natural, or repetitive/mechanical?
- seeker verdicts: answers marked "not helpful" are your most important evidence — find the DELIVERY pattern that failed
- repetition signals: the same seeker re-asking means the answer didn't land.

STRICT rules:
- NEVER write guidelines about facts, content, teachings, or what the bot should know or claim — delivery, warmth and flow only.
- Output ONLY a JSON object, no prose: {"core": [..strings..], "daily": [..strings..]}
- If nothing needs to change in a tier, return that tier unchanged.`,
    messages: [
      {
        role: "user",
        content: `Current core (permanent) lessons:\n${JSON.stringify(current.core, null, 1)}\n\nCurrent daily lessons:\n${JSON.stringify(current.notes, null, 1)}\n\nToday: ${chats.length} conversations, ${upCount} marked helpful, ${downs.length} marked not helpful.\n\nToday's conversations:\n${sample}${feedbackBlock}`,
      },
    ],
    maxTokens: 900,
    light: true,
    retry: false,
  });
  const m = raw.match(/\{[\s\S]*\}/);
  const parsed = m ? JSON.parse(m[0]) : { core: current.core, daily: current.notes };
  const clean = (arr, max) =>
    (Array.isArray(arr) ? arr : [])
      .filter((n) => typeof n === "string" && n.trim())
      .map((n) => n.trim().slice(0, 200))
      .slice(0, max);
  const core = clean(parsed.core, 10);
  const notes = clean(parsed.daily, 6);
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        reviewed: chats.length,
        feedback: { up: upCount, down: downs.length },
        core,
        notes,
      },
      null,
      2,
    ),
  );
  console.log(`reflect: ${chats.length} conversations, ${downs.length} downvotes studied → core ${core.length} · daily ${notes.length}`);
} catch (err) {
  console.error("reflect: skipped —", err?.message);
}
