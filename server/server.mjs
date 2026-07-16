// The chatbot backend: serves the widget and answers questions.
// Usage: npm start   → http://localhost:3111
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, appendFileSync, createWriteStream, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { teachFile, teachLink, teachText, forget, publicJobs, jobTotals, uploadsDir } from "./teach.mjs";
import { matchCorrection, addCorrection, removeCorrection, listCorrections, DIRECT_MATCH } from "./corrections.mjs";
import { ROOT } from "./env.mjs";
import { searchMulti, formatTimestamp, thoughtCandidate } from "./retrieve.mjs";

// पंचांग is an enhancement, never a dependency: if the module has any problem,
// the guide simply answers without calendar awareness.
let panchangLine = () => "";
try {
  ({ panchangLine } = await import("./panchang.mjs"));
} catch (err) {
  console.error("panchang disabled:", err?.message);
}
import { warmup } from "./embed.mjs";
import { buildSystemPrompt, buildContextBlock } from "./prompt.mjs";
import { complete, PROVIDER, ACTIVE_MODEL, keyConfigured, BACKUP_CONFIGURED, failover, LlmAuthError, LlmRateLimitError } from "./llm.mjs";

const PORT = Number(process.env.PORT || 3111);
const FALLBACK =
  process.env.FALLBACK_MESSAGE ||
  "I don't have that information in our video library yet. Please contact us directly.";
