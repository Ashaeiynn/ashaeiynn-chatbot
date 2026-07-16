// End-to-end answer-quality check — needs the server running WITH an API key.
//   1) npm start        (in one terminal, with ANTHROPIC_API_KEY set in .env)
//   2) node tests/answer-check.mjs
// Verifies on-topic questions get a real grounded answer (with a source), and
// off-topic questions get the fallback (and no sources).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "../server/env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { onTopic, offTopic } = JSON.parse(readFileSync(path.join(here, "questions.json"), "utf8"));
const BASE = `http://localhost:${process.env.PORT || 3111}`;
const FALLBACK = process.env.FALLBACK_MESSAGE || "";

async function ask(q) {
  // pace the suite: each question costs ~2 model calls (translation + answer),
  // and the free tier caps requests per minute — don't let the test itself 429
  await new Promise((s) => setTimeout(s, 9000));
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: q }),
  });
  if (!res.ok) return { error: (await res.json()).error || `HTTP ${res.status}` };
  return res.json();
}

// A grounded answer always ends with a "Source:" line (prompt rule) and carries
// sources[]. A refusal never does: since the conversational persona, off-topic
// questions may get either the canonical fallback OR a short in-character
// refusal ("मैं यहाँ सोने के भाव बताने के लिए नहीं हूँ…") — both are correct as
// long as there is NO source line, NO sources array, and no long fabrication.
const hasSource = (a) => /source\s*:/i.test(a);
const isFallback = (a, sources) =>
  !hasSource(a) &&
  !(sources || []).length &&
  (a.trim().length < 600 || (FALLBACK && a.includes(FALLBACK.slice(0, 40))));

let pass = 0;
let fail = 0;

console.log("=== ON-TOPIC (expect a grounded answer) ===");
for (const { q, lang } of onTopic) {
  const r = await ask(q);
  const ok = !r.error && r.answer && !isFallback(r.answer, r.sources);
  console.log(`  ${ok ? "✓" : "✗"} (${lang}) ${q}`);
  if (r.error) console.log(`      error: ${r.error}`);
  else console.log(`      ${r.answer.slice(0, 120).replace(/\n/g, " ")}${r.sources?.length ? `  [${r.sources.length} source]` : "  [NO SOURCE]"}`);
  ok ? pass++ : fail++;
}

console.log("\n=== OFF-TOPIC (expect the fallback) ===");
for (const { q, lang } of offTopic) {
  const r = await ask(q);
  const ok = !r.error && isFallback(r.answer, r.sources);
  console.log(`  ${ok ? "✓" : "✗"} (${lang}) ${q}`);
  if (!ok && r.answer) console.log(`      LEAKED: ${r.answer.slice(0, 120).replace(/\n/g, " ")}`);
  ok ? pass++ : fail++;
}

console.log(`\n=== ${pass} passed, ${fail} failed of ${pass + fail} ===`);
process.exit(fail ? 1 : 0);
