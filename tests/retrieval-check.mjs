// Retrieval quality check — runs WITHOUT an API key (no Claude call).
// For every test question, shows the top-matching chunk and its similarity score,
// then compares on-topic vs off-topic score distributions. Use this to confirm the
// knowledge base retrieves the right material and to tune the "not covered" threshold.
// Usage: node tests/retrieval-check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { search, formatTimestamp } from "../server/retrieve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { onTopic, offTopic } = JSON.parse(readFileSync(path.join(here, "questions.json"), "utf8"));

async function run(label, items) {
  console.log(`\n=== ${label} (${items.length}) ===`);
  const tops = [];
  for (const { q, lang } of items) {
    const r = await search(q, 3);
    const top = r[0]?.score ?? 0;
    tops.push(top);
    const where = r[0] ? `${r[0].title} @ ${formatTimestamp(r[0].start_seconds)}` : "(no results)";
    console.log(`  [${top.toFixed(3)}] (${lang}) ${q}`);
    console.log(`          → ${where}`);
  }
  const avg = tops.reduce((a, b) => a + b, 0) / (tops.length || 1);
  return { avg, min: Math.min(...tops), max: Math.max(...tops) };
}

const on = await run("ON-TOPIC — should retrieve relevant chunks", onTopic);
const off = await run("OFF-TOPIC — should score lower", offTopic);

console.log("\n=== summary ===");
console.log(`on-topic  top-score  avg ${on.avg.toFixed(3)}  (min ${on.min.toFixed(3)}, max ${on.max.toFixed(3)})`);
console.log(`off-topic top-score  avg ${off.avg.toFixed(3)}  (min ${off.min.toFixed(3)}, max ${off.max.toFixed(3)})`);
const gap = on.avg - off.avg;
console.log(`separation: ${gap.toFixed(3)}  ${gap > 0.03 ? "✓ on-topic clearly ranks higher" : "⚠ small — rely on Claude's grounding, not a hard threshold"}`);
console.log(
  `\nSuggested 'not covered' pre-filter floor: ~${((on.min + off.max) / 2).toFixed(2)} ` +
    `(below this, skip Claude and return the fallback). Verify against more data before enabling.`,
);