const FALLBACK_HI = "मेरे पास अभी वीडियो लाइब्रेरी में यह जानकारी उपलब्ध नहीं है। कृपया हमसे सीधे संपर्क करें।";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
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
  [/[अआ]शा\s?[ईइय]{1,2}न/g, "Ashaeiynn"],
  [/\basha\s?[eiy]{1,3}nn?\b/gi, "Ashaeiynn"],
  [/पाठ\s+शाला/g, "पाठशाला"],
  [/\bpath\s+shala\b/gi, "Pathshala"],
  [/\bpar[ie]{0,2}ksh[ie]+t\b/gi, "Parikshit"],
];
const fixMishearings = (t) => MISHEARD.reduce((s, [re, ok]) => s.replace(re, ok), t);

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
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (list.length >= RATE_LIMIT.max) return true;
  list.push(now);
  hits.set(ip, list);
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
const GEMINI_TTS_KEY = process.env.GEMINI_API_KEY || "";
// Each TTS model has its own tiny free-tier daily quota (10/day) — chain two so
// the natural voice lasts twice as long before the browser voice takes over.
const GEMINI_TTS_MODELS = (
  process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const GEMINI_TTS_VOICE = process.env.GEMINI_TTS_VOICE || "Charon"; // deep, warm male

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

async function handleTts(req, res) {
  if (!TTS_KEY && !GEMINI_TTS_KEY) return json(res, 501, { error: "tts-not-configured" });
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) return json(res, 429, { error: "Too many requests." });

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
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) {
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
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    : [];

  // Personal-guide context card from the visitor's OWN device (widget diary or
  // the app). Used once for this answer, never stored — the server keeps no
  // per-person memory by design.
  const profile = payload.profile && typeof payload.profile === "object" ? payload.profile : null;
  const seekerName = typeof profile?.name === "string" ? profile.name.trim().slice(0, 40) : "";
  const seekerSummary = typeof profile?.summary === "string" ? profile.summary.trim().slice(0, 300) : "";
  const seekerSadhana =
    profile?.sadhana && typeof profile.sadhana.name === "string"
      ? { name: profile.sadhana.name.trim().slice(0, 120), since: String(profile.sadhana.since || "").slice(0, 20) }
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

  // Bhaiya-approved answers: a question meaning the same as an edited one gets
  // the approved answer verbatim (when its language fits); a similar one will see
  // it below as the highest-authority excerpt.
  let approved = null;
  try {
    approved = await matchCorrection(message);
  } catch {
    /* corrections are best-effort */
  }
  if (approved && approved.score >= DIRECT_MATCH && /[ऀ-ॿ]/.test(approved.answer) === wantsHindi) {
    writeLog({
      at: new Date().toISOString(),
      q: message,
      via: payload.via,
      lang: payload.lang,
      hi: wantsHindi,
      corrected: true,
      top: [],
      answer: approved.answer,
    });
    return json(res, 200, { answer: approved.answer, sources: [], corrected: true });
  }

  // Search transcripts for the question (plus a bit of recent context for follow-ups).
  // Cross-language boost: also search with a Hindi/English translation of the question,
  // since the videos are spoken in Hindi but visitors may ask in English (or vice versa).
  const lastUserTurns = history
    .filter((m) => m.role === "user")
    .slice(-1)
    .map((m) => m.content);
  let translated = null;
  if (apiKeyConfigured) {
    try {
      const line = await complete({
        system:
          "You translate search queries. Translate the question into Hindi if it is mainly English, or into English if it is mainly Hindi. Output ONLY the translated question itself — never answer it, never explain.",
        messages: [{ role: "user", content: message }],
        maxTokens: 150,
        light: true,
        retry: false, // best-effort helper — never make the visitor wait on retries
      });
      translated = line.split("\n")[0].trim() || null; // first line only — belt & suspenders
    } catch {
      /* translation is best-effort — search proceeds with the original question */
    }
  }
  const chunks = await searchMulti(
    [[...lastUserTurns, message].join(" "), translated],
    Number(process.env.RETRIEVE_K || 12),
  );

  // A similar (but not same-meaning) approved answer joins the excerpts at the
  // top — the model treats Bhaiya's own edit as the most authoritative teaching.
  if (approved) {
    chunks.unshift({
      title: "Bhaiya's approved answer (admin-edited)",
      content: `Question it was written for: ${approved.q}\nApproved answer: ${approved.answer}`,
      start_seconds: 0,
      url: null,
      score: approved.score,
    });
  }

  const langInstruction = wantsHindi
    ? "उत्तर पूरी तरह हिंदी (देवनागरी) में दीजिए — एक भी वाक्य English में नहीं।"
    : "Answer entirely in English — every sentence in English (keep Hindi terms like hawan, jaap, drishti in Latin script). Do not write any Devanagari.";

  const logEntry = {
    at: new Date().toISOString(),
    q: message,
    via: payload.via,
    lang: payload.lang,
    hi: wantsHindi,
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
      maxTokens: 1024,
      messages: [
        ...history,
        {
          role: "user",
          content: `Transcript excerpts for this question:\n\n${buildContextBlock(chunks)}\n\n---\nVisitor question: ${message}\n\n[${langInstruction}]${
            recentTopics.length || seekerName
              ? `\n[Seeker${seekerName ? ` named "${seekerName}"` : ""}${
                  recentTopics.length ? ` — recent questions (from their own device): ${recentTopics.join(" | ")}.` : "."
                }${seekerSummary ? ` Journey so far: ${seekerSummary}` : ""}${
                  seekerSadhana ? ` Their ongoing practice (self-declared${seekerSadhana.since ? `, since ${seekerSadhana.since}` : ""}): "${seekerSadhana.name}".` : ""
                }${
                  seekerName ? ` Address them by name ONCE, naturally ("${seekerName} जी" in Hindi / "${seekerName} ji" in English).` : ""
                } Where it fits naturally, connect the answer to their ongoing journey in one warm phrase; never list their history back to them.]`
              : ""
          }${
            wantsLink
              ? `\n[The seeker asked for a link. The app automatically shows tappable links right below your answer (the sources, and the requested channel/page). Warmly point there — "नीचे लिंक दिया है, tap करके देखिए" in Hindi or "the link is right below" in English — never say you cannot share links, and never read a URL out loud.]`
              : ""
          }${(() => {
            try {
              return `\n[पंचांग — use ONLY this to resolve time references (आज, कल, नवरात्रि के आख़िरी दिन…): ${panchangLine()}. Dates can differ from a local पंचांग by ±1 day, so on exact-date questions add "पंचांग से मिला लीजिएगा". Never invent dates beyond these.]`;
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
    for (let pass = 0; pass < 4; pass++) {
      const qu = answer.match(/\n\s*(?:उद्धरण|quote)\s*[:：]\s*(.+?)\s*~\s*(\d{1,2})\s*$/i);
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
            url: c.url ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : null,
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

    // Deterministic rule: an answer WITHOUT a Source line is either a refusal
    // or a purely conversational reply (rule 4b) — never decorate it with
    // Watch links or teaching extras. Conversation may keep its follow-up
    // chips and check-in so the dialogue breathes; sources stay empty.
    // (Handoffs and link requests are the deliberate exceptions.)
    if (!help && !wantsLink && !/source\s*[:：]/i.test(answer)) {
      writeLog({ ...logEntry, answer, refusal: true });
      return json(res, 200, {
        answer,
        sources: [],
        ...(followups.length ? { followups } : {}),
        ...(checkin ? { checkin } : {}),
        ...(sadhana ? { sadhana } : {}),
      });
    }

    // Top sources so the widget can link to the exact video moments.
    const seen = new Set();
    const sources = [];
    for (const c of chunks) {
      if (c.title.startsWith("Bhaiya's approved answer")) continue; // internal, not a linkable source
      const key = `${c.title}@${c.start_seconds}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        title: c.title,
        timestamp: formatTimestamp(c.start_seconds),
        url: c.url ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : null,
      });
      if (sources.length >= 3) break;
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
    if (help) {
      const wanted = help === "screening" ? ["Book a screening", "Contact Ashaeiynn"] : ["Contact Ashaeiynn"];
      for (const l of linkDirectory().filter((l) => wanted.includes(l.title))) {
        if (!sources.some((s) => s.url === l.url)) sources.push({ title: l.title, timestamp: "", url: l.url });
      }
    }

    // A gentle "watch next" the seeker hasn't seen yet (their device tells us
    // what they've seen; nothing tracked here) — the next-best relevant source.
    let suggest = null;
    const usedTitles = new Set(sources.map((s) => s.title.toLowerCase()));
    for (const c of chunks) {
      const t = c.title.toLowerCase();
      if (usedTitles.has(t) || seenTitles.has(t)) continue;
      if (c.title.startsWith("Bhaiya's approved answer")) continue;
      suggest = {
        title: c.title,
        timestamp: formatTimestamp(c.start_seconds),
        url: c.url ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : null,
      };
      break;
    }

    writeLog({ ...logEntry, answer });
    json(res, 200, {
      answer,
      sources,
      ...(suggest && profile ? { suggest } : {}),
      ...(followups.length ? { followups } : {}),
      ...(checkin ? { checkin } : {}),
      ...(sadhana ? { sadhana } : {}),
      ...(quote ? { quote } : {}),
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

// ——— voice fallback: transcribe a short recorded question ———
// iOS home-screen apps can't use the browser's speech recognition (it starts
// but hears nothing) — the widget records a few seconds of audio instead and
// sends it here. Gemini transcribes it on the same free key.
async function handleStt(req, res) {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) return json(res, 429, { error: "Too many requests." });
  if (!GEMINI_TTS_KEY) return json(res, 503, { error: "stt-not-configured" });
  let body = "";
  for await (const part of req) {
    body += part;
    if (body.length > 3_000_000) return json(res, 413, { error: "Recording too long." });
  }
  let audio = "", mime = "";
  try {
    const p = JSON.parse(body);
    audio = String(p.audio || "");
    mime = String(p.mime || "audio/mp4").split(";")[0].trim().toLowerCase();
  } catch {
    return json(res, 400, { error: "Invalid JSON." });
  }
  if (!audio) return json(res, 400, { error: "No audio." });
  const OK_MIME = new Set(["audio/mp4", "audio/aac", "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm", "audio/aiff", "audio/flac", "audio/x-m4a", "audio/m4a"]);
  if (!OK_MIME.has(mime)) mime = "audio/mp4";
  if (mime === "audio/x-m4a" || mime === "audio/m4a") mime = "audio/mp4";
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.1-flash-lite")}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_TTS_KEY },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: "Transcribe this short voice question exactly as spoken — Hindi speech in Devanagari, English speech in English. Output ONLY the transcription, nothing else." },
                { inlineData: { mimeType: mime, data: audio } },
              ],
            },
          ],
        }),
      },
    );
    if (!r.ok) throw new Error(`stt ${r.status}`);
    const data = await r.json();
    const text = (data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "").trim();
    return json(res, 200, { text: fixMishearings(text.slice(0, 2000)) });
  } catch (err) {
    console.error("stt error:", err?.message);
    return json(res, 503, { error: "Couldn't hear that — please try again." });
  }
}

