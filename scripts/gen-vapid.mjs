// One-time setup: generate the web-push VAPID keypair and add it to .env.
// Prints only a confirmation — the keys never appear on screen or in logs.
// Run: node scripts/gen-vapid.mjs
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import webpush from "web-push";

const envFile = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), ".env");
const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
if (/^VAPID_PUBLIC_KEY=./m.test(current)) {
  console.log("VAPID keys already present in .env — nothing to do.");
} else {
  const k = webpush.generateVAPIDKeys();
  appendFileSync(envFile, `VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\n`);
  console.log("VAPID keys generated and saved to .env (not shown for safety).");
}
