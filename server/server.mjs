// The chatbot backend: serves the widget and answers questions.
// Usage: npm start   → http://localhost:3111
import { createServer } from "node:http";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { searchMulti, formatTimestamp } from "./retrieve.mjs";
import { warmup } from "./embed.mjs";
import { buildSystemPrompt, buildContextBlock } from "./prompt.mjs";
import { complete, PROVIDER, ACTIVE_MODEL, keyConfigured, LlmAuthError, LlmRateLimitError } from "./llm.mjs";

const PORT = Number(process.env.PORT || 3111);
const FALLBACK =
  process.env.FALLBACK_MESSAGE ||
  "I don't have that information in our video library yet. Please contact us directly.";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const MAX_HISTORY_TURNS = 6;

const apiKeyConfigured = keyConfigured;

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

// ——— natural voice (optional): ElevenLabs text-to-speech ———
// Configure ELEVENLABS_API_KEY in .env to give the bot a human voice; without it
// the widget falls back to the browser's built-in voice automatically.
const TTS_KEY = process.env.ELEVENLABS_API_KEY || "";
const TTS_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // multilingual premade voice
const TTS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

async function handleTts(req, res) {
  if (!TTS_KEY) return json(res, 501, { error: "tts-not-configured" });
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

  const message = String(payload.message ?? "").trim().slice(0, 2000);
  if (!message) return json(res, 400, { error: "Empty message." });

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

  // Detect the QUESTION's language so the reply language never drifts toward the
  // (mostly Hindi) excerpts. Romanized-Hindi (Hinglish) counts as Hindi. When the
  // question was SPOKEN, the widget's mic language wins: speech recognition often
  // writes Hindi speech in Latin letters, which would otherwise read as English.
  const spokenHindi =
    payload.via === "voice" && String(payload.lang || "").toLowerCase().startsWith("hi");
  const isDevanagari = /[ऀ-ॿ]/.test(message);
  const hinglishHits = (message.toLowerCase().match(/\b(kya|kaun|kaise|kyu|kyon|kab|kahan|batao|bataiye|mujhe|humko|nahi|nahin|hota|hoti|hai|hain|karna|kare|krna|wala|matlab)\b/g) || []).length;
  const wantsHindi = spokenHindi || isDevanagari || hinglishHits >= 1;
  const langInstruction = wantsHindi
    ? "उत्तर पूरी तरह हिंदी (देवनागरी) में दीजिए — एक भी वाक्य English में नहीं।"
    : "Answer entirely in English — every sentence in English (keep Hindi terms like hawan, jaap, drishti in Latin script). Do not write any Devanagari.";

  // Log every question + what was retrieved, so answer quality can be reviewed and
  // tuned against real usage (data/questions.log, one JSON line per question).
  try {
    appendFileSync(
      path.join(ROOT, "data", "questions.log"),
      JSON.stringify({
        at: new Date().toISOString(),
        q: message,
        via: payload.via,
        lang: payload.lang,
        hi: wantsHindi,
        top: chunks.slice(0, 3).map((c) => ({ t: c.title, s: Number(c.score?.toFixed(3)) })),
      }) + "\n",
    );
  } catch {
    /* logging must never break answering */
  }

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
    return json(res, 200, { answer, sources, testMode: true });
  }

  try {
    const answer = await complete({
      system: buildSystemPrompt(FALLBACK),
      cacheSystem: true,
      maxTokens: 1024,
      messages: [
        ...history,
        {
          role: "user",
          content: `Transcript excerpts for this question:\n\n${buildContextBlock(chunks)}\n\n---\nVisitor question: ${message}\n\n[${langInstruction}]`,
        },
      ],
    });

    // Top sources so the widget can link to the exact video moments.
    const seen = new Set();
    const sources = [];
    for (const c of chunks) {
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

    json(res, 200, { answer, sources });
  } catch (err) {
    if (err instanceof LlmAuthError) {
      return json(res, 503, { error: "The chatbot's API key is invalid — check the .env file." });
    }
    if (err instanceof LlmRateLimitError) {
      return json(res, 503, { error: "The chatbot is very busy right now — try again in a minute." });
    }
    console.error("chat error:", err);
    json(res, 500, { error: "Something went wrong — please try again." });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && url.pathname === "/api/tts") return handleTts(req, res);

  // Health check — for hosting platforms and to confirm a deploy is live.
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, {
      ok: true,
      provider: PROVIDER,
      model: ACTIVE_MODEL,
      apiKeyConfigured,
      naturalVoice: Boolean(TTS_KEY),
      knowledgeBase: existsSync(path.join(ROOT, "data", "knowledge.db")) ? "built" : "missing",
    });
  }

  if (req.method === "GET" && url.pathname === "/logo.png") {
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(readFileSync(path.join(ROOT, "widget", "logo.png")));
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
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
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