// ——— आज का विचार: one thought per day from the teachings, same for everyone ———
// The passage is picked deterministically by the date; a single light model
// call per day trims it into a clean 2–3 line thought (cached in memory AND
// on disk, so restarts don't re-spend the call). data/thought.json is
// gitignored — it regenerates anywhere.
let thoughtCache = { date: "", data: null };
const THOUGHT_FILE = path.join(ROOT, "data", "thought.json");
async function handleThought(req, res) {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (thoughtCache.date === date && thoughtCache.data) return json(res, 200, thoughtCache.data);
  try {
    const saved = JSON.parse(readFileSync(THOUGHT_FILE, "utf8"));
    if (saved.date === date && saved.text) {
      thoughtCache = { date, data: saved };
      return json(res, 200, saved);
    }
  } catch {
    /* no saved thought yet */
  }
  const c = thoughtCandidate(date);
  if (!c) return json(res, 200, {});
  let text = "";
  if (apiKeyConfigured) {
    try {
      text = (
        await complete({
          system:
            "From the given passage of a guru's spoken teaching, extract ONE short self-contained thought — 2 to 3 sentences, at most 60 words — in the passage's OWN words and language (Hindi stays Hindi in Devanagari), only lightly cleaned of filler for reading. It must stand alone beautifully, like a daily thought. Output ONLY the thought.",
          messages: [{ role: "user", content: c.content.slice(0, 1500) }],
          maxTokens: 160,
          light: true,
          retry: false,
        })
      )
        .trim()
        .slice(0, 400);
    } catch {
      /* fall back to a raw excerpt */
    }
  }
  if (!text) text = c.content.slice(0, 220).trim() + "…";
  const data = {
    date,
    text,
    title: c.title,
    url: c.url ? `${c.url}#t=${Math.floor(c.start_seconds || 0)}s` : null,
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
  if (rateLimited(ip)) return json(res, 429, { error: "Too many requests." });
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
    const line = await complete({
      system:
        "You summarise a spiritual seeker's ongoing interests from their recent questions to a meditation-centre guide. Output ONE warm, factual line in Hindi (Devanagari, max 25 words) naming their main themes. Output only that line — no preamble.",
      messages: [{ role: "user", content: qs.join("\n") }],
      maxTokens: 100,
      light: true,
      retry: false,
    });
    return json(res, 200, { summary: line.split("\n")[0].trim().slice(0, 300) });
  } catch {
    return json(res, 503, { error: "busy" });
  }
}

