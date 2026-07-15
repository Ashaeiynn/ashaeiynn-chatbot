// Step 7: Give meaningful Hindi titles to recordings that arrived with id-names
// ("Zoom live meeting 1713282719", "GMT20260120-…", "audio12345…"). Reads each
// transcript, asks the (free) light model for a topic title, keeps provenance in
// brackets. Resumable: transcripts that already carry a Devanagari title are
// skipped. Titles flow into the knowledge base at the next absorption cycle.
// Usage: node pipeline/7-title.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../server/env.mjs";
import { complete } from "../server/llm.mjs";

const dir = path.join(ROOT, "data", "transcripts");
const ID_TITLE = /^(zoom live meeting \d+|gmt\d{8}.*|audio\d{6,}|video\d{6,}|record-\d+)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "GMT20260120-173816…" → "20 Jan 2026" for a human date in the provenance
function gmtDate(title) {
  const m = /^GMT(\d{4})(\d{2})(\d{2})/i.exec(title);
  if (!m) return null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

const files = readdirSync(dir).filter((f) => f.startsWith("audio_") && f.endsWith(".json"));
let titled = 0, skipped = 0, failed = 0;

for (const f of files) {
  const p = path.join(dir, f);
  const d = JSON.parse(readFileSync(p, "utf8"));
  const t = (d.title || "").trim();
  if (/[ऀ-ॿ]/.test(t) || !ID_TITLE.test(t)) {
    skipped++;
    continue;
  }
  const text = (d.segments || []).map((s) => s.text).join(" ").slice(0, 6000);
  if (text.replace(/\s/g, "").length < 200) {
    skipped++;
    continue;
  }
  try {
    const line = await complete({
      system:
        "You title Hindi spiritual-teaching transcripts. Reply with ONLY a short descriptive title in Hindi (Devanagari, 3-7 words) saying what the teaching is about — no quotes, no explanation, nothing else.",
      messages: [{ role: "user", content: `Transcript:\n${text}` }],
      maxTokens: 60,
      light: true,
      retry: false,
    });
    const title = line.trim().split("\n")[0].replace(/^["']|["']$/g, "").slice(0, 90);
    if (!/[ऀ-ॿ]/.test(title)) throw new Error("no Hindi title returned");
    const when = gmtDate(t);
    d.title = `${title} (${when ? `live meeting ${when}` : t})`;
    writeFileSync(p, JSON.stringify(d, null, 2));
    titled++;
    console.log(`✓ ${t} -> ${d.title}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${t}: ${String(err?.message || err).slice(0, 80)}`);
    await sleep(15000); // back off harder after an error
  }
  await sleep(4500); // stay well inside the free-tier per-minute limits
}
console.log(`DONE: ${titled} titled, ${skipped} already fine, ${failed} failed (rerun to retry)`);
