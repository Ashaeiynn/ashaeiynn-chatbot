// Step 5: Pull the website's informational PAGES from ashaeiynn.com into the
// knowledge base (About, programs, hawans, screening, stages, FAQ, reviews, policies).
// Re-runnable: page files are overwritten fresh each run.
// Usage: node pipeline/5-pages.mjs   (then: npm run ingest)
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "data", "transcripts");
mkdirSync(outDir, { recursive: true });

const SITE = "https://ashaeiynn.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

// Public, informative pages only — internal/duplicate/checkout pages stay out.
// (Find ids with: /wp-json/wp/v2/pages?per_page=50&_fields=id,title,link)
const PAGE_IDS = [
  4328, // Home
  21, // About Us
  31, // Our Programs
  23, // Stages
  27, // FAQ's
  29, // Contact Us
  25, // Reviews
  9650, // Reviews From The Ashaeiynn Family
  4042, // Pathshala (landing)
  9327, // Asha Screening 2.0
  6085, // The Asha Ambience
  8636, // Asha Kaya
  5726, // Mool Tattva
  8118, // Rama Mantra Sadhana
  3724, // Siya Tattva
  6117, // Ram Hawan
  4761, // Maha Hawan
  7001, // Guru Purnima Maha Hawan
  3484, // Holi Maha Hawan
  3930, // Navratri Akhand Deepak
  3459, // Chakra Hawan
  3446, // Aura Shielding Hawan
  3432, // Gahen Hawan
  3400, // Kuldevta Hawan
  2938, // Pitra Hawan
  2327, // Negativity Hawan
  128, // Disclaimer
  120, // No Refund Policy
  122, // Terms & Conditions
  124, // Shipping
];

function htmlToLines(html) {
  const lines = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/tr|\/section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#?\w+;/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2);
  // Elementor repeats nav/section fragments — keep first occurrence only.
  const seen = new Set();
  return lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
}

let saved = 0;
for (const id of PAGE_IDS) {
  const r = await fetch(`${SITE}/wp-json/wp/v2/pages/${id}?_fields=id,link,title,content`, {
    headers: { "User-Agent": UA },
  });
  if (!r.ok) {
    console.error(`✗ page ${id}: HTTP ${r.status}`);
    continue;
  }
  const p = await r.json();
  const title = htmlToLines(p.title?.rendered ?? "").join(" ").trim();
  const lines = htmlToLines(p.content?.rendered ?? "");
  if (!title || lines.join(" ").length < 200) {
    console.error(`✗ page ${id} (${title}): too little text, skipped`);
    continue;
  }
  const doc = {
    title: `Website: ${title}`,
    url: p.link,
    videoId: `page_${p.id}`,
    language: "hi",
    minutes: 0,
    segments: lines.map((text) => ({ start: 0, end: 0, text })),
  };
  writeFileSync(path.join(outDir, `page_${p.id}.json`), JSON.stringify(doc, null, 2));
  saved++;
  console.log(`✓ ${title.slice(0, 60)} (${lines.length} lines)`);
}
console.log(`\nPages saved: ${saved} of ${PAGE_IDS.length}. Next: npm run ingest`);
