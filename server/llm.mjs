// Unified access to the answering AI — one function, two providers.
// Set CHAT_PROVIDER in .env to "gemini" (Google, free tier) or "anthropic"
// (Claude, prepaid credits); nothing else in the codebase needs to change.
import Anthropic from "@anthropic-ai/sdk";

export const PROVIDER = (process.env.CHAT_PROVIDER || "anthropic").toLowerCase();

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ANTHROPIC_MODEL = process.env.CHAT_MODEL || "claude-haiku-4-5";

export const ACTIVE_MODEL = PROVIDER === "gemini" ? GEMINI_MODEL : ANTHROPIC_MODEL;
export const keyConfigured =
  PROVIDER === "gemini" ? Boolean(GEMINI_KEY) : Boolean(process.env.ANTHROPIC_API_KEY);

const anthropic = new Anthropic();

export class LlmAuthError extends Error {}
export class LlmRateLimitError extends Error {}

export async function complete({ system, messages, maxTokens = 1024, cacheSystem = false }) {
  if (PROVIDER === "gemini") {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      // Thinking off: answers stay fast and the free-tier quota goes further.
      generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify(body),
      },
    );
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

  try {
    const response = await anthropic.messages.create({
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
