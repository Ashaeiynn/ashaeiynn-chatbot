// The chatbot backend: serves the widget and answers questions.
// Usage: npm start   → http://localhost:3111
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, appendFileSync, createWriteStream, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { teachFile, teachLink, teachText, forget, publicJobs, jobTotals, clearFinished, uploadsDir } from "./teach.mjs";
import { matchCorrection, addCorrection, removeCorrection, listCorrections, DIRECT_MATCH, supersedeReview, dismissSupersede, updateCorrectionAnswer } from "./corrections.mjs";
import { bestNewerMatch } from "./retrieve.mjs";
import { addSuggestion, listSuggestions, getSuggestion, removeSuggestion, pendingCount } from "./suggestions.mjs";
import { toLatin, normalizeSpelling } from "./translit.mjs";
import { ROOT } from "./env.mjs";
import { searchMulti, formatTimestamp, thoughtCandidate, duplicateSources, knownTitles, isExcludedTitle } from "./retrieve.mjs";

// पंचांग is an enhancement, never a dependency: if the module has any problem,
// the guide simply answers without calendar awareness.
let panchangLine = () => "";
let upcomingEvents = () => [];
try {
  ({ panchangLine, upcomingEvents } = await import("./panchang.mjs"));
} catch (err) {
  console.error("panchang disabled:", err?.message);
}
// push notifications: same philosophy — never a dependency
let push = { pushReady: () => false, publicKey: () => "", addSub: () => false, removeSub: () => 0, subCount: () => 0, pushLog: () => [], sendToAll: async () => ({ sent: 0, of: 0 }), autoWhispers: async () => {} };
try {
  push = await import("./push.mjs");
} catch (err) {
  console.error("push module disabled:", err?.message);
}
import { warmup } from "./embed.mjs";
import { setAnnouncement, getAnnouncement, clearAnnouncement } from "./announce.mjs";
import { buildSystemPrompt, buildContextBlock } from "./prompt.mjs";
import { complete, PROVIDER, ACTIVE_MODEL, keyConfigured, BACKUP_CONFIGURED, failover, LlmAuthError, LlmRateLimitError } from "./llm.mjs";

// the member registry — like panchang and push, never a dependency
let users = {
  register: () => {
    throw new Error("Sign-up is unavailable right now — please try again shortly.");
  },
  touch: () => {},
  byId: () => null,
  DAILY_LIMIT: 25,
  credits: () => 0,
  addCredits: () => null,
  spendCredit: () => null,
  markDeleted: () => {},
  setFlags: () => null,
  listUsers: () => [],
};
try {
  users = await import("./users.mjs");
} catch (err) {
  console.error("users registry disabled:", err?.message);
}

const PORT = Number(process.env.PORT || 3111);
const FALLBACK =
  process.env.FALLBACK_MESSAGE ||
  "I don't have that information in our video library yet. Please contact us directly.";
const FALLBACK_HI = "मेरे पास अभी वीडियो लाइब्रेरी में यह जानकारी उपलब्ध नहीं है। कृपया हमसे सीधे संपर्क करें।";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
// Credit system paused (owner's call — will implement later). While off: no
// charging, no out-of-credits block, no balance in responses. All the credit
// code stays intact; flip this to true to re-enable instantly.
// Daily question allowance (users.mjs DAILY_LIMIT). OFF since 2026-07-22 (owner —
// "remove for now, will ask when needed"): seekers ask freely, nobody is gated,
// counted, or charged; the 🪙 balance never shows. Flip to true to restore it.
const CREDITS_ON = false;
const MAX_HISTORY_TURNS = 6;

const apiKeyConfigured = keyConfigured;

