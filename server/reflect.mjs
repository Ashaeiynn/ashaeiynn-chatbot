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
      .filter((e) => e && (e.q || e.reco) && !e.testMode && new Date(e.at).getTime() > since);

const chats = entries.filter((e) => e.q && !e.feedback && !e.reco);
const votes = entries.filter((e) => e.feedback);
const recosOpened = entries.filter((e) => e.reco === "opened");
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

// ——— cross-seeker observations: counted facts about the day, computed here
// (no AI, no cost) and handed to the reviewer so its observations for the
// admin rest on real numbers, never on invention ———
const istHour = (e) => new Date(new Date(e.at).getTime() + 5.5 * 3600e3).getUTCHours();
const buckets = { "morning (5-11)": 0, "afternoon (12-16)": 0, "evening (17-21)": 0, "night (22-4)": 0 };
for (const e of chats) {
  const h = istHour(e);
  if (h >= 5 && h <= 11) buckets["morning (5-11)"]++;
  else if (h >= 12 && h <= 16) buckets["afternoon (12-16)"]++;
  else if (h >= 17 && h <= 21) buckets["evening (17-21)"]++;
  else buckets["night (22-4)"]++;
}
const knowledgeQs = chats.filter((e) => !e.chat);
const gaps = knowledgeQs.filter((e) => e.answer && !e.answer.includes("Source:"));
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const seenQ = new Map();
for (const e of knowledgeQs) seenQ.set(norm(e.q), (seenQ.get(norm(e.q)) || 0) + 1);
const repeats = [...seenQ.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
const followupTaken = chats.filter((e) => e.via === "followup").length;
const thoughtTaken = chats.filter((e) => e.via === "thought").length;
const hindiShare = chats.length ? Math.round((100 * chats.filter((e) => /[ऀ-ॿ]/.test(e.q)).length) / chats.length) : 0;
const statsBlock = `
Counted facts about today (already computed — use them, do not re-derive):
- ${chats.length} conversations (${knowledgeQs.length} knowledge questions, ${chats.length - knowledgeQs.length} small talk/greetings), ${hindiShare}% in Hindi
- activity by time of day (IST): ${Object.entries(buckets).map(([k, v]) => `${k}: ${v}`).join(", ")}
- suggested follow-up questions tapped: ${followupTaken} · "आज का विचार" explored: ${thoughtTaken} · suggested videos/articles opened: ${recosOpened.length}${recosOpened.length ? ` (${[...new Set(recosOpened.map((r) => r.title))].slice(0, 4).join(" | ")})` : ""}
- knowledge questions answered WITHOUT a source (gaps in the knowledge base): ${gaps.length}${gaps.length ? `\n  ${gaps.slice(0, 5).map((e) => e.q.slice(0, 90)).join("\n  ")}` : ""}
- questions asked more than once today: ${repeats.length ? repeats.map(([q, n]) => `"${q.slice(0, 70)}" ×${n}`).join(", ") : "none"}`;

try {
  const raw = await complete({
    system: `You review one day of real conversations between spiritual seekers and a voice chatbot that answers from a guru's recorded teachings. Your job is ONLY communication coaching for the bot — helping it converse like a warm, present human guide.

You produce TWO things each night: coaching lessons for the bot, and observations for the ADMIN.

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

Separately, write "observations" — 3 to 6 short plain-ENGLISH sentences for the ADMIN's dashboard: patterns ACROSS seekers worth a human's attention. Examples of the kind (only when the data shows them): "Most questions come in the evening", "Seekers repeatedly ask about jaap counts — consider teaching a source on it", "Suggested follow-up questions are being tapped often — the recommendation flow works", "3 questions had no source in the knowledge base today". Ground every observation in the counted facts or the conversations you actually see; never invent a pattern. These are observations about people and gaps — NEVER new teachings or interpretations.

STRICT rules:
- NEVER write guidelines about facts, content, teachings, or what the bot should know or claim — delivery, warmth and flow only.
- Output ONLY a JSON object, no prose: {"core": [..strings..], "daily": [..strings..], "observations": [..strings..]}
- If nothing needs to change in a tier, return that tier unchanged.`,
    messages: [
      {
        role: "user",
        content: `Current core (permanent) lessons:\n${JSON.stringify(current.core, null, 1)}\n\nCurrent daily lessons:\n${JSON.stringify(current.notes, null, 1)}\n\nToday: ${chats.length} conversations, ${upCount} marked helpful, ${downs.length} marked not helpful.\n${statsBlock}\n\nToday's conversations:\n${sample}${feedbackBlock}`,
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
  const observations = clean(parsed.observations, 6);
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        updated: new Date().toISOString(),
        reviewed: chats.length,
        feedback: { up: upCount, down: downs.length },
        // recommendation outcomes, counted (accepted = a seeker acted on one)
        recos: { followups: followupTaken, thought: thoughtTaken, opened: recosOpened.length },
        core,
        notes,
        observations,
      },
      null,
      2,
    ),
  );
  // the guide's growth diary: one line per night, so the admin can watch the
  // mind form over weeks (also how "since when" is known for each core lesson)
  const HIST = path.join(ROOT, "data", "learning-history.json");
  try {
    let hist = [];
    try {
      hist = JSON.parse(readFileSync(HIST, "utf8"));
    } catch {
      /* first night */
    }
    hist.push({
      date: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10),
      reviewed: chats.length,
      up: upCount,
      down: downs.length,
      recos: { followups: followupTaken, thought: thoughtTaken, opened: recosOpened.length },
      core,
      notes,
      observations,
    });
    writeFileSync(HIST, JSON.stringify(hist.slice(-90), null, 1));
  } catch {
    /* history is best-effort */
  }
  console.log(`reflect: ${chats.length} conversations, ${downs.length} downvotes studied → core ${core.length} · daily ${notes.length} · observations ${observations.length}`);
} catch (err) {
  console.error("reflect: skipped —", err?.message);
}