// A fresh "watch next" for a returning seeker, matched to their whole journey
// (summary + recent topics), excluding what they've already seen. Free (local search).
async function handleNextStep(req, res) {
  const ip = req.socket.remoteAddress ?? "unknown";
  if (rateLimited(ip)) return json(res, 429, { error: "Too many requests." });
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
    return json(res, 200, {
      suggest: {
        title: c.title,
        timestamp: formatTimestamp(c.start_seconds),
        url: c.url ? `${c.url}#t=${Math.floor(c.start_seconds)}s` : null,
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
  // one-tap answer feedback (सहायक / नहीं) — logged for the admin's review
  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (rateLimited(ip)) return json(res, 429, { error: "Too many requests." });
    let body = "";
    for await (const part of req) {
      body += part;
      if (body.length > 5_000) return json(res, 413, { error: "Too long." });
    }
    try {
      const p = JSON.parse(body);
      writeLog({
        at: new Date().toISOString(),
        feedback: p.helpful ? "up" : "down",
        q: String(p.q || "").slice(0, 400),
      });
      return json(res, 200, { ok: true });
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
      naturalVoice: TTS_KEY ? "elevenlabs" : GEMINI_TTS_KEY ? "gemini" : false,
      knowledgeBase: existsSync(path.join(ROOT, "data", "knowledge.db")) ? "built" : "missing",
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
    if (uploadedNames().includes(name.toLowerCase())) {
      req.resume(); // drain the body so the connection closes cleanly
      return json(res, 409, { error: "duplicate", duplicate: true });
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
  // The studio Mac pushes its study progress here; the cloud portal displays it.
  if (url.pathname === "/api/admin/studio-status") {
    if (!adminOk()) return;
    if (req.method === "POST") {
      let body = "";
      for await (const part of req) {
        body += part;
        if (body.length > 2_000_000) return json(res, 413, { error: "Too long." });
      }
      try {
        const p = JSON.parse(body);
        globalThis.__studioStatus = { jobs: p.jobs || [], totals: p.totals || null, at: Date.now() };
        return json(res, 200, { ok: true });
      } catch {
        return json(res, 400, { error: "Invalid JSON." });
      }
    }
    const s = globalThis.__studioStatus;
    return json(res, 200, { at: s?.at || null, jobs: s?.jobs || [], totals: s?.totals || null });
  }
  // Queue a file that is ALREADY in data/uploads (no re-copying) — used to
  // resume/curate big archives without pushing gigabytes through the browser.
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
  // ——— nightly self-learned communication lessons (style only, read-only) ———
  if (req.method === "GET" && url.pathname === "/api/admin/style-notes") {
    if (!adminOk()) return;
    try {
      return json(res, 200, JSON.parse(readFileSync(path.join(ROOT, "data", "style-notes.json"), "utf8")));
    } catch {
      return json(res, 200, { notes: [] });
    }
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
    items.sort((a, b) => b.added - a.added);
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
    res.writeHead(200, {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=86400",
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

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Chatbot server running:  http://localhost:${PORT}`);
  console.log(`Provider: ${PROVIDER} (${ACTIVE_MODEL})   |   API key configured: ${apiKeyConfigured ? "yes" : "NO — edit .env"}`);
  // Warm the embedding model so the first question isn't slow.
  warmup().then(() => console.log("Embedding model ready (cross-language search enabled).")).catch(() => {});
});