// On the studio Mac: hold off sleep for as long as this server runs, so long
// study batches never pause. (No effect anywhere else.)
if (process.platform === "darwin" && existsSync("/usr/bin/caffeinate")) {
  try {
    spawn("/usr/bin/caffeinate", ["-is", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort */
  }
}
// Speech recognition (the widget's mic, the app's own, or /api/stt) mishears
// brand words — spoken "गुरुदेव" arrives as "गुरुवार" (Thursday). Fix the known
// ones so retrieval finds the right teachings. Keep in step with widget.js.
const MISHEARD = [
  [/गुरुवार/g, "गुरुदेव"],
  [/\bguru\s?[vw]aa?r\b/gi, "Gurudev"],
  [/\bg[iu]r[uo]\s?dev\b/gi, "Gurudev"],
  [/गिरुदेव|गीरुदेव/g, "गुरुदेव"],
  [/[अआ]शा\s?[ईइय]{1,2}न/g, "Ashaeiynn"],
  // Hindi-mode inventions, seen live 2026-07-24 evening: "आशाई के महुत सब" for
  // "Ashaeiynn के महोत्सव". आशाई only when NOT the start of आशाईन (that longer
  // form is handled above first). NOTE: JS \b doesn't work on Devanagari — these
  // patterns rely on explicit context, not word boundaries.
  [/आशाई(?![नयी])/g, "Ashaeiynn"],
  [/महुत\s*सब|महुत्सव|महोत्सब|महोत\s+सव/g, "महोत्सव"],
  [/\basha\s?[eiy]{1,3}nn?\b/gi, "Ashaeiynn"],
  // Whisper-in-English inventions for the brand name, all seen live 2026-07-24:
  // "Aashany", "Ashaan", "Aashay", "Ashyam". Word-bounded, explicit alternations
  // only — ordinary English words must never be touched.
  [/\b(?:aa?shaa?ny?|aa?shaa?y|ash[iy]am)\b/gi, "Ashaeiynn"],
  [/\bbog\b/gi, "bhog"], // "offer bog and hawan" — no seeker asks this bot about swamps
  [/\b(in|offer|perform|during)\s+haven\b/gi, "$1 hawan"], // "offer in haven" (ritual context only)
  [/\bmah[ao]tsa[vw]\b/gi, "Mahotsav"],
  [/पाठ\s+शाला/g, "पाठशाला"],
  [/\bpath\s+shala\b/gi, "Pathshala"],
  [/\bpar[ie]{0,2}ksh[ie]+t\b/gi, "Parikshit"],
];
const fixMishearings = (t) => MISHEARD.reduce((s, [re, ok]) => s.replace(re, ok), t);

// ——— the ear's daily meter (owner, 2026-07-25) ———
// Groq's free tier allows ~2,000 transcription REQUESTS per day (IST reset for
// our purposes). Count every request we actually send so /health (and the admin)
// can show how close the bot is to the cap — the TTS quota once ran out silently
// and broke voice mid-answer; the ear must never surprise us the same way.
// Persisted to disk (gitignored) so restarts don't reset the day's count.
const STT_USAGE_FILE = path.join(ROOT, "data", "stt-usage.json");
const STT_FREE_LIMIT = 2000;
let sttUsage = { day: "", count: 0, days: {} };
try {
  const saved = JSON.parse(readFileSync(STT_USAGE_FILE, "utf8"));
  if (saved && typeof saved === "object") sttUsage = { day: "", count: 0, days: {}, ...saved };
} catch {
  /* first run — starts fresh */
}
const istDayStr = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
function bumpSttUsage() {
  const d = istDayStr();
  if (sttUsage.day !== d) {
    if (sttUsage.day) sttUsage.days[sttUsage.day] = sttUsage.count;
    for (const k of Object.keys(sttUsage.days).sort().slice(0, -14)) delete sttUsage.days[k]; // keep 2 weeks
    sttUsage.day = d;
    sttUsage.count = 0;
  }
  sttUsage.count++;
  if (sttUsage.count === Math.floor(STT_FREE_LIMIT * 0.75))
    console.warn(`ear usage: ${sttUsage.count} transcriptions today — 75% of Groq's free ${STT_FREE_LIMIT}/day. Time to move Groq to paid (≈1 paisa/question).`);
  try {
    writeFileSync(STT_USAGE_FILE, JSON.stringify(sttUsage));
  } catch {
    /* disk is best-effort — the in-memory count still serves /health */
  }
}
const sttUsedToday = () => (sttUsage.day === istDayStr() ? sttUsage.count : 0);

// ——— conversation-aware listening (owner, 2026-07-25) ———
// The widget sends the seeker's recent questions with each clip. We scan them
// for SPECIAL Ashaeiynn vocabulary only (whitelist below — never arbitrary
// conversation words) and hint the ear with up to 3 such terms, so a seeker
// deep in a गुप्त नवरात्रि conversation gets that spelling recognised. Clear
// speech always overrides a hint; hints only settle ambiguous sounds. Raw
// topics are used for this one request and never stored.
const SPECIAL_TERMS = [
  ["गुप्त नवरात्रि", /गुप्त\s*नवरात|gupt\s*navrat/i],
  ["सिया तत्व", /सिया\s*तत्|siya\s*tat/i],
  ["राम तत्व", /राम\s*तत्|ram\s*tat/i],
  ["गुरु तत्व", /गुरु\s*तत्|guru\s*tat/i],
  ["कल्याण लोक", /कल्याण\s*लोक|kalyan\s*lok/i],
  ["त्राटक", /त्राटक|tratak/i],
  ["तीसरी आँख", /तीसरी\s*आँख|तीसरी\s*आंख|third\s*eye/i],
  ["पितृ", /पितृ|पितर|pitru|pitra/i],
  ["कुलदेवता", /कुलदेव|kuldev/i],
  ["हनुमान चालीसा", /हनुमान\s*चालीसा|hanuman\s*chalisa/i],
];
function topicHint(topics) {
  const seen = [];
  for (const t of topics) {
    for (const [term, re] of SPECIAL_TERMS) {
      if (!seen.includes(term) && re.test(t)) seen.push(term);
      if (seen.length >= 3) return seen;
    }
  }
  return seen;
}

// ——— the doubtful-hearings review list (owner, 2026-07-25) ———
// Whisper reports how sure it was (avg_logprob / no_speech_prob per segment).
// Transcriptions it wasn't sure about land here — the admin shows them so every
// seeker's mishearing can become a taught correction, not just the ones the
// owner personally hits. Text only, never audio; last 50; gitignored.
const STT_REVIEW_FILE = path.join(ROOT, "data", "stt-review.json");
let sttReview = [];
try {
  const saved = JSON.parse(readFileSync(STT_REVIEW_FILE, "utf8"));
  if (Array.isArray(saved)) sttReview = saved;
} catch {
  /* starts empty */
}
function noteDoubtfulHearing(entry) {
  sttReview.push(entry);
  if (sttReview.length > 50) sttReview = sttReview.slice(-50);
  try {
    writeFileSync(STT_REVIEW_FILE, JSON.stringify(sttReview));
  } catch {
    /* best-effort */
  }
}

// Owner's link policy: seekers are only ever sent to OUR public channels —
// the YouTube channel and ashaeiynn.com (Pathshala articles + site pages).
// Everything else (Vimeo studio videos, Zoom recordings, raw audio) remains
// citable by title but never clickable. Address-book links are already ours.
const publicUrl = (u) => (u && /youtube\.com|youtu\.be|ashaeiynn\.com/i.test(String(u)) ? u : null);

// A bare greeting is a greeting — never an opening to teach. Detected here in
// code rather than left to the model's judgement, because the model kept
// treating "जय सिया राम" as a knowledge question and answering with a whole
// teaching + source. A match skips retrieval, skips पंचांग, and asks for one
// short line back (see handleChat).
// Cross-language search leans on translating the question, so the same question
// asked twice should not pay for it twice (see the translation block below).
const translationCache = new Map();
// first-name → m/f/u for the guide's spoken welcome (see GET /api/gender)
const genderCache = new Map();

const GREETING_ONLY =
  /^\s*(jai?\s*(shree\s*|shri\s*)?(siya\s*|sita\s*)?ram(\s*ji)?|जय\s*(श्री\s*)?(सिया\s*|सीता\s*)?राम(\s*जी)?|जय\s*सियाराम|जय\s*गुरुदेव|राधे\s*राधे|नमस्ते|नमस्कार|प्रणाम|राम\s*राम|हेलो|हाय|namaste|hello|hi|hey|good\s*(morning|afternoon|evening|night))\s*[!.,\s🙏]*$/i;

// "हाँ", "ठीक है", "achha", "ok" — the seeker is simply agreeing with what was
// just said, not asking anything. Left to the model this became a whole fresh
// teaching with sources, and it wandered off the topic they were actually on
// (owner, 2026-07-18: two questions about सिद्धि, then "हां ठीक है" → an
// unrelated answer about साधना rules). Caught in code like the greeting.
const ACK_WORD =
  "(?:जी|हाँ|हां|ठीक\\s*है|ठीक|अच्छा|सही\\s*है|समझ\\s*(?:गया|गयी|गई)|ओके|हम्म+|बस|धन्यवाद|शुक्रिया|thank\\s*you|thanks|ok(?:ay)?|sure|yes|yeah|yep|right|fine|got\\s*it|understood|hmm+)";
const ACK_ONLY = new RegExp(`^\\s*(?:${ACK_WORD}[\\s,!.।]*){1,3}[!.,।\\s\u{1F64F}\u{1F60A}\u{1F44D}]*$`, "iu");

// Answering the guide's OWN question in the negative — "मैं साधना नहीं कर रहा",
// "अभी नहीं", "समझ नहीं आया". The guide asked "साधना कैसी चल रही है?", the seeker
// said they are not doing one, and the bot replied with a teaching about साधना
// (owner, 2026-07-19). A negation is a reply, not a request to be taught the
// very thing they just said they are NOT doing.
// NOTE: \b is ASCII-only in JavaScript, so it never matches next to Devanagari —
// the first version of this matched nothing in Hindi at all. And bare "ना" needs
// boundaries of its own, or it fires inside साध-ना.
const NEGATION = /नहीं|नही|नईं|(?:^|[\s,।])(?:ना|मत)(?:[\s,।!?]|$)|\b(?:no|not|nope|nahi|nahin)\b/i;
const INTERROGATIVE = /\?|क्या|कैसे|कब|क्यों|कौन|कहाँ|कितन|बताइए|बताओ|\bwhat\b|\bhow\b|\bwhy\b|\bwhen\b|\bwho\b|\bwhere\b|\bwhich\b|\btell me\b/i;

// "बताइए", "क्या करूँ?", "help me" — a message that names nothing to answer.
// Caught in code like the greeting, because asking the model to notice its own
// confusion did NOT hold (measured 2026-07-18: rule 7d alone still produced
// 80-90 words of general spiritual advice before getting round to the question).
// Only applies to an opening message — mid-conversation these are clear from
// context ("क्या करूँ?" after an answer means "about that").
const UNCLEAR_ONLY =
  /^\s*(कुछ\s*)?(बताइए|बताइये|बताओ|बताएं|बतायें|मदद\s*(कीजिए|करिए|करो)?|हेल्प|(मुझे\s*)?(कुछ\s*)?समझ\s*नहीं\s*आ\s*(रहा|रही|रहा है)|कुछ\s*समझ\s*नहीं\s*आता|(मैं\s*)?क्या\s*(करूँ|करुँ|करू|करु|करें|करूं)|(मेरी\s*)?समस्या\s*है|(मैं\s*)?परेशान\s*हूँ|help(\s*me)?|please\s*help|i\s*need\s*help|guide\s*me|tell\s*me|can\s*you\s*help(\s*me)?)\s*[?।!.\s🙏]*$/i;

// A mentor referral belongs to a seeker's own circumstances — health, fear, a
// crisis, their specific condition — NOT to a teaching question. The MEMBER note
// carried "send them to their mentor" on every single request, so the bot closed
// almost every answer with it (owner, 2026-07-18).
const PERSONAL_ASK =
  /मेरी\s*(समस्या|तकलीफ़?|परेशानी|बीमारी|हालत|पत्नी|माँ|बेटी|बेटा)|मेरे\s*(पति|पिता|घर\s*में)|मुझे\s+(?:\S+\s+){0,2}(डर|तनाव|बीमारी|दिक्कत|परेशानी|तकलीफ़?|घबराहट)|बीमार|इलाज|दवा|अस्पताल|डिप्रेशन|अवसाद|घबराहट|काला\s*जादू|तंत्र[\s-]?मंत्र\s*किया|ऊपरी\s*हवा|नज़र\s*लग|टोना|आत्महत्या|जीना\s*नहीं|मेरे\s*साथ\s*(ऐसा|बुरा)|my\s+(problem|health|illness|disease|condition|wife|husband|son|daughter|family|situation)|i\s*am\s*(sick|ill|suffering|depressed|scared|afraid|not\s*well)|black\s*magic|depress|anxiety|suicid|panic\s*attack/i;

// A seeker speaking TO the guide as though it were Bhaiya himself — "भैया आप
// हमारी तारीफ़ कर रहे हो?". Rare (they know they are talking to his helper), but
// when it happens the model slips into his first person and answers AS him,
// which the guide must never do. Adjacency matters: "भैया कहते हैं आप ध्यान
// करें" is ABOUT him and must not trigger this.
const ADDRESSED_AS_BHAIYA =
  // NOTE: no \b — it is ASCII-only in JS and never matches beside Devanagari
  /(?:भैया|भइया|bhaiya)\s*(?:जी|ji)?[,\s]*(?:आप|तुम|aap|tum)|(?:आप|तुम)\s*(?:भैया|bhaiya)/i;

// "mera credits kb renew hoga", "कितने प्रश्न बचे हैं?" — about the APP, not the
// teachings. The search has nothing for these, so the server answers them itself.
const QUOTA_ASK =
  /\bcredits?\b|क्रेडिट|\bquota\b|कोटा|(?:कितने|kitne)\s*(?:प्रश्न|सवाल|prashn|sawaal|question)|(?:प्रश्न|सवाल|sawaal|question)[^।.?!]{0,14}(?:बचे|बाकी|शेष|bache|baaki|left|remaining)|(?:renew|रिन्यू|रीन्यू)|(?:कब|kab)[^।.?!]{0,14}(?:मिलेंगे|मिलेगा|milenge|milega)[^।.?!]{0,14}(?:प्रश्न|सवाल|prashn|sawaal)/i;

// Two very different asks about the same साधना (owner's rule, 2026-07-18):
//   "सिया तत्व साधना क्या है?"      → teach WHAT it is, its meaning and benefit
//   "इसके नियम क्या हैं?"            → the निर्देश — MEMBERS ONLY
// Left to the model (and to embedding similarity alone) both scored the same and
// every question got the food-rules answer. Decided here in code instead.
// RULES wins when a question matches both ("नियम क्या हैं" is a rules question).
// Hindi, Devanagari AND Hinglish — plenty of seekers type "khane ka samay".
// STRONG = unmistakably a how-to.
const RULES_STRONG =
  /नियम|निर्देश|विधि|तरीक|परहेज|पालन|सावधान|कैसे\s*(कर|करूँ|करुँ|शुरू)|कब\s*कर|कितने\s*दिन|कितनी\s*बार|कितना\s*जाप|\b(niyam|nirdesh|vidhi|tarika|parhez)\b|\bkitn[ei]\s+(din|baar|bar)\b|\bkaise\s+(kar|karu|karun|shuru)|\bkab\s+kar|\brules?\b|instruction|guideline|method|procedure|steps?\b|timing|\bdiet\b|how (do|to|should|can) (i|we|one)/i;
// SOFT = food/time words. These mean "how do I do it" in a practice question, but
// NOT when the seeker is asking what something means ("व्रत का महत्व क्या है?").
const RULES_SOFT =
  /खान[ेा]|भोजन|आहार|नमक|दूध|व्रत|उपवास|समय|टाइम|\b(khana|khane|bhojan|aahar|namak|doodh|dudh|vrat|upvas|samay)\b|what.*\b(eat|avoid|food|drink)\b|\bfast(ing)?\b/i;
const MEANING_ASK =
  /महत्व|महत्त्व|फ़?ायद|लाभ|मतलब|अर्थ|क्यों|उद्देश्य|के\s*बारे|\b(mahatva|fayda|faayda|labh|matlab)\b|benefit|meaning|purpose|significance|importance|\bwhy\b|tell me about/i;
const ABOUT_ASK = /क्या\s*(है|हैं|होती|होता|हो)|\bkya\s*(hai|h)\b|what\s+(is|are|does)|about (the|this)/i;
const isRulesQ = (t) => RULES_STRONG.test(t) || (RULES_SOFT.test(t) && !MEANING_ASK.test(t));
// The members-only gate covers a SĀDHANĀ's निर्देश — not every how-to. "ध्यान कैसे
// करें?" is Bhaiya's open teaching (it is on the YouTube channel) and must stay
// open to a newcomer; "इस साधना के नियम" is what belongs to the family.
const SADHANA_TOPIC =
  /साधना|साधनाएँ|अनुष्ठान|दीक्षा|नवरात्रि|सिया\s*तत्व|राम\s*तत्व|हवन|जाप|मंत्र\s*(जप|जाप|सिद्ध)|\b(sadh?ana|sadhna|anushthan|deeksha|diksha|navratri|navratra|siya\s*tatt?[vw]a|ram\s*tatt?[vw]a|hawan|havan|jaap)\b/i;

// ——— the address book (data/links.json): channels & standing pages the bot
// can hand out when a seeker asks for a link. Re-read every 10 minutes.
const LINK_ASK =
  /\b(link|url|share|instagram|insta|reels?|youtube|channel|website|facebook|fb)\b|लिंक|लींक|इंस्टाग्राम|इंस्टा|रील|यूट्यूब|चैनल|वेबसाइट|फेसबुक|पाठशाला|pathshala/i;
let linksCache = { at: 0, links: [] };
function linkDirectory() {
  if (Date.now() - linksCache.at < 600_000) return linksCache.links;
  let links = [];
  try {
    links = JSON.parse(readFileSync(path.join(ROOT, "data", "links.json"), "utf8")).links || [];
  } catch {
    /* no address book */
  }
  linksCache = { at: Date.now(), links };
  return links;
}
function matchLinks(message) {
  const m = message.toLowerCase();
  return linkDirectory()
    .filter((l) => Array.isArray(l.keywords) && l.keywords.some((k) => m.includes(String(k).toLowerCase())))
    .slice(0, 3);
}

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const LIBRARY_KEY = process.env.LIBRARY_KEY || ""; // second lock: the Library tab
const APP_KEY = process.env.APP_KEY || ""; // shared secret: the main app enrols its users

// One JSON line per question (question, answer, retrieval) — reviewed in the
// admin portal at /admin. Written under LOG_DIR rather than the repo's own
// data/ folder so it survives redeploys: on Render, data/ is rebuilt fresh
// from the git image on every deploy, but a mounted persistent Disk (set
// LOG_DIR to its mount path) keeps this file across restarts. Defaults to
// data/ for local dev, where the repo folder itself is already persistent.
const LOG_DIR = process.env.LOG_DIR || path.join(ROOT, "data");
const QUESTIONS_LOG = path.join(LOG_DIR, "questions.log");
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* best effort — writeLog already tolerates a missing/unwritable dir */
}

function writeLog(entry) {
  try {
    appendFileSync(QUESTIONS_LOG, JSON.stringify(entry) + "\n");
  } catch {
    /* logging must never break answering */
  }
}

// Simple per-IP rate limit: 20 questions per 5 minutes (override via RATE_LIMIT_MAX).
const RATE_LIMIT = { windowMs: 5 * 60 * 1000, max: Number(process.env.RATE_LIMIT_MAX || 20) };
const hits = new Map();
// Buckets keep features from starving each other: one spoken answer costs a
// chat call + an stt call + several tts chunks — with one shared bucket, a
// few questions in a row 429'd the mic ("आवाज़ समझी नहीं जा सकी (server)").
function rateLimited(ip, bucket = "general", max = RATE_LIMIT.max) {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(key, list);
  return false;
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

// ——— natural voice (optional) ———
// Best: ELEVENLABS_API_KEY (can be Bhaiya's cloned voice). Otherwise Gemini's
// natural TTS voices ride on the same free GEMINI_API_KEY. Without either, the
// widget falls back to the browser's built-in voice automatically.
const TTS_KEY = process.env.ELEVENLABS_API_KEY || "";
const TTS_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // multilingual premade voice
const TTS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
// The voice (TTS) can ride on its OWN Gemini key so it can be BILLED for
// unlimited use while the ANSWERS stay on the free-tier GEMINI_API_KEY. Set
// GEMINI_TTS_KEY in .env to a billing-enabled key; leave it unset and TTS shares
// the free chat key exactly as before (owner, 2026-07-21).
const GEMINI_TTS_KEY = process.env.GEMINI_TTS_KEY || process.env.GEMINI_API_KEY || "";
// Each TTS model has its own tiny free-tier daily quota (10/day) — chain two so
// the natural voice lasts twice as long before the browser voice takes over.
const GEMINI_TTS_MODELS = (
  process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Charon"; // deep, warm male
// Sarvam Bulbul — India-native Hindi/Hinglish voice (billed in ₹). When its key is
// present it is the guide's natural voice, ahead of Gemini. Swap the voice with
// SARVAM_VOICE (male options: shubh, aditya, rohan, dev, ratan, anand, karun…).
const SARVAM_KEY = process.env.SARVAM_API_KEY || "";
const SARVAM_VOICE = process.env.SARVAM_VOICE || "shubh";
const SARVAM_MODEL = process.env.SARVAM_MODEL || "bulbul:v3";
const SARVAM_PACE = Number(process.env.SARVAM_PACE || 1.0);
// Master switch for the paid/natural voice. Set NATURAL_TTS=off to serve NO
// server voice at all — /health reports naturalVoice:false so the widget speaks
// with the seeker's own device voice everywhere. Used while the free Gemini TTS
// quota is exhausted: it stops the 429 storm and the broken half-spoken answers
// (first sentence natural, then a gap, then the device voice clipping its start).
const NATURAL_TTS = (process.env.NATURAL_TTS || "on").toLowerCase() !== "off";

// Gemini TTS returns headerless PCM; browsers need a WAV (RIFF) header in front.
function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); // byte rate (16-bit mono)
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function geminiTts(text) {
  let lastErr;
  for (const model of GEMINI_TTS_MODELS) {
    try {
      return await geminiTtsModel(model, text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function geminiTtsModel(model, text) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_TTS_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Say warmly and gently, like a caring elder brother guiding an aspirant (Hindi text is spoken in natural conversational Hindi): ${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } },
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error("gemini tts: no audio in response");
  const rate = Number(/rate=(\d+)/.exec(inline.mimeType || "")?.[1] || 24000);
  return pcmToWav(Buffer.from(inline.data, "base64"), rate);
}

// Sarvam Bulbul — returns a complete WAV as base64 in `audios[0]`. The guide's
// answer is Devanagari for Hindi/Hinglish and Latin for English, so the target
// language is read off the script (hi-IN handles code-mixed Hinglish too).
async function sarvamTts(text) {
  const lang = /[ऀ-ॿ]/.test(text) ? "hi-IN" : "en-IN";
  const r = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": SARVAM_KEY },
    body: JSON.stringify({
      text,
      target_language_code: lang,
      speaker: SARVAM_VOICE,
      model: SARVAM_MODEL,
      pace: SARVAM_PACE,
      enable_preprocessing: true,
    }),
  });
  if (!r.ok) throw new Error(`sarvam tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const b64 = d.audios?.[0];
  if (!b64) throw new Error("sarvam tts: no audio in response");
  return Buffer.from(b64, "base64"); // already a RIFF/WAV, browser-playable as-is
}

async function handleTts(req, res) {
  if (!NATURAL_TTS) return json(res, 501, { error: "tts-disabled" }); // device voice only
  if (!TTS_KEY && !GEMINI_TTS_KEY && !SARVAM_KEY) return json(res, 501, { error: "tts-not-configured" });
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip, "tts", 80)) return json(res, 429, { error: "Too many requests." });

  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 20_000) return json(res, 413, { error: "Text too long." });
  }
  let text = "";
  try {
    text = String(JSON.parse(body).text ?? "").trim().slice(0, 1500);
  } catch {
    return json(res, 400, { error: "Invalid JSON." });
  }
  if (!text) return json(res, 400, { error: "Empty text." });

  // Sarvam is the owner's chosen voice (India-native, Hindi/Hinglish, ₹-billed).
  // On any Sarvam hiccup we fall through to Gemini so the guide still speaks.
  if (SARVAM_KEY) {
    try {
      const wav = await sarvamTts(text);
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store",
      });
      return res.end(wav);
    } catch (err) {
      console.error("sarvam tts error:", err?.message);
      if (!GEMINI_TTS_KEY && !TTS_KEY) return json(res, 502, { error: "tts-failed" });
      // else: fall through to the Gemini / ElevenLabs paths below
    }
  }

  // No ElevenLabs key → Gemini's natural voice (same free key as the answers).
  if (!TTS_KEY) {
    try {
      const wav = await geminiTts(text);
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Cache-Control": "no-store",
      });
      return res.end(wav);
    } catch (err) {
      console.error("tts error:", err?.message);
      return json(res, 502, { error: "tts-failed" }); // widget falls back to browser voice
    }
  }

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(TTS_VOICE)}?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: { "xi-api-key": TTS_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: TTS_MODEL,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 },
        }),
      },
    );
    if (!r.ok) {
      console.error("tts error:", r.status, (await r.text()).slice(0, 200));
      return json(res, 502, { error: "tts-failed" });
    }
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Cache-Control": "no-store",
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("tts error:", err?.message);
    json(res, 502, { error: "tts-failed" });
  }
}

async function handleChat(req, res) {
  const t0 = Date.now();
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip, "chat", RATE_LIMIT.max)) {
    return json(res, 429, { error: "Too many messages — please wait a few minutes." });
  }

  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 50_000) return json(res, 413, { error: "Message too long." });
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "Invalid JSON." });
  }

  const message = fixMishearings(String(payload.message ?? "").trim().slice(0, 2000));
  if (!message) return json(res, 400, { error: "Empty message." });
  const wantsLink = LINK_ASK.test(message);
  const isGreeting = GREETING_ONLY.test(message) && message.trim().split(/\s+/).length <= 6;

  // Recent conversation history from the widget (kept short on purpose).
  const history = Array.isArray(payload.history)
    ? payload.history
        .slice(-MAX_HISTORY_TURNS * 2)
        .filter(
          (m) =>
            (m?.role === "user" || m?.role === "assistant") &&
            typeof m?.content === "string" &&
            m.content.trim(),
        )
        .map((m) => ({ role: m.role, content: m.content.slice(0, 700) }))
    : [];

  // An opening message that names nothing to answer: ask what they want to know
  // rather than filling the silence with general teaching (owner, 2026-07-18).
  const isUnclear =
    !isGreeting && UNCLEAR_ONLY.test(message) && !history.some((m) => m.role === "user");
  // A short "no" in reply to the guide's own question — never a question itself.
  const isNegativeReply = (() => {
    if (isGreeting || isUnclear) return false;
    if (!NEGATION.test(message) || INTERROGATIVE.test(message)) return false;
    if (message.trim().split(/\s+/).length > 12) return false;
    return history.some((m) => m.role === "assistant");
  })();

  // Only an acknowledgement if there is something to acknowledge.
  const isAck =
    !isGreeting &&
    !isUnclear &&
    ACK_ONLY.test(message) &&
    message.trim().split(/\s+/).length <= 5 &&
    history.some((m) => m.role === "assistant");

  // Personal-guide context card from the visitor's OWN device (widget diary or
  // the app). Used once for this answer, never stored — the server keeps no
  // per-person memory by design.
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : null;
  // Everyone who uses the bot is an Ashaeiynn member now (owner, 2026-07-22) — so
  // the guide always treats them as family: it never pitches a screening or
  // "join Ashaeiynn", and points to their own mentor/contact instead of a sign-up.
  let seekerMember = true;
  let seekerWho = ""; // who asked — shown beside the question in the admin
  const seekerUid = typeof profile?.uid === "string" ? profile.uid.slice(0, 30) : "";
  let seekerCredits = null; // null = anonymous/test caller (never charged)
  try {
    const u = users.touch(seekerUid);
    // membership is universal now — the registry no longer downgrades anyone
    // Prefer the registry's name (it survives a rename on their device); fall
    // back to what the app sent. Recorded per question so the admin can see who
    // asked what — the log already holds the question and the answer, and it
    // lives only on the VPS, never in git.
    seekerWho = String(u?.nick || u?.name || profile?.name || "").trim().slice(0, 60);
    // pay-as-you-use balance (persistent; admin tops it up). Left null while the
    // credit system is paused → the gate, the deduction, and the balance-in-
    // response below all treat this caller as uncharged.
    if (u && CREDITS_ON) seekerCredits = users.credits(seekerUid);
  } catch {
    /* registry is best-effort */
  }
  const seekerName = typeof profile?.name === "string" ? profile.name.trim().slice(0, 40) : "";
  const seekerSummary = typeof profile?.summary === "string" ? profile.summary.trim().slice(0, 300) : "";
  const seekerStyle = typeof profile?.style === "string" ? profile.style.trim().slice(0, 160) : "";
  // "मैं कोई गुरुतत्व साधना नहीं कर रहा हूँ" — a seeker telling the guide they do
  // NOT do a practice. The guide remembers a declared practice on their device
  // and asserts it in later answers ("आपकी गुरु तत्व साधना के मार्ग पर…"), so
  // denying it has to actually FORGET it — acknowledging it for one turn is not
  // enough (a member said so and the bot kept it up, 2026-07-19).
  // The denial must be about DOING the practice — not about something that
  // happened inside it. "आज साधना में मन नहीं लगा" is a seeker confiding a hard
  // day; forgetting their practice over that would be the opposite of listening
  // (caught in testing, 2026-07-19). So the negation has to sit next to a doing
  // verb, or the seeker has to say they stopped.
  const NOT_DOING =
    /(?:साधना|साधन|अभ्यास|जाप)[^।.?!]{0,24}नहीं\s*(?:कर|करता|करती|करते|करूँ|करुँ|कर\s*रह)|नहीं\s*(?:कर|करता|करती|करते|कर\s*रह)[^।.?!]{0,24}(?:साधना|साधन|अभ्यास|जाप)|कोई\s*(?:साधना|अभ्यास|जाप)\s*नहीं|(?:साधना|अभ्यास|जाप)[^।.?!]{0,20}(?:छोड़|बंद\s*कर|रोक)\s*(?:दी|दिया|दिये|दिए)|\b(?:not|don'?t|do\s*not|no\s*longer)\s+(?:doing|do|practis\w*|following)\b[^.?!]{0,24}\b(?:sadh?na|sadhana|practice|jaap)\b|\bno\s+(?:sadh?na|sadhana|practice)\b|\b(?:stopped|quit|left)\s+(?:my\s+)?(?:sadh?na|sadhana|practice|jaap)\b/i;
  const deniesHere = (t) => NOT_DOING.test(t);
  // Look at what the seeker has said RECENTLY, not only this message. Soni denied
  // her practice once and the guide kept asserting it, because the denial only
  // cleared the memory if it happened to be the current message. Her own recent
  // questions and turns travel with every request, so an earlier denial can undo
  // the stored practice by itself — no waiting for her to repeat herself.
  const recentlySaid = [
    message,
    ...history.filter((m) => m.role === "user").slice(-3).map((m) => m.content),
    ...(Array.isArray(profile?.topics) ? profile.topics.slice(-5) : []),
  ].filter((t) => typeof t === "string");
  const deniesPractice = !isGreeting && recentlySaid.some(deniesHere);

  const seekerSadhana =
    !deniesPractice && profile?.sadhana && typeof profile.sadhana.name === "string"
      ? { name: profile.sadhana.name.trim().slice(0, 120), since: String(profile.sadhana.since || "").slice(0, 20) }
      : null;
  // first question of a fresh session: where did the LAST conversation end?
  const leftover =
    profile?.leftover && typeof profile.leftover.q === "string" && profile.leftover.q.trim()
      ? { q: profile.leftover.q.trim().slice(0, 120), when: String(profile.leftover.when || "").slice(0, 30) }
      : null;
  const recentTopics = (Array.isArray(profile?.topics) ? profile.topics : [])
    .filter((t) => typeof t === "string" && t.trim())
    .slice(-8)
    .map((t) => t.trim().slice(0, 120));
  const seenTitles = new Set(
    (Array.isArray(profile?.seen) ? profile.seen : [])
      .filter((t) => typeof t === "string")
      .slice(-80)
      .map((t) => t.trim().toLowerCase()),
  );

  // Detect the QUESTION's language early — it decides reply language everywhere
  // below. Romanized-Hindi (Hinglish) counts as Hindi; when SPOKEN, the widget's
  // mic language wins (speech recognition may write Hindi speech in Latin letters).
  const spokenHindi =
    payload.via === "voice" && String(payload.lang || "").toLowerCase().startsWith("hi");
  const isDevanagari = /[ऀ-ॿ]/.test(message);
  const hinglishHits = (message.toLowerCase().match(/\b(kya|kaun|kaise|kyu|kyon|kab|kahan|batao|bataiye|mujhe|humko|nahi|nahin|hota|hoti|hai|hain|karna|kare|krna|wala|wali|bhejo|bhej|matlab)\b/g) || []).length;
  const wantsHindi = spokenHindi || isDevanagari || hinglishHits >= 1;

  // Out of credits → a warm stop BEFORE spending any AI. Only registered
  // seekers with a real balance are gated; anonymous/test callers pass through.
  if (seekerUid && seekerCredits !== null && seekerCredits <= 0) {
    // The allowance renews tomorrow, so say that — "finished" would read as a
    // door closing on a seeker mid-journey.
    const outMsg = wantsHindi
      ? `🙏 आज के आपके ${users.DAILY_LIMIT} प्रश्न पूरे हो गए। कल फिर से ${users.DAILY_LIMIT} प्रश्न मिल जाएँगे — तब तक जो सुना है, उस पर थोड़ा ठहरिए। ज़रूरी बात हो तो Ashaeiynn team से संपर्क कीजिए।`
      : `🙏 That's all ${users.DAILY_LIMIT} of today's questions. Your ${users.DAILY_LIMIT} come back tomorrow — until then, sit a little with what you've heard. If something is urgent, do reach out to the Ashaeiynn team.`;
    const contact = linkDirectory().filter((l) => l.title === "Contact Ashaeiynn").map((l) => ({ title: l.title, timestamp: "", url: l.url }));
    writeLog({ at: new Date().toISOString(), q: message, via: payload.via, ...(seekerWho ? { who: seekerWho } : {}), noCredits: true });
    return json(res, 200, { answer: outMsg, sources: contact, credits: 0, noCredits: true });
  }

  // A question about THE APP ITSELF, not about the teachings — "mera credits kb
  // renew hoga". The bot only knows Bhaiya's teachings, so it had nothing to say
  // and answered about something else entirely (owner, 2026-07-19). The server
  // knows the real numbers, so it answers directly rather than searching.
  if (CREDITS_ON && QUOTA_ASK.test(message)) {
    const limit = users.DAILY_LIMIT ?? 25;
    // the allowance turns over at midnight India time
    const nowIst = new Date(Date.now() + 5.5 * 3600e3);
    const hrs = Math.max(1, 24 - nowIst.getUTCHours());
    // The daily part resets; an admin-granted bonus carries forward until used —
    // so the honest answer depends on whether this seeker holds a bonus.
    let bal = null;
    if (seekerUid && seekerCredits !== null) {
      try {
        bal = users.balance(seekerUid);
      } catch {
        /* fall back to the plain daily message */
      }
    }
    const left = seekerCredits;
    let quotaMsg;
    if (bal && bal.bonus > 0) {
      quotaMsg = wantsHindi
        ? `अभी आपके पास कुल ${bal.left} प्रश्न हैं — ${bal.dailyLeft} आज के और ${bal.bonus} अतिरिक्त (Ashaeiynn team की ओर से)। रोज़ के ${limit} प्रश्न हर रात 12 बजे (भारतीय समय) फिर से पूरे हो जाते हैं, यानी लगभग ${hrs} घंटे में; आपके ${bal.bonus} अतिरिक्त प्रश्न तब तक बने रहेंगे जब तक आप उन्हें इस्तेमाल न कर लें।`
        : `You have ${bal.left} questions right now — ${bal.dailyLeft} of today's and ${bal.bonus} extra from the Ashaeiynn team. The daily ${limit} refill at midnight India time (about ${hrs} hour${hrs > 1 ? "s" : ""} from now); your ${bal.bonus} extra stay with you until you use them.`;
    } else {
      quotaMsg = wantsHindi
        ? `${left === null ? `हर दिन ${limit} प्रश्न मिलते हैं` : `आज आपके पास ${left} प्रश्न बचे हैं`} — और हर रात 12 बजे (भारतीय समय) यह फिर से पूरे ${limit} हो जाते हैं, यानी लगभग ${hrs} घंटे में। रोज़ की गिनती नई शुरू होती है।`
        : `${left === null ? `You get ${limit} questions a day` : `You have ${left} questions left today`} — they go back up to ${limit} at midnight India time, about ${hrs} hour${hrs > 1 ? "s" : ""} from now. Each day starts fresh.`;
    }
    writeLog({
      at: new Date().toISOString(),
      q: message,
      via: payload.via,
      ...(seekerWho ? { who: seekerWho } : {}),
      chat: true,
      quotaAsk: true,
    });
    if (seekerUid && seekerCredits !== null) {
      try {
        users.spendCredit(seekerUid, 1);
      } catch {
        /* registry best-effort */
      }
    }
    return json(res, 200, {
      answer: quotaMsg,
      sources: [],
      ...(left !== null ? { credits: Math.max(0, left - 1) } : {}),
    });
  }

  // Bhaiya-approved answers: the bot LEARNS the correction, it doesn't parrot
  // it. A same-meaning question gets the approved answer as THE answer — full
  // substance, every specific point — but composed freshly for this seeker
  // (their name, language, style, follow-ups). A merely similar question sees
  // it as the highest-authority excerpt. (Owner's rule 2026-07-17: no verbatim
  // replies — same core for everyone, spoken the way each seeker understands.)
  let approved = null;
  try {
    approved = await matchCorrection(message);
  } catch {
    /* corrections are best-effort */
  }

  // WHAT-IT-IS vs HOW-TO-DO-IT (owner's rule, 2026-07-18). A साधना's निर्देश belong
  // to the family: members receive them, everyone else is warmly invited in first.
  // And "सिया तत्व साधना क्या है?" must never be answered with its rule sheet — which
  // is exactly what an approved rules answer was doing to every nearby question.
  // The साधना may have been named a turn or two ago ("इसके नियम क्या हैं?"), so the
  // topic is read from the recent conversation, not just this message.
  const topicText = history
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .concat(message)
    .join(" ");
  const sadhanaTopic = SADHANA_TOPIC.test(topicText);
  // "देखो Rohan भाई," on EVERY answer reads as a machine (owner, 2026-07-18).
  // Telling the model to vary was not enough — the persona rule pulls it back —
  // so show it its own recent openings and forbid them outright.
  // Warmth on a RHYTHM, decided here rather than left to the model. The seeker's
  // actual NAME every single reply reads as robotic (owner, 2026-07-21); family
  // address (भाई/बहन/जी) carries the warmth the rest of the time. So the name is a
  // rare, special touch — the first reply of a conversation, then only now and
  // then — never when it was just used. (Told merely to "use the name less" the
  // model once dropped every भाई/बहन and went cold — so the fallback below still
  // insists on warm family address.)
  const assistantTurns = history.filter((m) => m.role === "assistant");
  const nameUsedRecently =
    !!seekerName && assistantTurns.slice(-3).some((m) => m.content.includes(seekerName));
  const firstReply = assistantTurns.length === 0;
  const useName = !!seekerName && !nameUsedRecently && (firstReply || Math.random() < 0.3);

  const personalAsk = !isGreeting && !isAck && !isUnclear && PERSONAL_ASK.test(message);

  const recentOpenings = history
    .filter((m) => m.role === "assistant")
    .slice(-3)
    .map((m) => m.content.trim().split(/\s+/).slice(0, 4).join(" ").replace(/["\\]/g, ""))
    .filter(Boolean);
  const rulesAsk = !isGreeting && isRulesQ(message);
  const aboutAsk = !isGreeting && !rulesAsk && (ABOUT_ASK.test(message) || MEANING_ASK.test(message));
  const rulesWithheld = rulesAsk && sadhanaTopic && !seekerMember;
  const aboutSadhana = aboutAsk && sadhanaTopic;
  // Drop an approved RULES answer whenever its substance does not belong in THIS
  // answer — a non-member never receives a साधना's निर्देश, and anyone asking
  // "what is it?" gets the teaching, not the rule sheet. The model cannot leak
  // what it was never given. (A member asking for the नियम still gets them whole.)
  if (
    approved &&
    isRulesQ(approved.q) &&
    ((!seekerMember && SADHANA_TOPIC.test(approved.q)) || aboutAsk)
  )
    approved = null;

  // Search transcripts for the question (plus a bit of recent context for follow-ups).
  // Cross-language boost: also search with a Hindi/English translation of the question,
  // since the videos are spoken in Hindi but visitors may ask in English (or vice versa).
  const lastUserTurns = history
    .filter((m) => m.role === "user")
    .slice(-1)
    .map((m) => m.content);
  let translated = null;
  const tKey = message.trim().toLowerCase().slice(0, 300);
  if (translationCache.has(tKey)) translated = translationCache.get(tKey);
  else if (apiKeyConfigured && !isGreeting && !isUnclear && !isAck) {
    try {
      // Time-boxed, but NOT tight: this translation is load-bearing, not a bonus.
      // Measured 2026-07-18 — searching a Hinglish question WITHOUT it returns
      // matches by alphabet, not meaning ("dhyan me man kyu bhatakta hai" pulled
      // up a Zoom recording filename and the bot's own about-page). At the old
      // 1.2s cut-off, 3 of 4 translations were being thrown away whenever Gemini
      // was rate-limited and the slower backup answered. It is a race, so a fast
      // reply still costs nothing; only a slow one waits.
      const line = await Promise.race([
        complete({
          system:
            "You translate search queries. If the question is in English, translate it into Hindi (Devanagari). If it is in Hindi written in Latin letters (Hinglish, e.g. \"sadhna kaise karu\"), write that SAME question in Devanagari. If it is already in Devanagari, translate it into English. Output ONLY the resulting question itself — never answer it, never explain.",
          messages: [{ role: "user", content: message }],
          maxTokens: 150,
          light: true,
          retry: false, // best-effort helper — never make the visitor wait on retries
        }),
        new Promise((resolve) => setTimeout(() => resolve(""), 2600)),
      ]);
      translated = (line || "").split("\n")[0].trim() || null; // first line only
      // Seekers re-ask and tap the same suggestion chips constantly — cache it so
      // the repeat costs nothing and never races the clock at all.
      if (translated) {
        translationCache.set(tKey, translated);
        if (translationCache.size > 800) translationCache.delete(translationCache.keys().next().value);
      }
    } catch {
      /* translation is best-effort — search proceeds with the original question */
    }
  }
  // a greeting needs no teaching material — hand the model nothing to riff on
  const chunks = isGreeting || isUnclear || isAck
    ? []
    : await searchMulti(
        [
          [...lastUserTurns, message].join(" "),
          translated,
          // The third form is the one that was missing. This model matches SCRIPT
          // as much as meaning, so a Devanagari question could never reach a
          // teaching written in Hinglish — and voice input is always Devanagari,
          // so Bhaiya's Hinglish material was invisible to most seekers. Free:
          // plain transliteration rules, no AI call. (Hinglish questions get the
          // mirror of this from the translation step above.)
          // The script-flip form. A Devanagari question gets its Hinglish
          // spelling directly; an ENGLISH question gets it from the Hindi
          // translation above — otherwise English seekers still could not reach
          // teachings written in Hinglish (measured: 0 of 3 before this line).
          // …and normalise the spelling to the one the library actually uses:
          // पितृ / pitru / pitar / pitr are one word, but the knowledge writes
          // "pitra" and contains no Devanagari पितृ at all, so an un-normalised
          // "pitri" matched nothing (owner, 2026-07-19).
          normalizeSpelling(
            isDevanagari
              ? toLatin(message)
              : translated && /[ऀ-ॿ]/.test(translated)
                ? toLatin(translated)
                : message,
          ),
        ],
        Number(process.env.RETRIEVE_K || 12),
      );

  // The approved answer joins the excerpts at the top — the model treats
  // Bhaiya's own edit as the most authoritative teaching (rule 7b). When the
  // seeker's question means the SAME thing, it is told so explicitly: the
  // correction IS the answer, delivered whole, adapted to this seeker.
  if (approved) {
    chunks.unshift({
      title: "Bhaiya's approved answer (admin-edited)",
      content: `Question it was written for: ${approved.q}\n${
        approved.score >= DIRECT_MATCH
          ? "(The seeker's current question means the SAME as that one. This approved answer IS the answer: deliver its COMPLETE teaching — every specific point and instruction — freshly worded for this seeker and their language, adding nothing and dropping nothing. COPY EVERY NUMBER AND CLOCK TIME EXACTLY as written here — if it says 6 pm, say 6 pm, never 7 or 8. Changing a figure is a serious error.)\n"
          : ""
      }Approved answer: ${approved.answer}`,
      start_seconds: 0,
      url: null,
      score: approved.score,
    });
  }

  const langInstruction = wantsHindi
    ? "उत्तर पूरी तरह हिंदी (देवनागरी) में दीजिए — एक भी वाक्य English में नहीं। अंतिम सुझाव और वापसी पंक्तियों के प्रश्न भी हिंदी में ही लिखिए।"
    : "Answer entirely in English — every sentence in English (keep Hindi terms like hawan, jaap, drishti in Latin script). Do not write any Devanagari. This INCLUDES the final marker lines: the questions on the सुझाव line and the वापसी line MUST be written in English too (only the labels सुझाव:/वापसी: themselves stay as they are). Example — सुझाव: How do I start jaap? | What is the third eye?";

  const logEntry = {
    at: new Date().toISOString(),
    q: message,
    via: payload.via,
    lang: payload.lang,
    hi: wantsHindi,
    ...(seekerWho ? { who: seekerWho } : {}),
    ...(seekerUid ? { uid: seekerUid } : {}),
    ...(seekerMember ? { member: true } : {}),
    // corrected = same-meaning match (the correction IS the answer, adapted);
    // guided = related match (the correction was the highest-authority source)
    ...(approved ? (approved.score >= DIRECT_MATCH ? { corrected: true } : { guided: true }) : {}),
    ...(rulesWithheld ? { rulesWithheld: true } : aboutSadhana ? { aboutAsk: true } : {}),
    ...(isUnclear ? { unclear: true } : {}),
    ...(isAck ? { ack: true } : {}),
    ...(isNegativeReply ? { negReply: true } : {}),
    top: chunks.slice(0, 3).map((c) => ({ t: c.title, s: Number(c.score?.toFixed(3)) })),
  };

  // TEST MODE — no API key yet. Instead of an AI-composed answer, return the actual
  // video passages the search found, so retrieval + sources + UI can be verified free.
  if (!apiKeyConfigured) {
    const top = chunks.slice(0, 3);
    const answer =
      "⚠️ TEST MODE — यह असली जवाब नहीं है / this is NOT a real answer.\n" +
      "The answering AI is not connected yet (API key pending). Until then I can only show " +
      "the video material your answer would come from:\n\n" +
      (top.length
        ? top
            .map(
              (c, i) =>
                `${i + 1}. "${c.title}" (${formatTimestamp(c.start_seconds)}):\n“…${c.content.slice(0, 220).trim()}…”`,
            )
            .join("\n\n")
        : "(nothing relevant found)");
    const sources = top.map((c) => ({
      title: c.title,
      timestamp: formatTimestamp(c.start_seconds),
      url: c.url ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : null,
    }));
    writeLog({ ...logEntry, answer, testMode: true });
    return json(res, 200, { answer, sources, testMode: true });
  }

  try {
    let answer = await complete({
      system: buildSystemPrompt(FALLBACK),
      cacheSystem: true,
      maxTokens: 700,
      messages: [
        ...history,
        {
          role: "user",
          content: `Transcript excerpts for this question:\n\n${buildContextBlock(chunks)}\n\n---\nVisitor question: ${message}\n\n[${langInstruction}]${
            recentTopics.length || seekerName
              ? `\n[Seeker${seekerName ? ` named "${seekerName}"` : ""}${
                  recentTopics.length ? ` — recent questions (from their own device): ${recentTopics.join(" | ")}.` : "."
                }${seekerSummary ? ` Journey so far: ${seekerSummary}` : ""}${
                  seekerStyle ? ` Their communication style (honor it): ${seekerStyle}.` : ""
                }${
                  seekerSadhana ? ` Their ongoing practice (self-declared${seekerSadhana.since ? `, since ${seekerSadhana.since}` : ""}): "${seekerSadhana.name}".` : ""
                }${
                  seekerName ? `${
                    useName
                      ? ` A warm personal touch fits here: address them ONCE using their NAME — but NEVER as the opening words; put it where it falls naturally, mid-sentence or at the close. As "${seekerName} भाई" if the name reads clearly male ("${seekerName} bhai" in English), "${seekerName} बहन" if clearly female ("${seekerName} behen"), or "${seekerName} जी" if unsure.`
                      : ` Do NOT use their name this time — the name every reply feels robotic — but DO keep the warmth: address them once as भाई (if the name "${seekerName}" reads male) or बहन (if female), or जी if the gender is unclear. Place it naturally where family warmth fits — a reassurance, a gentle nudge, or the closing line — never as the opening words, and only once. Never call a बहन भाई. (This family word is what carries the warmth when the name is resting, so do not drop it and go cold.)`
                  } Keep the same भाई/बहन/जी form anywhere you address them in this answer.` : ""
                } Where it fits naturally, connect the answer to their ongoing journey in one warm phrase; never list their history back to them.${
                  leftover
                    ? ` FRESH conversation — their previous one (${leftover.when || "पिछली बार"}) ended around: "${leftover.q}". Answer the CURRENT question fully and cleanly first. If the current question is a DIFFERENT topic, you may close with ONE short warm bridge offering the old thread back ("वैसे ${leftover.when || "पिछली बार"} हम इस बारे में बात कर रहे थे — चाहें तो वहीं से आगे बढ़ें?") and make ONE of the सुझाव questions that continuation. If it's the same topic, continue naturally with no bridge. Never let the old thread hijack the new answer.`
                    : ""
                }]`
              : ""
          }${
            seekerMember
              ? `\n[MEMBER: this seeker is a verified Ashaeiynn member — they already belong to the family and have their own mentor. NEVER suggest booking a screening or joining Ashaeiynn to them. ${
                  personalAsk
                    ? 'This question is about their OWN circumstances, so rule 15 applies: give one line of warmth and send them to THEIR OWN mentor — "अपने mentor से बात कीजिए — वे आपको जानते हैं".'
                    : 'This is a TEACHING question, not a personal one. Answer it fully from Bhaiya\'s teachings and do NOT send them to their mentor — no "अपने mentor से बात कीजिए", no "मेंटर से चर्चा कीजिए", not even as a closing suggestion. A mentor referral in an ordinary answer makes the guide sound like it is passing the seeker away; keep it for health, fear, crisis or their own specific condition.'
                } IF (and only if) this member indicates a PREVIOUS answer of yours was wrong or incomplete — they say so outright, or their message clearly contradicts/re-asks because it didn't land — then: humbly acknowledge (never argue), answer again as best you can from the excerpts, and gently invite them to share Bhaiya's correct teaching so our team can review it — e.g. "अगर आप जानते हैं कि Bhaiya इसे कैसे समझाते हैं, तो बताइए — मैं हमारी team तक पहुँचा दूँगा।" Then add a final line exactly: सुधार: 1 (the app turns this into a box for them to type the correct answer; never shown as text). Do this ONLY on a genuine wrong-answer signal, never on a normal follow-up or a first question.]`
              : profile?.uid
                ? `\n[NOT YET A MEMBER: this seeker has not joined Ashaeiynn yet. For personal matters (rule 15) guide them to book a screening at ashaeiynn.com. And when a moment is genuinely right — deep interest, a personal ask, a practice they want to begin — you may warmly mention ONCE in the conversation that their own journey with Ashaeiynn can begin with a screening. Inviting, never pushy, never in every answer.]`
                : ""
          }${
            ADDRESSED_AS_BHAIYA.test(message)
              ? `\n[THIS SEEKER IS SPEAKING TO YOU AS IF YOU WERE BHAIYA HIMSELF. You are his helper, not him (rule 5). Do NOT slip into his first person — never "मैं तारीफ़ नहीं कर रहा", never "हम कभी नहीं कहते". Answer warmly ABOUT him instead: "भैया तारीफ़ नहीं करते — वे कहते हैं कि…". Do not correct them or make a point of it; simply speak as yourself.]`
              : ""
          }${
            history.some((m) => m.role === "assistant")
              ? ""
              : `\n[FIRST MESSAGE — you have not said anything to this seeker yet in this conversation. So nothing has been interrupted, nothing was explained earlier, and there is no "what I was just saying". Any excerpt whose reply assumes an ongoing explanation ("पहले पूरा सुन लो", "जो बता रहा हूँ उसे सुनो", "as I was saying") belongs to a DIFFERENT moment and must not be used here — using it would scold someone who has done nothing. Simply welcome them and answer, or invite the question. NEVER mention this to the seeker: do not say "nothing has been interrupted", do not explain that no explanation was in progress — they would have no idea what you meant. Just answer naturally.]`
          }${
            recentOpenings.length
              ? `\n[VARY YOUR OPENING — your recent answers began: ${recentOpenings
                  .map((o) => `"${o}…"`)
                  .join(", ")}. Do NOT begin this answer with those words or anything close to them, and do not fall back on "देखो <name> भाई/बहन" again. Begin a different way — most naturally with the answer itself. Use their name only if you have not used it recently.]`
              : ""
          }${
            rulesWithheld
              ? `\n[साधना निर्देश — NOT FOR THIS SEEKER. They are asking for the नियम/निर्देश of a साधना (rules, timings, food, method, count) and they have NOT joined Ashaeiynn. Ashaeiynn never hands साधना निर्देश to someone outside the family — they are given personally, with a guide, so the साधना is done rightly and safely. So: do NOT state a single rule, timing, food restriction, count or step, even though the excerpts below contain them. Instead, in 3-4 warm sentences — say what this साधना IS and why it matters in Bhaiya's teaching, explain kindly that its निर्देश are given personally once their own journey with Ashaeiynn begins, and invite them to book a screening. This is care, never secrecy: never sound like you are hiding something, and never hint at a rule while declining. End with the final line: सहायता: screening]`
              : aboutSadhana
                ? `\n[THIS IS A "WHAT IS IT" QUESTION, not a how-to. The seeker wants to understand the साधना itself — what it is, what it awakens, why Bhaiya gives it, what a seeker gains from it. Do NOT answer with its नियम: no timings, no food restrictions, no step-by-step method, no do's and don'ts. Teach the साधना, not the rulebook.${
                    seekerMember ? " You may offer its नियम as ONE of the सुझाव follow-ups." : ""
                  }]`
                : ""
          }${
            wantsLink
              ? `\n[The seeker asked for a link. The app automatically shows tappable links right below your answer (the sources, and the requested channel/page). Warmly point there — "नीचे लिंक दिया है, tap करके देखिए" in Hindi or "the link is right below" in English — never say you cannot share links, and never read a URL out loud.]`
              : ""
          }${
            payload.via === "notification"
              ? `\n[The seeker just OPENED the app by tapping this notification — the "question" above is that notification's text, not their words. Welcome them warmly for coming, then open a short living conversation about it (3-4 sentences grounded in the excerpts + one inviting question). This is a doorstep moment, not a lecture.]`
              : ""
          }${
            isNegativeReply
              ? `\n[THE SEEKER IS ANSWERING YOUR OWN QUESTION, AND THE ANSWER IS "NO". Read what you asked them last, then respond to THAT — do not start a teaching about the very thing they just said they are not doing. Two cases: (a) they say they are NOT doing something you asked about ("मैं साधना नहीं कर रहा") — accept it warmly in ONE line without disappointment or persuasion, and ask what they WOULD like to know, or offer gently. (b) they say they did not follow you ("समझ नहीं आया") — say the SAME thing again in simpler words, shorter, with a homely example; never repeat your earlier wording. Either way: short, no lecture, no Source line unless you are genuinely re-teaching. End with a सुझाव line of 2-3 things they might actually want.]`
              : isAck
                ? `\n[THIS IS AN ACKNOWLEDGEMENT, not a question — they are simply saying "yes / अच्छा / ठीक है" to what you just told them. Do NOT begin a new teaching, do NOT change the subject, and do NOT bring in साधना rules or any topic they did not ask about. Reply with ONE short warm line — about 15 words, NEVER more than 25 — that stays with what you were JUST discussing and gently opens the door to go further. No teaching, no Source line, no पंचांग. Then TWO final lines: a सुझाव line with 2-3 questions that go DEEPER INTO THAT SAME TOPIC, and the line: वार्ता: 1]`
              : isUnclear
                ? `\n[THE SEEKER HAS NOT SAID WHAT THEY WANT TO KNOW. Their opening message names no topic at all and there is no conversation before it to explain it. Do NOT compose a teaching, do NOT give general spiritual advice, do NOT describe Ashaeiynn or its साधनाएँ, do NOT reassure them at length. Reply with ONE short warm line — about 20 words, NEVER more than 30 — that greets them${
                  seekerName ? ` by name (भाई/बहन/जी as fits)` : ""
                } and asks what they would like to know. Nothing else: no teaching, no पंचांग, no Source line. Then TWO final lines — a सुझाव line offering 2-3 concrete things they could ask (e.g. "ध्यान कैसे शुरू करें? | तीसरी आँख क्या है? | साधना के बारे में जानना है"), and the line: वार्ता: 1]`
              : isGreeting
                ? `\n[THIS IS A BARE GREETING, not a question. Reply with ONE short sentence — greet them back (${seekerName ? `"${seekerName}" + भाई/बहन/जी as fits their name` : "भाई/बहन/जी"}) and ask one light question about how they are. About 15 words, NEVER more than 25. Absolutely NO teaching, NO पंचांग or festival note, NO praise of their devotion, NO advice, NO Source line, no excerpts needed. End with the final line: वार्ता: 1]`
              : ""
          }${(() => {
            if (isGreeting || isUnclear || isAck) return "";
            try {
              return `\n[पंचांग — reference ONLY, for resolving time references (आज, कल, नवरात्रि के आख़िरी दिन…) WHEN the seeker's message actually asks about time, dates or a festival: ${panchangLine()}. Do NOT volunteer festival or पंचांग information otherwise — never bring it into a greeting, a thank-you, or an unrelated question. Dates can differ from a local पंचांग by ±1 day, so on exact-date questions add "पंचांग से मिला लीजिएगा". Never invent dates beyond these.]`;
            } catch {
              return "";
            }
          })()}`,
        },
      ],
    });

    // The model ends with "सुझाव: q1 | q2" (tappable follow-ups) and
    // "वापसी: q" (a caring question saved for the seeker's next visit).
    // Strip both regardless of order — never shown as text, never spoken.
    let followups = [];
    let checkin = "";
    let sadhana = null; // seeker declared/changed a practice ("-" = stopped)
    let help = ""; // "screening" | "contact" — this needs a human, attach links
    let quote = null; // verbatim Bhaiya line, verified against the excerpt below
    let chat = false; // rule-4b conversational turn, not a knowledge question
    let inviteFix = false; // member signalled the answer was wrong — offer a correction box
    // Every marker below is anchored to the END of the answer, but the model does
    // not always put Source last — when it wrote Source before सुझाव/वापसी, none of
    // them matched and all of them leaked out as spoken text (seen live 2026-07-18).
    // Lift the Source line out first, put it back once the markers are parsed.
    let sourceLine = "";
    const srcM = answer.match(/(?:^|\n)[ \t]*(?:source|स्रोत)[ \t]*[:：][^\n]*/i);
    if (srcM) {
      sourceLine = srcM[0].trim();
      answer = (answer.slice(0, srcM.index) + answer.slice(srcM.index + srcM[0].length)).trimEnd();
    }
    for (let pass = 0; pass < 4; pass++) {
      const sd = answer.match(/\n\s*(?:सुधार|correction)\s*[:：]\s*1?\s*$/i);
      if (sd) {
        inviteFix = true;
        answer = answer.slice(0, sd.index).trimEnd();
      }
      const va = answer.match(/\n\s*(?:वार्ता|chat)\s*[:：]\s*1?\s*$/i);
      if (va) {
        chat = true;
        answer = answer.slice(0, va.index).trimEnd();
      }
      // the model sometimes writes "~ Excerpt 10" instead of "~ 10" — accept both
      const qu = answer.match(/\n\s*(?:उद्धरण|quote)\s*[:：]\s*(.+?)\s*~\s*(?:excerpt|अंश)?\s*(\d{1,2})\s*$/i);
      if (qu) {
        const norm = (s) => s.replace(/["“”'’]/g, "").replace(/\s+/g, " ").trim();
        const c = chunks[Number(qu[2]) - 1];
        const text = qu[1].trim().slice(0, 260);
        // only a true word-for-word line from a real recording earns the frame
        if (c && !c.title.startsWith("Bhaiya's approved answer") && norm(c.content).includes(norm(text))) {
          quote = {
            text,
            title: c.title,
            timestamp: formatTimestamp(c.start_seconds),
            url: publicUrl(c.url) ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : null,
          };
        }
        answer = answer.slice(0, qu.index).trimEnd();
      }
      const fu = answer.match(/\n\s*(?:सुझाव|suggestions?)\s*[:：]\s*([^\n]+)\s*$/i);
      if (fu) {
        followups = fu[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3);
        answer = answer.slice(0, fu.index).trimEnd();
      }
      const ci = answer.match(/\n\s*(?:वापसी|check-?in)\s*[:：]\s*([^\n]+)\s*$/i);
      if (ci) {
        checkin = ci[1].trim().slice(0, 200);
        answer = answer.slice(0, ci.index).trimEnd();
      }
      const sa = answer.match(/\n\s*(?:साधना|sadhana)\s*[:：]\s*([^\n]+)\s*$/i);
      if (sa) {
        sadhana = sa[1].trim().slice(0, 120);
        answer = answer.slice(0, sa.index).trimEnd();
      }
      const he = answer.match(/\n\s*(?:सहायता|help)\s*[:：]\s*(screening|contact)\s*$/i);
      if (he) {
        help = he[1].toLowerCase();
        answer = answer.slice(0, he.index).trimEnd();
      }
    }
    if (sourceLine) answer = `${answer}\n\n${sourceLine}`;

    // LANGUAGE SEATBELT for the tap-chips (owner, 2026-07-23): an English asker
    // got an English answer but HINDI सुझाव chips — the model treats the marker
    // lines as exempt from the language pin (their examples are Hindi). The pin
    // above now covers them, but prompts can be disobeyed; code cannot. If the
    // asker's language is English and chips/check-in still came back Devanagari,
    // translate them in ONE quick light call — and if that fails, drop the
    // mismatched ones: a missing chip beats a wrong-language chip.
    const deva = (s) => /[ऀ-ॿ]/.test(s);
    if (!wantsHindi && (followups.some(deva) || deva(checkin))) {
      const items = [...followups, ...(checkin ? [checkin] : [])];
      try {
        const line = await Promise.race([
          complete({
            system:
              "Translate each Hindi question into short natural English, as a seeker would ask it. Keep Hindi practice terms (jaap, hawan, sadhana, dhyan) in Latin script. Input questions are separated by \" | \". Output ONLY the translated questions in the same order, separated by \" | \" — nothing else.",
            messages: [{ role: "user", content: items.join(" | ") }],
            maxTokens: 200,
            light: true,
            retry: false,
          }),
          new Promise((resolve) => setTimeout(() => resolve(""), 2600)),
        ]);
        const out = (line || "").split("\n")[0].split("|").map((s) => s.trim()).filter(Boolean);
        if (out.length === items.length && !out.some(deva)) {
          followups = out.slice(0, followups.length);
          if (checkin) checkin = out[out.length - 1].slice(0, 200);
        } else {
          followups = followups.filter((f) => !deva(f));
          if (deva(checkin)) checkin = "";
        }
      } catch {
        followups = followups.filter((f) => !deva(f));
        if (deva(checkin)) checkin = "";
      }
    }

    // FIGURE FIDELITY — seekers act on the numbers in a साधना rule (3 बजे, 6 बजे),
    // so a drifted digit is a real-world error, not a wording nit. Asking the model
    // nicely did NOT hold: measured 2026-07-18 it turned Bhaiya's "6 बजे" into
    // "8 बजे" in one run out of two. So we check the digits in code whenever an
    // approved answer IS the answer: repair once (cheap, narrow task), and if the
    // repair still disagrees, deliver Bhaiya's approved text as it stands.
    // Accuracy of a rule outranks per-seeker phrasing.
    if (approved && approved.score >= DIRECT_MATCH) {
      const bare = (t) => String(t).replace(/^\s*(?:source|स्रोत)\s*[:：].*$/gim, "");
      // A clock time is the same fact in every language, but its written FORM is
      // not: English "7:00 PM" becomes Hindi "शाम 7 बजे" — the ":00" minutes drop.
      // So normalise a whole-hour "H:00" to just "H", and ignore bare zero tokens,
      // before comparing. Without this the vanished "00" read as a drifted figure
      // and a faithful Hindi translation of an approved answer was thrown away and
      // replaced by the original English (owner, 2026-07-21).
      const digitsOf = (t) =>
        new Set(
          (bare(t)
            .replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d))
            .replace(/(\d):00(?!\d)/g, "$1")
            .match(/\d{1,4}/g) || []
          ).filter((d) => Number(d) !== 0)
        );
      const want = digitsOf(approved.answer);
      const drifted = (a) => {
        const got = digitsOf(a);
        return [...want].some((d) => !got.has(d)) || [...got].some((d) => !want.has(d));
      };
      if (want.size && drifted(answer)) {
        logEntry.figureFix = true;
        try {
          const fixed = await complete({
            system:
              "You fix numbers ONLY. You are given Bhaiya's APPROVED answer and a DRAFT that retells it for a seeker. Return the DRAFT with every number, clock time, count, duration and quantity made to agree exactly with the APPROVED answer — restore any figure the draft dropped, delete any it invented. Change NOTHING else: same language, same wording, same order, same lines. Output only the corrected draft.",
            messages: [{ role: "user", content: `APPROVED:\n${approved.answer}\n\nDRAFT:\n${answer}` }],
            maxTokens: 700,
            light: true,
            retry: false,
          });
          answer = fixed && !drifted(fixed) ? fixed.trim() : approved.answer;
        } catch {
          answer = approved.answer;
        }
      }
    }

    // Deterministic rule: an answer WITHOUT a Source line is either a refusal
    // or a purely conversational reply (rule 4b) — never decorate it with
    // Watch links or teaching extras. Conversation may keep its follow-up
    // chips and check-in so the dialogue breathes; sources stay empty.
    // (Handoffs and link requests are the deliberate exceptions.)
    // the model sometimes writes the Hindi "स्रोत:" instead of "Source:" — treat both
    if (!help && !wantsLink && !/(?:source|स्रोत)\s*[:：]/i.test(answer)) {
      // Safety net INSIDE the bare path: an answer that points to a mentor or
      // screening must still carry the human door — and ONLY that (members get
      // contact, never a screening pitch; no teaching links on handoffs).
      const contacts = [];
      if (/mentor|मेंटर|मेन्टर|screening|स्क्रीनिंग/i.test(answer)) {
        const wanted = seekerMember ? ["Contact Ashaeiynn"] : ["Book a screening", "Contact Ashaeiynn"];
        for (const l of linkDirectory().filter((l) => wanted.includes(l.title)))
          contacts.push({ title: l.title, timestamp: "", url: l.url });
      }
      writeLog({ ...logEntry, answer, refusal: true, ...(chat ? { chat: true } : {}), ...(inviteFix && seekerMember ? { inviteFix: true } : {}) });
      // owner's rule: EVERY response costs one credit — greetings, small talk
      // and off-topic refusals included (only outright errors are free)
      let bareBalance = seekerCredits;
      if (seekerUid && seekerCredits !== null) {
        try {
          bareBalance = users.spendCredit(seekerUid, 1);
        } catch {
          /* registry best-effort */
        }
      }
      return json(res, 200, {
        answer,
        sources: contacts,
        ...(followups.length ? { followups } : {}),
        ...(checkin ? { checkin } : {}),
        ...(sadhana ? { sadhana } : deniesPractice ? { sadhana: "-" } : {}), // a new declaration wins; otherwise "-" forgets it
        // only a MEMBER is invited to teach a correction (server-gated)
        ...(inviteFix && seekerMember ? { correctionInvite: true } : {}),
        ...(bareBalance !== null ? { credits: bareBalance } : {}),
      });
    }

    // Owner's rule (2026-07-20): do NOT list the sources an answer was drawn
    // from. Show AT MOST ONE thing — a Pathshala ARTICLE genuinely worth reading
    // on the question, which opens on the website when tapped — and nothing
    // otherwise. So this is not a citation list; it is a single "read more"
    // suggestion, offered only when a real article clearly matches.
    // Only "Article:" titles (individual ashaeiynn.com pages) qualify — not the
    // "Website: …" landing pages, not the About doc, not video moments. chunks
    // are already ranked, so the first qualifying one is the best match; the
    // floor keeps a barely-related article from being pushed onto every answer.
    const ARTICLE_MIN = Number(process.env.ARTICLE_SUGGEST_MIN || 0.84);
    const sources = [];
    for (const c of chunks) {
      if (!/^\s*Article:/i.test(c.title)) continue; // a real Pathshala article, not a page or the About doc
      if (!publicUrl(c.url)) continue;
      if (typeof c.score === "number" && c.score < ARTICLE_MIN) break; // ranked list — nothing below here qualifies
      if (seenTitles.has(c.title.toLowerCase())) continue; // don't re-suggest one they've already read
      sources.push({ title: c.title, timestamp: "", url: c.url }); // the article page itself, no video timestamp
      break;
    }

    // Asked for a link? Add the matching channels/pages from the address book.
    if (wantsLink) {
      for (const l of matchLinks(message)) {
        if (sources.some((s) => s.url === l.url)) continue;
        sources.push({ title: l.title, timestamp: "", url: l.url });
      }
    }
    // This needs a human — attach the way to reach one. Safety net: even if
    // the model forgot its सहायता marker, an answer that points the seeker to
    // a mentor or screening should always carry the links.
    if (!help && /mentor|मेंटर|मेन्टर|screening|स्क्रीनिंग/i.test(answer)) help = "screening";
    // members never see "Book a screening" — they already belong; their human
    // door is Ashaeiynn contact (their own mentor)
    if (help === "screening" && seekerMember) help = "contact";
    if (help) {
      const wanted = help === "screening" ? ["Book a screening", "Contact Ashaeiynn"] : ["Contact Ashaeiynn"];
      for (const l of linkDirectory().filter((l) => wanted.includes(l.title))) {
        if (!sources.some((s) => s.url === l.url)) sources.push({ title: l.title, timestamp: "", url: l.url });
      }
    }

    // A gentle "watch next" the seeker hasn't seen yet (their device tells us
    // what they've seen; nothing tracked here) — the next-best relevant source.
    // Owner's rule: suggest ONLY our public channels — YouTube videos and
    // Pathshala/website articles. Studio material (Vimeo/Zoom/audio) is never
    // suggested; it stays citable by title under answers.
    let suggest = null;
    const usedTitles = new Set(sources.map((s) => s.title.toLowerCase()));
    for (const c of chunks) {
      const t = c.title.toLowerCase();
      if (usedTitles.has(t) || seenTitles.has(t)) continue;
      if (c.title.startsWith("Bhaiya's approved answer")) continue;
      if (!publicUrl(c.url)) continue;
      // "आगे देखिए" means WATCH NEXT. With the recordings withdrawn from the
      // library this was offering website pages — "watch Website: Reviews
      // (0:00)". Only a real PUBLIC video earns this spot now — Vimeo/Zoom studio
      // recordings are never suggested (publicUrl already blocks them; the regex
      // stays public-only too so a studio session can never surface here).
      if (!/youtu\.?be|youtube\.com/i.test(c.url)) continue;
      suggest = {
        title: c.title,
        timestamp: formatTimestamp(c.start_seconds),
        url: `${c.url}#t=${Math.floor(c.start_seconds)}s`,
      };
      break;
    }

    // Owner's rule: the on-screen "Source:" line appears ONLY when it names a
    // public source (YouTube/Pathshala). Studio-sourced answers show just the
    // teaching and Bhaiya's quote. The log keeps the full answer regardless,
    // so the admin's knowledge-gap review is untouched.
    writeLog({ ...logEntry, answer, ms: Date.now() - t0 });
    // The Source line is ALWAYS taken off the seeker's screen now. The app shows
    // the same links as tappable pills right underneath, so printing
    // "Source: Article: … (0:00)" above them cost four lines of a phone screen
    // to say the same thing twice (owner, 2026-07-19). The full line still goes
    // into questions.log, so the admin's knowledge-gap review is unaffected —
    // and its PRESENCE still drives the deterministic no-source rules above.
    let shown = answer.replace(/\n\s*(?:Source|स्रोत)\s*[:：][^\n]*/gi, "").trimEnd();
    // "ठीक है?" is Bhaiya's own habit, but the model turned it into a closing
    // formula on nearly every answer, which reads as a tic (owner, 2026-07-19).
    // Telling it to be sparing is not enough on its own, so: if it was used in
    // the last two answers, take a trailing one off. It can still appear — it
    // just can never repeat.
    if (/ठीक\s*है\s*[?？]/.test(history.filter((m) => m.role === "assistant").slice(-2).map((m) => m.content).join(" "))) {
      shown = shown.replace(/\s*(?:तो\s*)?ठीक\s*है\s*(?:ना|न)?\s*[?？]\s*$/u, "").trimEnd();
    }

    // seatbelt: a quote marker the parser didn't recognize must never reach
    // the seeker as raw text (the framed quote uses data.quote, not this line)
    shown = shown.replace(/\n\s*(?:उद्धरण|quote)\s*[:：][^\n]*/gi, "").trimEnd();
    shown = shown.replace(/\n\s*(?:सुधार|correction)\s*[:：]\s*1?\s*$/gi, "").trimEnd();
    // LAST seatbelt: the model sometimes MISSPELLS a marker — seen live
    // "वाथी: जाप की प्रक्रिया में…" instead of "वापसी:" — and a misspelling slips
    // past every named pattern above and is read out to the seeker. Any final
    // line that is a short Devanagari label followed by a colon is one of ours;
    // real answers are flowing speech and never end in a labelled line.
    shown = shown.replace(/\n\s*[ऀ-ॿ]{2,10}\s*[:：]\s*\S[^\n]*$/u, "").trimEnd();

    // ANSWER-LANGUAGE SEATBELT (owner, 2026-07-25): with all-English excerpts the
    // model occasionally ignores the language pin and answers a Hindi seeker in
    // English (seen live). Code catches what instructions cannot: if the answer's
    // script clearly mismatches the seeker's language, translate it ONCE before
    // the seeker sees it. Skipped for approved answers delivered as-is (the digit
    // guard above already vetted that text — a late translation could re-drift it)
    // and for greetings. On any failure the original stands: a right answer in
    // the wrong language beats no answer.
    const scriptShare = (s) => {
      const lat = (s.match(/[A-Za-z]/g) || []).length;
      const dev = (s.match(/[ऀ-ॿ]/g) || []).length;
      return lat + dev > 0 ? dev / (lat + dev) : 0;
    };
    const share = scriptShare(shown);
    const wrongScript = shown.length > 60 && (wantsHindi ? share < 0.2 : share > 0.8);
    if (wrongScript && !isGreeting && !(approved && approved.score >= DIRECT_MATCH)) {
      try {
        const fixed = await Promise.race([
          complete({
            system: wantsHindi
              ? "Translate this spiritual guide's answer into warm, natural spoken Hindi (Devanagari). Keep terms like mentor, team, screening, YouTube, and names (Ashaeiynn, Bhaiya) as they are. Preserve the meaning, numbers, and tone exactly — no additions, no commentary. Output ONLY the translated answer."
              : "Translate this spiritual guide's answer into warm, natural English. Keep Hindi practice terms (jaap, hawan, sadhana, dhyan) in Latin script. Preserve the meaning, numbers, and tone exactly — no additions, no commentary. Output ONLY the translated answer.",
            messages: [{ role: "user", content: shown }],
            maxTokens: 900,
            light: true,
            retry: false,
          }),
          new Promise((resolve) => setTimeout(() => resolve(""), 5200)),
        ]);
        const f = String(fixed || "").trim();
        if (f && f.length > 30 && (wantsHindi ? scriptShare(f) > 0.5 : scriptShare(f) < 0.2)) {
          console.log(`answer-language seatbelt: translated a ${wantsHindi ? "English→Hindi" : "Hindi→English"} slip (${shown.length}→${f.length} ch)`);
          shown = f;
        }
      } catch {
        /* keep the original */
      }
    }
    if (inviteFix && seekerMember) writeLog({ at: new Date().toISOString(), q: message, flaggedWrong: true, member: true });
    // Every response costs ONE credit (owner's rule) — teaching answers,
    // handoffs, link replies alike. Only outright errors (the catch below) are free.
    let balance = seekerCredits;
    if (seekerUid && seekerCredits !== null) {
      try {
        balance = users.spendCredit(seekerUid, 1);
      } catch {
        /* registry best-effort */
      }
    }
    json(res, 200, {
      answer: shown,
      sources,
      ...(seekerMember ? { member: true } : {}), // the app/UI can know they're a member
      ...(suggest && profile ? { suggest } : {}),
      ...(followups.length ? { followups } : {}),
      ...(checkin ? { checkin } : {}),
      ...(sadhana ? { sadhana } : deniesPractice ? { sadhana: "-" } : {}), // a new declaration wins; otherwise "-" forgets it
      ...(quote ? { quote } : {}),
      // only a MEMBER is invited to teach a correction (server-gated)
      ...(inviteFix && seekerMember ? { correctionInvite: true } : {}),
      ...(balance !== null ? { credits: balance } : {}),
    });
  } catch (err) {
    if (err instanceof LlmAuthError) {
      console.error("chat auth error:", err.message);
      writeLog({ ...logEntry, error: "auth" });
      return json(res, 503, { error: "The chatbot's API key is invalid — check the .env file." });
    }
    if (err instanceof LlmRateLimitError) {
      console.error("chat rate-limited (free tier per-minute cap)");
      writeLog({ ...logEntry, error: "rate-limited" });
      return json(res, 503, { error: "The chatbot is very busy right now — try again in a minute." });
    }
    console.error("chat error:", err);
    writeLog({ ...logEntry, error: "failed" });
    json(res, 500, { error: "Something went wrong — please try again." });
  }
}

// ——— the ear: transcribe a short recorded question via Groq Whisper ———
// EVERY device records a few seconds of audio and POSTs it here; Groq's Whisper
// (large-v3 → turbo) transcribes it. This is the SOLE speech-to-text path now —
// no on-device recognizer, no Gemini — so every seeker hears through the same
// accurate Hindi/Hinglish ear (owner, 2026-07-22).
async function handleStt(req, res) {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip, "stt", 40)) return json(res, 429, { error: "Too many requests." });
  if (!GEMINI_TTS_KEY && !process.env.GROQ_API_KEY) return json(res, 503, { error: "stt-not-configured" });
  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 3_000_000) return json(res, 413, { error: "Recording too long." });
  }
  let audio = "", mime = "", lang = "", src = "", topics = [];
  try {
    const p = JSON.parse(body);
    audio = String(p.audio || "");
    mime = String(p.mime || "audio/mp4").split(";")[0].trim().toLowerCase();
    lang = String(p.lang || "");
    src = String(p.src || "");
    topics = (Array.isArray(p.topics) ? p.topics : [])
      .filter((t) => typeof t === "string")
      .slice(-5)
      .map((t) => t.slice(0, 120));
  } catch {
    return json(res, 400, { error: "Invalid JSON." });
  }
  if (!audio) return json(res, 400, { error: "No audio." });
  const OK_MIME = new Set(["audio/mp4", "audio/aac", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm", "audio/aiff", "audio/flac", "audio/x-m4a", "audio/m4a"]);
  if (!OK_MIME.has(mime)) mime = "audio/mp4";
  if (mime === "audio/x-m4a" || mime === "audio/m4a") mime = "audio/mp4";
  let lastDetail = "";
  // EVERY seeker hears through Groq's Whisper — the SOLE ear across all browsers
  // and the app (owner, 2026-07-22). Groq is a dedicated speech model with its
  // own roomy free quota; we NEVER fall through to Gemini, by the owner's cost
  // rule (Gemini listening burns the shared free tier / costs on a paid plan).
  // If Groq fails or is unconfigured, the seeker gets "please try again" — never
  // a Gemini transcription. (Bare block below: it returns on every path.)
  {
    if (!process.env.GROQ_API_KEY) {
      // This reached a seeker's phone once (2026-07-19) with the key present and
      // correct in .env, and left NO trace in the log — so it could not be
      // traced afterwards. Two guards now: shout in the log, and try re-reading
      // .env before refusing, in case this process started before it was there.
      try {
        const envFile = path.join(ROOT, ".env");
        if (existsSync(envFile)) {
          for (const line of readFileSync(envFile, "utf8").split("\n")) {
            const m = line.match(/^\s*GROQ_API_KEY\s*=\s*(.+?)\s*$/);
            if (m) process.env.GROQ_API_KEY = m[1].replace(/^["']|["']$/g, "");
          }
        }
      } catch {
        /* fall through to the refusal below */
      }
      if (!process.env.GROQ_API_KEY) {
        console.error("stt REFUSED: GROQ_API_KEY missing from the running process (iOS ear is down)");
        return json(res, 503, { error: "stt-not-configured", detail: "groq key missing" });
      }
      console.warn("stt: GROQ_API_KEY was absent from the process — reloaded it from .env");
    }
    const ext = mime.includes("webm") ? "webm" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "m4a";
    const bytes = Buffer.from(audio, "base64");
    const blob = new Blob([bytes], { type: mime });
    const l = lang.toLowerCase();
    // Language: the audience is ~97% Hindi and the app's default toggle is
    // Hindi, so trust "hi" and force it (Whisper is most accurate when the
    // language is known). But when the toggle says English we DON'T force —
    // auto-detect — so a Hindi speaker on the English toggle still works and
    // Hinglish isn't mangled. A SHORT spelling hint only: a long Devanagari
    // prompt makes Whisper echo/hallucinate it on quiet or very short clips
    // (exactly why "जय सिया राम" was coming back garbled).
    const forceHi = !l || l.startsWith("hi");
    // FULL large-v3 first — markedly better Hindi than turbo; turbo is the
    // separate-quota fallback.
    for (const model of ["whisper-large-v3", "whisper-large-v3-turbo"]) {
      try {
        const fd = new FormData();
        fd.append("file", blob, `voice.${ext}`);
        fd.append("model", model);
        fd.append("temperature", "0");
        fd.append("response_format", "verbose_json"); // gives detected language + duration for diagnostics
        // The spelling hint must match the clip's language: English clips got the
        // Devanagari hint (useless there) and Whisper invented spellings for the
        // brand words — "Aashany/Ashaan/Ashyam" for Ashaeiynn, "bog" for bhog
        // (owner, 2026-07-24). Kept SHORT on purpose: a long prompt makes Whisper
        // echo it back on quiet or very short clips.
        // Conversation terms join the hint ONLY on clips long enough to be real
        // speech (>~2s): very short clips are where hint-echo lives, so they get
        // the plain fixed hint alone (owner's guard, 2026-07-25).
        const convTerms = bytes.length > 32000 ? topicHint(topics) : [];
        const hintTail = convTerms.length ? ", " + convTerms.join(", ") : "";
        fd.append(
          "prompt",
          forceHi
            ? "जय सिया राम। Ashaeiynn, महोत्सव, साधना, जाप, ध्यान, गुरुदेव, पाठशाला" + hintTail + "।"
            : "Jai Siya Ram. Ashaeiynn, Parikshit Bhaiya, Pathshala, hawan, bhog, samagri, jaap, sadhana, Mahotsav" + hintTail + ".",
        );
        if (forceHi) fd.append("language", "hi");
        else if (l.startsWith("en")) fd.append("language", "en");
        bumpSttUsage(); // every request sent counts against Groq's daily free quota
        const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
          body: fd,
        });
        if (r.ok) {
          const data = await r.json();
          const text = String(data.text || "").trim();
          // one diagnostic line per transcription — lets us SEE what the phone
          // actually sent (bytes, format) and what Whisper heard, without guessing
          console.log(`stt ok: ${model} · ${(bytes.length / 1024).toFixed(0)}KB ${mime} · lang=${forceHi ? "hi(forced)" : l || "auto"}→${data.language || "?"} · ${Number(data.duration || 0).toFixed(1)}s · "${text.slice(0, 80)}"`);
          // Whisper's own confidence: a transcription it wasn't sure about goes
          // to the admin's review list, so it can become a taught correction.
          if (text) {
            const segs = Array.isArray(data.segments) ? data.segments : [];
            const avgLp = segs.length ? segs.reduce((n, s) => n + (s.avg_logprob ?? 0), 0) / segs.length : 0;
            const worstNs = segs.length ? Math.max(...segs.map((s) => s.no_speech_prob ?? 0)) : 0;
            if (segs.length && (avgLp < -0.75 || worstNs > 0.6)) {
              noteDoubtfulHearing({
                at: new Date().toISOString(),
                heard: fixMishearings(text).slice(0, 160),
                lang: data.language || (forceHi ? "hi" : l || "auto"),
                secs: Math.round(Number(data.duration || 0)),
                conf: Number(avgLp.toFixed(2)),
              });
            }
            return json(res, 200, { text: fixMishearings(text.slice(0, 2000)) });
          }
          lastDetail = `groq ${model}: empty transcription (${(bytes.length / 1024).toFixed(0)}KB, ${Number(data.duration || 0).toFixed(1)}s)`;
        } else {
          lastDetail = `groq ${model} ${r.status}: ${(await r.text()).slice(0, 60)}`;
        }
      } catch (err) {
        lastDetail = "groq: " + String(err?.message || err).slice(0, 120);
      }
    }
    console.error("stt error:", lastDetail, `· ${(bytes.length / 1024).toFixed(0)}KB ${mime}`);
    return json(res, 503, { error: "Couldn't hear that — please try again.", detail: lastDetail });
  }
}

// ——— आज का विचार: one thought per day from the teachings, same for everyone ———
// The passage is picked deterministically by the date; a single light model
// call per day trims it into a clean 2–3 line thought (cached in memory AND
// on disk, so restarts don't re-spend the call). data/thought.json is
// gitignored — it regenerates anywhere.
let thoughtCache = { date: "", data: null };
const THOUGHT_FILE = path.join(ROOT, "data", "thought.json");
// A garbled transcript makes the model REFUSE ("this passage is corrupted…")
// — reject any such meta-commentary, and any answer that isn't real Hindi. Used
// both to validate a freshly generated thought AND to throw away a previously
// cached bad one so it regenerates without needing the file cleared by hand.
const thoughtLooksBad = (t) => {
  if (!t || t.trim().length < 12) return true;
  if (/corrupt|fragment|garbled|poorly transcribed|provide a clear|clearer passage|cannot (extract|provide|generate)|coherent|logical continuity|no clear meaning|repetitive phrases|incomplete sentence|as an ai|i'?m sorry|i cannot|does not contain|unable to/i.test(t)) return true;
  if ((t.match(/[ऀ-ॿ]/g) || []).length < 6) return true; // essentially no Hindi → off-script
  return false;
};
async function handleThought(req, res) {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (thoughtCache.date === date && thoughtCache.data) return json(res, 200, thoughtCache.data);
  try {
    const saved = JSON.parse(readFileSync(THOUGHT_FILE, "utf8"));
    if (saved.date === date && saved.text && !thoughtLooksBad(saved.text)) {
      thoughtCache = { date, data: saved };
      return json(res, 200, saved);
    }
  } catch {
    /* no saved thought yet */
  }
  const candidates = thoughtCandidate(date);
  if (!candidates.length) return json(res, 200, {});
  const looksBad = thoughtLooksBad;
  let text = "", chosen = null;
  if (apiKeyConfigured) {
    for (const c of candidates) {
      let t = "";
      try {
        t = (
          await complete({
            system:
              "You are given a rough passage from a guru's SPOKEN teaching (auto-transcribed, so it may be messy). Write ONE short, self-contained, uplifting daily thought — 2 to 3 sentences, at most 60 words — in simple spoken Hindi (Devanagari), true to what the passage is about. Output ONLY the thought itself. NEVER mention or comment on the passage or its quality; if it reads messy, still give a beautiful short thought in the same spirit. No English, no preamble, no meta-commentary.",
            messages: [{ role: "user", content: c.content.slice(0, 1500) }],
            maxTokens: 160,
            light: true,
            retry: false,
          })
        )
          .trim()
          .slice(0, 400);
      } catch {
        continue;
      }
      if (!looksBad(t)) {
        text = t;
        chosen = c;
        break;
      }
    }
  }
  // Nothing clean today → skip the thought entirely rather than show garbage or
  // invent content (the widget simply omits the card). Not cached, so it retries.
  if (!text) return json(res, 200, {});
  const data = {
    date,
    text,
    title: chosen.title,
    url: chosen.url ? `${chosen.url}#t=${Math.floor(chosen.start_seconds || 0)}s` : null,
  };
  try {
    writeFileSync(THOUGHT_FILE, JSON.stringify(data, null, 2));
  } catch {
    /* disk cache is best-effort */
  }
  thoughtCache = { date, data };
  return json(res, 200, data);
}

// ——— personal-guide helpers (stateless: the seeker's diary lives on their device) ———

// Distill the seeker's recent questions into a one-line journey summary the
// device stores and sends back with future questions. One cheap "light" call.
async function handleDistill(req, res) {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
  if (!apiKeyConfigured) return json(res, 503, { error: "not-configured" });
  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 20_000) return json(res, 413, { error: "Too long." });
  }
  let qs = [];
  try {
    qs = (JSON.parse(body).questions || [])
      .filter((q) => typeof q === "string" && q.trim())
      .slice(-30)
      .map((q) => q.slice(0, 120));
  } catch {
    return json(res, 400, { error: "Invalid JSON." });
  }
  if (qs.length < 3) return json(res, 400, { error: "Need a few questions first." });
  try {
    const raw = await complete({
      system:
        'You study a spiritual seeker\'s recent questions to a meditation-centre guide. Output ONLY JSON: {"summary": "<ONE warm factual line in Hindi (Devanagari, max 25 words) naming their main themes>", "style": "<ONE short English line describing HOW this seeker communicates and what delivery suits them — e.g. prefers short direct answers; mixes English terms; asks step-by-step. Empty string if nothing clear.>"}',
      messages: [{ role: "user", content: qs.join("\n") }],
      maxTokens: 160,
      light: true,
      retry: false,
    });
    const m = raw.match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : { summary: raw.split("\n")[0] };
    return json(res, 200, {
      summary: String(p.summary || "").trim().slice(0, 300),
      style: String(p.style || "").trim().slice(0, 160),
    });
  } catch {
    return json(res, 503, { error: "busy" });
  }
}

// A fresh "watch next" for a returning seeker, matched to their whole journey
// (summary + recent topics), excluding what they've already seen. Free (local search).
async function handleNextStep(req, res) {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 30_000) return json(res, 413, { error: "Too long." });
  }
  let p = {};
  try {
    p = JSON.parse(body) || {};
  } catch {
    return json(res, 400, { error: "Invalid JSON." });
  }
  const topics = (Array.isArray(p.topics) ? p.topics : [])
    .filter((t) => typeof t === "string" && t.trim())
    .slice(-5)
    .map((t) => t.slice(0, 120));
  const summary = typeof p.summary === "string" ? p.summary.trim().slice(0, 300) : "";
  const seenSet = new Set(
    (Array.isArray(p.seen) ? p.seen : [])
      .filter((t) => typeof t === "string")
      .slice(-80)
      .map((t) => t.trim().toLowerCase()),
  );
  const queryText = [summary, ...topics].filter(Boolean).join(" ").trim();
  if (!queryText) return json(res, 200, {});
  const chunks = await searchMulti([queryText], 12);
  for (const c of chunks) {
    const t = c.title.toLowerCase();
    if (seenSet.has(t) || c.title.startsWith("Bhaiya's approved answer")) continue;
    // Owner's rule: a seeker may ONLY be pointed to a PUBLIC source — a Pathshala
    // article (ashaeiynn.com) or a YouTube video. Studio session files have no
    // public URL and must NEVER surface here (they were leaking raw filenames like
    // "session43_guru_tattva_pitru_post_complete" as the "यात्रा" suggestion —
    // owner, 2026-07-22). Prefer a readable article shown with its website link.
    if (!c.url || !publicUrl(c.url)) continue;
    const isArticle = /^\s*Article:/i.test(c.title);
    const isYouTube = /youtu\.?be|youtube\.com/i.test(c.url);
    if (!isArticle && !isYouTube) continue;
    return json(res, 200, {
      suggest: {
        title: c.title.replace(/^\s*Article:\s*/i, ""), // the article name, not the "Article:" prefix
        timestamp: isYouTube ? formatTimestamp(c.start_seconds) : "",
        url: isYouTube ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : c.url,
      },
    });
  }
  return json(res, 200, {});
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && url.pathname === "/api/tts") return handleTts(req, res);
  if (req.method === "POST" && url.pathname === "/api/distill") return handleDistill(req, res);
  if (req.method === "POST" && url.pathname === "/api/next-step") return handleNextStep(req, res);
  if (req.method === "POST" && url.pathname === "/api/stt") return handleStt(req, res);
  if (req.method === "GET" && url.pathname === "/api/thought") return handleThought(req, res);
  // ——— push notifications (the guide's doorbell) ———
  if (req.method === "GET" && url.pathname === "/sw.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(readFileSync(path.join(ROOT, "widget", "sw.js")));
  }
  if (req.method === "GET" && url.pathname === "/api/push/key") {
    return json(res, 200, { ready: push.pushReady(), key: push.publicKey() });
  }
  // The in-bot notice the widget shows on open (public — it is shown to seekers).
  // null when there is nothing current or it has aged out.
  if (req.method === "GET" && url.pathname === "/api/announcement") {
    return json(res, 200, { announcement: getAnnouncement() });
  }
  // One-letter gender read of a first name so the guide's spoken welcome can say
  // भाई/बहन without ever misgendering (unsure stays जी — same rule as answers).
  // ONE light-model call per unique name for the process life; the device then
  // stores the letter forever, so per seeker this costs one tiny call ever.
  if (req.method === "GET" && url.pathname === "/api/gender") {
    const name = String(url.searchParams.get("name") || "").trim().slice(0, 40);
    if (!name || !apiKeyConfigured) return json(res, 200, { g: "u" });
    const gk = name.toLowerCase();
    if (genderCache.has(gk)) return json(res, 200, { g: genderCache.get(gk) });
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip, "light", 30)) return json(res, 429, { error: "Too many requests." });
    let g = "u";
    try {
      const out = await complete({
        system:
          "You classify Indian first names by the gender they most commonly indicate. Reply with exactly one letter: m (clearly male), f (clearly female), or u (unisex, unclear, or not a name). Nothing else.",
        messages: [{ role: "user", content: name }],
        maxTokens: 3,
        light: true,
        retry: false,
      });
      const c = String(out || "").trim().toLowerCase()[0];
      if (c === "m" || c === "f") g = c;
    } catch {
      /* unsure is always the safe answer */
    }
    genderCache.set(gk, g);
    return json(res, 200, { g });
  }
  // the seeker's own right: delete their account (registry + notifications)
  if (req.method === "POST" && url.pathname === "/api/account/delete") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 2_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const uid = String(JSON.parse(body).uid || "").slice(0, 30);
      if (uid) {
        users.markDeleted(uid, "user deleted account");
        push.removeByUid?.(uid);
      }
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }

  // ——— the main app enrols one of ITS users into the guide ———
  // The app already knows the person (name, email, phone), so the guide never
  // asks — the app POSTs them here on first open, keyed by the app's own uid, and
  // they are marked a MEMBER of Ashaeiynn. Authenticated with the shared APP_KEY;
  // details travel in the BODY, never a URL. Idempotent — safe to call every open.
  if (req.method === "POST" && url.pathname === "/api/app/register") {
    if (!APP_KEY) return json(res, 501, { error: "app-enrolment not configured (set APP_KEY)" });
    if (req.headers["x-app-key"] !== APP_KEY) return json(res, 401, { error: "unauthorized" });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 5_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      const uid = String(p.uid || "").trim().slice(0, 64);
      if (!uid) return json(res, 400, { error: "uid is required." });
      const u = users.upsertById(uid, {
        name: p.name,
        nick: p.nick,
        whatsapp: p.whatsapp ?? p.phone,
        email: p.email,
        member: p.member === false ? false : true, // app users are members by default
      });
      return json(res, 200, { ok: true, uid: u.id, member: !!u.member });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || "Could not enrol.") });
    }
  }

  // ——— sign-up: the guide asks who is arriving (member registry) ———
  if (req.method === "POST" && url.pathname === "/api/signup") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 5_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const u = users.register(JSON.parse(body));
      return json(res, 200, { uid: u.id, nick: u.nick, credits: Number(u.credits || 0) });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || "Could not sign up.") });
    }
  }

  // the widget reads the seeker's live balance on open (so the 🪙 coin is fresh
  // even after the admin tops them up between sessions)
  if (req.method === "GET" && url.pathname === "/api/credits") {
    const uid = String(url.searchParams.get("uid") || "").slice(0, 40);
    return json(res, 200, { credits: uid ? users.credits(uid) : 0 });
  }
  if (req.method === "POST" && (url.pathname === "/api/push/subscribe" || url.pathname === "/api/push/unsubscribe")) {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 10_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      if (url.pathname === "/api/push/subscribe") push.addSub(p.subscription || p, p.lang, String(p.uid || "").slice(0, 30));
      else push.removeSub(String(p.endpoint || ""));
      return json(res, 200, { ok: true });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }
  // one-tap answer feedback (सहायक / नहीं) — logged for the admin's review
  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 5_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      // two kinds of notes: a vote on an answer, or "a suggested video/article
      // was actually opened" (anonymous — feeds the nightly recommendation study)
      if (p.opened) {
        writeLog({ at: new Date().toISOString(), reco: "opened", title: String(p.title || "").slice(0, 120) });
        return json(res, 200, { ok: true });
      }
      writeLog({
        at: new Date().toISOString(),
        feedback: p.helpful ? "up" : "down",
        q: String(p.q || "").slice(0, 400),
      });
      // A member tapping 👎 is an explicit "this was wrong" — invite them to
      // teach the correction (members only; the box only appears if we say so).
      let invite = false;
      if (!p.helpful && p.uid) {
        try {
          const u = users.byId?.(String(p.uid).slice(0, 40));
          invite = !!(u && u.member && !u.deleted);
        } catch { /* registry best-effort */ }
      }
      return json(res, 200, { ok: true, ...(invite ? { invite: true } : {}) });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }

  // A MEMBER suggests the correct answer for a question the bot got wrong.
  // Stored PENDING — never touches the knowledge base until the admin approves.
  if (req.method === "POST" && url.pathname === "/api/suggest") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip, "light", 60)) return json(res, 429, { error: "Too many requests." });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 12_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      const uid = String(p.uid || "").slice(0, 40);
      // members only — verify server-side, never trust the client
      let u = null;
      try {
        u = uid ? users.byId?.(uid) : null;
      } catch { /* registry best-effort */ }
      if (!u || !u.member || u.deleted) return json(res, 403, { error: "members-only" });
      // Members write corrections the way people talk — "I am correcting you,
      // next time someone asks about X, say…". Filed literally, that sentence
      // became the question key and the correction NEVER fired (seen live
      // 2026-07-18). So read the exchange and work out what question this
      // teaching actually answers, and keep only the teaching itself.
      let qKey = String(p.q || "").trim();
      let teaching = String(p.suggestion || "").trim();
      try {
        const raw = await complete({
          system:
            'A member of a spiritual centre is correcting the guide-bot. Read the exchange and the member\'s message, then output ONLY JSON: {"q": "<the question this teaching answers, written the way a seeker would actually ask it — if the member names the question (\\"next time someone asks about X\\") use THAT, otherwise use the question the bot was answering. Same language the member used.>", "answer": "<the member\'s teaching alone, with any framing removed — drop \\"I am correcting you\\", \\"next time someone asks\\", \\"you should say\\" and similar. Keep their words and every specific detail: numbers, timings, names.>"}',
          messages: [
            {
              role: "user",
              content: `Question the bot was answering: ${p.q}\n\nBot's answer: ${String(p.answer || "").slice(0, 1500)}\n\nMember's correction: ${teaching}`,
            },
          ],
          maxTokens: 700,
          light: true,
          retry: false,
        });
        const m = raw.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : null;
        if (parsed?.q?.trim()) qKey = parsed.q.trim().slice(0, 300);
        if (parsed?.answer?.trim()) teaching = parsed.answer.trim();
      } catch {
        /* best-effort — fall back to exactly what the member sent */
      }
      const item = addSuggestion({
        q: qKey,
        askedQ: String(p.q || "").trim(),
        rawSuggestion: String(p.suggestion || "").trim(),
        botAnswer: p.answer,
        suggestion: teaching,
        uid,
        nick: u.nick || u.name || "",
        member: true,
      });
      return item ? json(res, 200, { ok: true }) : json(res, 400, { error: "Nothing to suggest." });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }

  // Health check — for hosting platforms and to confirm a deploy is live.
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      provider: PROVIDER,
      model: ACTIVE_MODEL,
      // true only on the studio Mac, where whisper transcription is installed
      teachMedia: existsSync(`${process.env.HOME}/Library/Python/3.9/bin/mlx_whisper`),
      apiKeyConfigured,
      backup: BACKUP_CONFIGURED ? { ready: true, lastUsed: failover.at, answers: failover.count } : false,
      naturalVoice: !NATURAL_TTS
        ? false
        : SARVAM_KEY
          ? `sarvam:${SARVAM_VOICE}`
          : TTS_KEY
            ? "elevenlabs"
            : GEMINI_TTS_KEY
              ? "gemini"
              : false,
      // the ONLY ear for every device (Whisper via Groq — never Gemini)
      iosEar: process.env.GROQ_API_KEY ? "groq-whisper" : "not-configured",
      // how much of Groq's free daily quota today's listening has used
      earToday: { used: sttUsedToday(), freeLimit: STT_FREE_LIMIT },
      knowledgeBase: existsSync(path.join(ROOT, "data", "knowledge.db")) ? "built" : "missing",
      // so a half-built memory is visible without reading the server log
      ...(lastAudit
        ? {
            knowledge: lastAudit.missing.length
              ? { ok: false, learnt: lastAudit.learnt, onDisk: lastAudit.onDisk, missing: lastAudit.missing.slice(0, 5) }
              : { ok: true, sources: lastAudit.learnt },
          }
        : {}),
    });
  }

  // Admin portal: review every question the bot was asked and how it answered.
  if (req.method === "GET" && url.pathname === "/admin") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(readFileSync(path.join(ROOT, "widget", "admin.html")));
  }
  // shared guard for every /api/admin/* route
  const adminOk = () => {
    if (!ADMIN_KEY) {
      json(res, 501, { error: "admin-not-configured" });
      return false;
    }
    if (req.headers["x-admin-key"] !== ADMIN_KEY) {
      const ip = req.socket.remoteAddress ?? "unknown";
      json(res, rateLimited(ip) ? 429 : 401, { error: "unauthorized" });
      return false;
    }
    return true;
  };

  // ——— teach the bot: uploads, links, pasted text, job progress ———
  // Original names of everything ever uploaded (upload files are kept and are
  // saved as "<id>-<original name>") — used to skip same-name duplicates.
  const uploadedNames = () =>
    readdirSync(uploadsDir).map((f) => f.replace(/^[a-z0-9]+-/, "").toLowerCase());

  if (req.method === "GET" && url.pathname === "/api/admin/uploaded-names") {
    if (!adminOk()) return;
    return json(res, 200, { names: uploadedNames() });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/upload") {
    if (!adminOk()) return;
    const name = decodeURIComponent(req.headers["x-file-name"] || "").replace(/[/\\]/g, "_").trim();
    const title = decodeURIComponent(req.headers["x-title"] || "").trim();
    if (!name) return json(res, 400, { error: "Missing file name." });
    // A matching FILE NAME is not the same thing as matching content. The owner
    // re-uploaded an English version of a teaching under its original name and
    // was told "duplicate skipped — nothing new to study" (2026-07-19). The
    // guard stays (it catches the real accident — the same file sent twice), but
    // the portal can now say "teach it anyway" and send x-replace.
    if (uploadedNames().includes(name.toLowerCase()) && req.headers["x-replace"] !== "1") {
      req.resume(); // drain the body so the connection closes cleanly
      return json(res, 409, { error: "duplicate", duplicate: true, name });
    }
    const dest = path.join(uploadsDir, `${Date.now().toString(36)}-${name}`);
    try {
      const ws = createWriteStream(dest);
      let size = 0;
      req.on("data", (d) => {
        size += d.length;
        if (size > 3_000_000_000) req.destroy(new Error("too large"));
      });
      req.pipe(ws);
      await new Promise((resolve, reject) => {
        ws.on("finish", resolve);
        ws.on("error", reject);
        req.on("error", reject);
      });
      return json(res, 200, { job: teachFile(dest, title) });
    } catch (err) {
      rmSync(dest, { force: true });
      return json(res, 400, { error: String(err?.message || err).slice(0, 200) });
    }
  }
  if (req.method === "POST" && (url.pathname === "/api/admin/link" || url.pathname === "/api/admin/text")) {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 2_000_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      const job =
        url.pathname === "/api/admin/link"
          ? teachLink(String(p.url || "").trim(), String(p.title || ""))
          : teachText(String(p.title || ""), String(p.content || ""));
      return json(res, 200, { job });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || err).slice(0, 200) });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/admin/jobs") {
    if (!adminOk()) return;
    return json(res, 200, { jobs: publicJobs(), totals: jobTotals() });
  }
  // The admin has read the outcome — drop finished and failed jobs so the
  // panel stops showing them forever.
  if (req.method === "POST" && url.pathname === "/api/admin/jobs/clear") {
    if (!adminOk()) return;
    return json(res, 200, { cleared: clearFinished() });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/study-existing") {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 10_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      const f = path.basename(String(p.file || ""));
      const full = path.join(uploadsDir, f);
      if (!f || !existsSync(full)) return json(res, 404, { error: "No such uploaded file." });
      return json(res, 200, { job: teachFile(full, String(p.title || "")) });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || err).slice(0, 200) });
    }
  }

  // ——— edited (Bhaiya-approved) answers ———
  if (req.method === "GET" && url.pathname === "/api/admin/corrections") {
    if (!adminOk()) return;
    return json(res, 200, { items: await listCorrections() });
  }
  // the ear's doubtful hearings — low-confidence transcriptions for review
  if (req.method === "GET" && url.pathname === "/api/admin/stt-review") {
    if (!adminOk()) return;
    return json(res, 200, { items: [...sttReview].reverse() }); // newest first
  }
  // ——— notifications: status+history, and manual send to everyone ———
  if (req.method === "GET" && url.pathname === "/api/admin/push") {
    if (!adminOk()) return;
    return json(res, 200, {
      ready: push.pushReady(),
      subscribers: push.subCount(),
      log: push.pushLog(),
      queued: push.queuedNotifications(),
      announcement: getAnnouncement(),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/push/cancel") {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) body += part;
    try {
      return json(res, 200, { removed: push.cancelScheduled(String(JSON.parse(body).id || "")) });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }
  // Take the current in-bot notice down early (before it ages out on its own).
  if (req.method === "POST" && url.pathname === "/api/admin/announcement/clear") {
    if (!adminOk()) return;
    clearAnnouncement();
    return json(res, 200, { cleared: true });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/push/send") {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 20_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      const title = String(p.title || "").trim().slice(0, 80) || "Ask Your Guide";
      const text = String(p.body || "").trim().slice(0, 300);
      if (!text) return json(res, 400, { error: "Message text needed." });
      const link = String(p.url || "").trim().slice(0, 300);
      // optional scheduling: datetime-local value is IST by convention
      if (p.when) {
        const at = new Date(String(p.when).slice(0, 16) + ":00+05:30");
        if (isNaN(at)) return json(res, 400, { error: "Invalid schedule time." });
        if (at.getTime() < Date.now() + 60_000)
          return json(res, 400, { error: "Scheduled time is in the past — pick a future time or leave it empty." });
        // The in-bot notice is set when the schedule FIRES (push.processQueue),
        // not now, so it doesn't greet seekers before its time.
        return json(res, 200, { scheduled: true, item: push.scheduleNotification(title, text, link, at.toISOString()) });
      }
      // Every admin notification also becomes the in-bot notice shown on open —
      // this is how it reaches app users (who have no phone push). Set here,
      // independent of push readiness, so it works even where push is disabled.
      setAnnouncement({ title, text, link });
      const result = await push.sendToAll(title, text, link, "admin");
      return json(res, 200, { ...result, inBot: true });
    } catch (err) {
      return json(res, 503, { error: String(err?.message || "send failed") });
    }
  }

  // ——— nightly self-learned communication lessons (style only, read-only) ———
  if (req.method === "GET" && url.pathname === "/api/admin/style-notes") {
    if (!adminOk()) return;
    try {
      return json(res, 200, JSON.parse(readFileSync(path.join(ROOT, "data", "style-notes.json"), "utf8")));
    } catch {
      return json(res, 200, { notes: [] });
    }
  }
  // ——— the Users tab: member registry with computed status ———
  // Second lock on top of admin, SAME password as the Library — member
  // details (names, WhatsApp, email) are personal and deserve the extra door.
  const usersOk = () => {
    if (!adminOk()) return false;
    if (LIBRARY_KEY && req.headers["x-library-key"] !== LIBRARY_KEY) {
      json(res, 403, { error: "users-locked" });
      return false;
    }
    return true;
  };
  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    if (!usersOk()) return;
    const subs = new Set(push.subUids?.() || []);
    return json(res, 200, { users: users.listUsers().map((u) => ({ ...u, subscribed: subs.has(u.id) })) });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/user-update") {
    if (!usersOk()) return;
    let body = "";
    for await (const part of req) body += part;
    try {
      const p = JSON.parse(body);
      const u = users.setFlags(String(p.id || ""), p);
      return u ? json(res, 200, { ok: true }) : json(res, 404, { error: "User not found." });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }
  // admin adds question-credits to a seeker (Users tab) — the only way to top up
  if (req.method === "POST" && url.pathname === "/api/admin/user-credits") {
    if (!usersOk()) return;
    let body = "";
    for await (const part of req) body += part;
    try {
      const p = JSON.parse(body);
      const amount = Math.floor(Number(p.amount) || 0);
      if (amount <= 0 || amount > 1_000_000) return json(res, 400, { error: "Enter a positive amount." });
      const bal = users.addCredits(String(p.id || ""), amount);
      return bal !== null ? json(res, 200, { ok: true, credits: bal }) : json(res, 404, { error: "User not found." });
    } catch {
      return json(res, 400, { error: "Invalid JSON." });
    }
  }

  // ——— the Learning tab: current mind + its night-by-night growth ———
  if (req.method === "GET" && url.pathname === "/api/admin/learning") {
    if (!adminOk()) return;
    let current = { core: [], notes: [] };
    let history = [];
    try {
      current = JSON.parse(readFileSync(path.join(ROOT, "data", "style-notes.json"), "utf8"));
    } catch {
      /* no review yet */
    }
    try {
      history = JSON.parse(readFileSync(path.join(ROOT, "data", "learning-history.json"), "utf8")).slice(-30);
    } catch {
      /* no history yet */
    }
    return json(res, 200, { current, history });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/correction") {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 100_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      return json(res, 200, { item: await addCorrection(p.q, p.answer) });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || err).slice(0, 200) });
    }
  }
  if (req.method === "DELETE" && url.pathname === "/api/admin/correction") {
    if (!adminOk()) return;
    return json(res, 200, { removed: await removeCorrection(url.searchParams.get("id")) });
  }

  // ——— "latest knowledge wins" review: newer sources that may update a correction ———
  if (req.method === "GET" && url.pathname === "/api/admin/supersede") {
    if (!adminOk()) return;
    try {
      return json(res, 200, { items: await supersedeReview({ bestNewerMatch }) });
    } catch (err) {
      return json(res, 200, { items: [], error: String(err?.message || err).slice(0, 120) });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/admin/supersede") {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 100_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      if (p.action === "dismiss") {
        dismissSupersede(String(p.id || ""), String(p.source || ""));
        return json(res, 200, { dismissed: true });
      }
      // "update" — refresh the correction's answer to the newer content (edited by
      // the admin). The correction stays as the retrieval anchor for its question.
      const text = String(p.answer || "").trim();
      if (!text) return json(res, 400, { error: "The updated answer is empty." });
      const item = await updateCorrectionAnswer(String(p.id || ""), text);
      return json(res, 200, { updated: true, item });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || err).slice(0, 200) });
    }
  }

  // ——— seeker-suggested corrections: the admin's approval gate ———
  if (req.method === "GET" && url.pathname === "/api/admin/suggestions") {
    if (!adminOk()) return;
    return json(res, 200, { items: listSuggestions() });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/suggestion") {
    if (!adminOk()) return;
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 100_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      const s = getSuggestion(String(p.id || ""));
      if (!s) return json(res, 404, { error: "Suggestion not found." });
      if (p.action === "approve") {
        // the admin's (possibly edited) text becomes a real approved answer —
        // the SAME pipeline as the admin's own edits, so the bot learns it
        const text = String(p.answer || s.suggestion || "").trim();
        if (!text) return json(res, 400, { error: "Nothing to approve — add the correct answer first." });
        const question = String(p.question || s.q || "").trim();
        // File it under a few natural rewordings too, so the next seeker who
        // asks the same thing in their own words (or the other language) still
        // gets Bhaiya's approved teaching. addCorrection drops any paraphrase
        // that is not genuinely the same question.
        let alts = [];
        try {
          const raw = await complete({
            system:
              'Output ONLY a JSON array of 4 strings: the SAME question as a seeker might really ask it — (1) in Hindi (Devanagari script), (2) in English, (3) in Hinglish (Hindi written in Latin letters), (4) one more natural rewording in Hindi. Same meaning exactly, never broader, never a related question. No explanation.',
            messages: [{ role: "user", content: question }],
            maxTokens: 300,
            light: true,
            retry: false,
          });
          const m = raw.match(/\[[\s\S]*\]/);
          if (m) alts = JSON.parse(m[0]).filter((x) => typeof x === "string");
        } catch {
          /* best-effort — the main question key always works on its own */
        }
        const item = await addCorrection(question, text, alts);
        removeSuggestion(s.id);
        return json(res, 200, { approved: true, item });
      }
      // reject
      removeSuggestion(s.id);
      return json(res, 200, { rejected: true });
    } catch (err) {
      return json(res, 400, { error: String(err?.message || err).slice(0, 200) });
    }
  }

  // ——— library: everything the bot has studied (extra password on top of admin) ———
  const libOk = () => {
    if (!adminOk()) return false;
    if (LIBRARY_KEY && req.headers["x-library-key"] !== LIBRARY_KEY) {
      json(res, 403, { error: "library-locked" });
      return false;
    }
    return true;
  };
  const transcriptsDir = path.join(ROOT, "data", "transcripts");
  const sourceType = (file, d) => {
    if (file.startsWith("about-")) return "curated";
    if (file.startsWith("note_")) return "note";
    if (file.startsWith("doc_")) return "document";
    if (file.startsWith("web_") || file.startsWith("art_")) return "article";
    if (file.startsWith("page_")) return "website";
    if (file.startsWith("audio_")) return "recording";
    if (file.startsWith("yt_") || /youtu/.test(d.url || "")) return "youtube";
    return "video";
  };
  const safeTranscript = (f) =>
    f && /^[A-Za-z0-9._ऀ-ॿ-]+\.json$/.test(f) && !f.includes("..") ? path.join(transcriptsDir, f) : null;

  if (req.method === "GET" && url.pathname === "/api/admin/library") {
    if (!libOk()) return;
    const items = [];
    for (const f of readdirSync(transcriptsDir)) {
      if (!f.endsWith(".json") || f.endsWith(".raw.json")) continue;
      try {
        const d = JSON.parse(readFileSync(path.join(transcriptsDir, f), "utf8"));
        items.push({
          file: f,
          title: d.title || f,
          url: d.url || "",
          type: sourceType(f, d),
          minutes: d.minutes || 0,
          parts: (d.segments || []).length,
          chars: (d.segments || []).reduce((n, s) => n + (s.text || "").length, 0),
          added: statSync(path.join(transcriptsDir, f)).mtimeMs,
        });
      } catch {
        /* skip unreadable file */
      }
    }
    // The Library lists transcript FILES. A file can exist while its study
    // failed, and it then looked "learnt" here while the bot knew nothing of it
    // (session8_aghor_panth, 2026-07-19). Mark what is actually searchable.
    try {
      const learnt = new Set(knownTitles());
      // a page we chose not to search is not a failure — leave it unflagged
      for (const it of items) it.learnt = learnt.has(it.title) || isExcludedTitle(it.title);
    } catch {
      /* if we cannot tell, say nothing rather than something wrong */
    }
    items.sort((a, b) => b.added - a.added);
    // Flag sources that teach the same thing as another — the admin decides what
    // to do; nothing is removed automatically.
    try {
      const dupes = duplicateSources();
      for (const it of items) {
        const d = dupes.find((x) => x.title === it.title);
        if (d) it.duplicateOf = { title: d.twin, share: d.share };
      }
    } catch {
      /* the report is a convenience — never let it break the library list */
    }
    return json(res, 200, { items });
  }
  if (url.pathname === "/api/admin/source") {
    if (!libOk()) return;
    const full = safeTranscript(url.searchParams.get("f"));
    if (!full || !existsSync(full)) return json(res, 404, { error: "not found" });
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": ALLOWED_ORIGIN });
      return res.end(readFileSync(full));
    }
    if (req.method === "DELETE") {
      let title = path.basename(full);
      try {
        title = JSON.parse(readFileSync(full, "utf8")).title || title;
      } catch { /* keep filename */ }
      return json(res, 200, { job: forget(path.basename(full), title) });
    }
  }
  if (req.method === "GET" && url.pathname === "/api/admin/backup") {
    if (!libOk()) return;
    const out = path.join(uploadsDir, `knowledge-backup-${Date.now().toString(36)}.zip`);
    try {
      await new Promise((resolve, reject) => {
        const p = spawn("/usr/bin/zip", ["-q", "-r", "-j", out, transcriptsDir]);
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`zip exited ${code}`))));
      });
      const buf = readFileSync(out);
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="ashaeiynn-knowledge.zip"',
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      });
      return res.end(buf);
    } catch (err) {
      return json(res, 500, { error: String(err?.message || err).slice(0, 200) });
    } finally {
      rmSync(out, { force: true });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/logs") {
    if (!adminOk()) return;
    let entries = [];
    try {
      const lines = readFileSync(QUESTIONS_LOG, "utf8").trim().split("\n");
      entries = lines
        .slice(-1000)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .reverse();
    } catch {
      /* no log file yet — empty portal */
    }
    return json(res, 200, { entries });
  }

  if (req.method === "GET" && url.pathname === "/logo.png") {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(readFileSync(path.join(ROOT, "widget", "logo.png")));
  }

  if (req.method === "GET" && url.pathname === "/manifest.webmanifest") {
    // no-cache: name/icon changes must reach installed apps without a fight
    res.writeHead(200, {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "no-cache",
    });
    return res.end(readFileSync(path.join(ROOT, "widget", "manifest.webmanifest")));
  }

  if (req.method === "GET" && /^\/icon-(192|512)\.png$/.test(url.pathname)) {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(readFileSync(path.join(ROOT, "widget", url.pathname.slice(1))));
  }

  // The 3D engine for the guide figure — vendored (no CDN; the widget stays
  // self-contained). Immutable: r128 never changes, so phones cache it once.
  if (req.method === "GET" && url.pathname === "/three.min.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    return res.end(readFileSync(path.join(ROOT, "widget", "three.min.js")));
  }

  if (req.method === "GET" && url.pathname === "/widget.js") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    return res.end(readFileSync(path.join(ROOT, "widget", "widget.js")));
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/demo")) {
    // no-cache: installed home-screen apps must always pick up fresh design
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(readFileSync(path.join(ROOT, "widget", "demo.html")));
  }

  // Full-screen guide for the main app's WebView — the live bot, no demo chrome,
  // opened straight away. The app points its "Guide" button here (optionally with
  // ?uid=&name= so the same person is the same seeker). Framed by the app only:
  // this page carries no X-Frame-Options, unlike the rest of the site.
  if (req.method === "GET" && url.pathname === "/app") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(readFileSync(path.join(ROOT, "widget", "app.html")));
  }

  json(res, 404, { error: "Not found" });
});

