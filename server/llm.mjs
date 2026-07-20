// Unified access to the answering AI — one function, two providers.
// Set CHAT_PROVIDER in .env to "gemini" (Google, free tier) or "anthropic"
// (Claude, prepaid credits); nothing else in the codebase needs to change.
// FAILOVER: when Gemini is the provider AND an ANTHROPIC_API_KEY is present,
// any Gemini failure (daily quota, outage) silently retries on Claude — the
// prepaid key is a hard-capped tank, so worst case is bounded pennies.
import Anthropic from "@anthropic-ai/sdk";

export const PROVIDER = (process.env.CHAT_PROVIDER || "anthropic").toLowerCase();

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// Small helper jobs (query translation) run on the lite model: separate free-tier
// quota bucket, so they don't eat into the answer model's requests-per-minute.
const GEMINI_LIGHT_MODEL = process.env.GEMINI_LIGHT_MODEL || "gemini-flash-lite-latest";
const ANTHROPIC_MODEL = process.env.CHAT_MODEL || "claude-haiku-4-5";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export const ACTIVE_MODEL = PROVIDER === "gemini" ? GEMINI_MODEL : ANTHROPIC_MODEL;
export const keyConfigured = PROVIDER === "gemini" ? Boolean(GEMINI_KEY) : Boolean(ANTHROPIC_KEY);
export const BACKUP_CONFIGURED = PROVIDER === "gemini" && Boolean(ANTHROPIC_KEY);
// When the backup last answered (null = never) — /health shows it so an
// extended Gemini outage is visible to the owner.
export const failover = { at: null, count: 0 };

let _anthropic = null;
const anthropicClient = () => (_anthropic ??= new Anthropic());

export class LlmAuthError extends Error {}
export class LlmRateLimitError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function completeAnthropic({ system, messages, maxTokens, cacheSystem }) {
  try {
    const response = await anthropicClient().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: cacheSystem
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system,
      messages,
    });
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new LlmAuthError(err.message);
    if (err instanceof Anthropic.RateLimitError) throw new LlmRateLimitError(err.message);
    throw err;
  }
}

export async function complete({ system, messages, maxTokens = 1024, cacheSystem = false, light = false, retry = true, strong = false }) {
  // A few rare, high-stakes judgments (e.g. deciding to RETIRE an admin
  // correction) need a more capable model than the fast lite tier — route them
  // straight to the Anthropic model when it is configured. Cheap: these fire at
  // most once per upload, never on a seeker's question.
  if (strong && ANTHROPIC_KEY) {
    try {
      return await completeAnthropic({ system, messages, maxTokens, cacheSystem });
    } catch {
      /* backup unavailable — fall through to the normal path */
    }
  }
  if (PROVIDER === "gemini") {
    try {
      return await completeGemini({ system, messages, maxTokens, light, retry });
    } catch (err) {
      if (!ANTHROPIC_KEY) throw err;
      // Gemini is down or out of quota — the backup answers so members
      // never see "busy". Logged so the owner can spot extended outages.
      console.error(`failover → ${ANTHROPIC_MODEL} (gemini: ${String(err?.message || err).slice(0, 80)})`);
      failover.at = new Date().toISOString();
      failover.count++;
      return completeAnthropic({ system, messages, maxTokens, cacheSystem });
    }
  }
  return completeAnthropic({ system, messages, maxTokens, cacheSystem });
}

async function completeGemini({ system, messages, maxTokens, light, retry }) {
  {
    const model = light ? GEMINI_LIGHT_MODEL : GEMINI_MODEL;
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // Thinking off: answers stay fast and the free-tier quota goes further.
      generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    };
    // The free tier throttles per minute and occasionally 503s under load —
    // wait briefly and retry before giving up.
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
          body: JSON.stringify(body),
        },
      );
      if ((r.status === 429 || r.status === 503) && retry && attempt < 2) {
        await sleep(attempt === 0 ? 2500 : 7000);
        continue;
      }
      if (r.status === 401 || r.status === 403) throw new LlmAuthError(`gemini ${r.status}`);
      if (r.status === 429) throw new LlmRateLimitError("gemini rate limit");
      if (!r.ok) {
        const detail = (await r.text()).slice(0, 300);
        // Gemini reports a bad API key as 400 INVALID_ARGUMENT rather than 401.
        if (r.status === 400 && /api key/i.test(detail)) throw new LlmAuthError(`gemini 400: ${detail}`);
        throw new Error(`gemini ${r.status}: ${detail}`);
      }
      const data = await r.json();
      return (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
    }
  }
}
