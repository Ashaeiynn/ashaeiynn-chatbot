// Step 4: Pull all Pathshala articles from ashaeiynn.com into the knowledge base.
// Uses the site's WordPress REST API (clean structured content, no scraping fragility).
// Re-runnable any time — new/edited articles are picked up, files are overwritten fresh.
// Usage: node pipeline/4-articles.mjs   (then: npm run ingest)
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "data", "transcripts");
mkdirSync(outDir, { recursive: true });

const SITE = "https://ashaeiynn.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

// minimal HTML → readable text
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/tr)[^>]*>/gi, "\n")
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
    .filter(Boolean);
}

let page = 1;
let saved = 0;
let skipped = 0;
for (;;) {
  const r = await fetch(
    `${SITE}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,link,title,content,date`,
    { headers: { "User-Agent": UA } },
  );
  if (!r.ok) {
    if (page > 1) break; // past the last page
    throw new Error(`posts API failed: HTTP ${r.status}`);
  }
  const posts = await r.json();
  if (!posts.length) break;

  for (const post of posts) {
    const title = htmlToText(post.title?.rendered ?? "").join(" ").trim();
    const lines = htmlToText(post.content?.rendered ?? "");
    const totalChars = lines.join(" ").length;
    if (!title || totalChars < 300) {
      skipped++;
      continue; // stubs/empty posts aren't useful knowledge
    }
    const doc = {
      title: `Article: ${title}`,
      url: post.link,
      videoId: `art_${post.id}`,
      language: "hi",
      minutes: 0,
      publishedOn: post.date,
      segments: lines.map((text) => ({ start: 0, end: 0, text })),
    };
    writeFileSync(path.join(outDir, `art_${post.id}.json`), JSON.stringify(doc, null, 2));
    saved++;
    console.log(`✓ ${title.slice(0, 70)}`);
  }
  page++;
}

console.log(`\nArticles saved: ${saved} (skipped ${skipped} too-short). Next: npm run ingest`);