// Compare what is on disk with what the bot can actually search. A study that
// is interrupted leaves knowledge.db PARTIALLY built and nothing says so — the
// bot simply answers from less of Bhaiya's teaching, and the Library still lists
// every file as though all were fine. That is exactly what happened
// 2026-07-19 (down to 42 of 112 sources, unnoticed until a seeker's question
// went unanswered). Now it shouts.
function knowledgeAudit() {
  const onDisk = [];
  try {
    for (const f of readdirSync(path.join(ROOT, "data", "transcripts"))) {
      if (!f.endsWith(".json") || f.endsWith(".raw.json")) continue;
      try {
        const t = JSON.parse(readFileSync(path.join(ROOT, "data", "transcripts", f), "utf8")).title;
        if (t) onDisk.push(t);
      } catch {
        /* unreadable file — the ingester will report it */
      }
    }
  } catch {
    return null;
  }
  let learnt;
  try {
    learnt = new Set(knownTitles());
  } catch {
    return null; // knowledge not loaded yet — nothing to compare against
  }
  const missing = onDisk.filter((t) => !learnt.has(t) && !isExcludedTitle(t));
  return { onDisk: onDisk.length, learnt: learnt.size, missing };
}

let lastAudit = null;

server.listen(PORT, () => {
  console.log(`Chatbot server running:  http://localhost:${PORT}`);
  console.log(`Provider: ${PROVIDER} (${ACTIVE_MODEL})   |   API key configured: ${apiKeyConfigured ? "yes" : "NO — edit .env"}`);
  // Warm the embedding model so the first question isn't slow.
  warmup()
    .then(() => {
      console.log("Embedding model ready (cross-language search enabled).");
      lastAudit = knowledgeAudit();
      if (!lastAudit) return;
      if (lastAudit.missing.length) {
        console.error(
          `\n⚠️  KNOWLEDGE INCOMPLETE — ${lastAudit.missing.length} source(s) are on disk but NOT searchable.` +
            `\n    The bot is answering from ${lastAudit.learnt} of ${lastAudit.onDisk} sources.` +
            `\n    Run:  node pipeline/3-ingest.mjs   (then restart)` +
            `\n    Missing: ${lastAudit.missing.slice(0, 8).join(" · ")}${lastAudit.missing.length > 8 ? " …" : ""}\n`,
        );
      } else {
        console.log(`Knowledge check: all ${lastAudit.onDisk} sources are searchable.`);
      }
    })
    .catch(() => {});
});

// The guide's rare whispers: checked hourly — Sunday's article, festival eves.
// Each fires once; quiet before 8am IST; no-op until push is configured.
const whisperTick = () => push.autoWhispers(upcomingEvents(3)).catch(() => {});
setTimeout(whisperTick, 90_000).unref?.();
setInterval(whisperTick, 3600_000).unref?.();
// admin-scheduled notifications: checked every minute, catch-up after restarts
const queueTick = () => push.processQueue().catch(() => {});
setTimeout(queueTick, 45_000).unref?.();
setInterval(queueTick, 60_000).unref?.();

// App icons follow the theme: rebuilt once per style version at startup
// (sharp ships with the ML deps). Purely cosmetic — failures never matter.
const ICON_STYLE = "gold-v3";
try {
  const stampFile = path.join(ROOT, "data", "icon-style.txt");
  const current = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : "";
  if (current !== ICON_STYLE) {
    import("../scripts/make-icons.mjs")
      .then(() => {
        writeFileSync(stampFile, ICON_STYLE);
        console.log("app icons rebuilt:", ICON_STYLE);
      })
      .catch((err) => console.error("icon rebuild skipped:", err?.message));
  }
} catch {
  /* cosmetic */
}
