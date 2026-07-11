// Ask the same question to the cheap and the premium model, side by side.
// Usage: npm run compare -- "How do I get started?"
import Anthropic from "@anthropic-ai/sdk";
import "./env.mjs";
import { search } from "./retrieve.mjs";
import { buildSystemPrompt, buildContextBlock } from "./prompt.mjs";

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  console.error('Usage: npm run compare -- "your question here"');
  process.exit(1);
}

const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku (cheapest)", inPrice: 1, outPrice: 5 },
  { id: "claude-opus-4-8", label: "Opus (best)", inPrice: 5, outPrice: 25 },
];

const client = new Anthropic();
const chunks = await search(question, 8);
const fallback =
  process.env.FALLBACK_MESSAGE || "I don't have that information in our video library yet.";

console.log(`\nQuestion: ${question}`);
console.log(`Matched ${chunks.length} transcript excerpt(s).\n${"=".repeat(60)}`);

for (const model of MODELS) {
  const response = await client.messages.create({
    model: model.id,
    max_tokens: 1024,
    system: buildSystemPrompt(fallback),
    messages: [
      {
        role: "user",
        content: `Transcript excerpts for this question:\n\n${buildContextBlock(chunks)}\n\n---\nVisitor question: ${question}`,
      },
    ],
  });

  const answer = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const cost =
    (response.usage.input_tokens * model.inPrice + response.usage.output_tokens * model.outPrice) /
    1_000_000;

  console.log(`\n■ ${model.label} — this answer cost $${cost.toFixed(4)}`);
  console.log("-".repeat(60));
  console.log(answer);
  console.log("=".repeat(60));
}
