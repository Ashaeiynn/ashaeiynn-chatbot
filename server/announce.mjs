// The in-bot notice — the admin's message shown INSIDE the guide the next time a
// seeker opens it (they read it, then "go for it" or dismiss). Unlike push it
// needs no permission and works identically in the app's WebView and on the web,
// so it is the channel the admin uses to reach app users (the app owns phone push).
//
// Only the LATEST notice is kept; the widget shows it once per device (keyed by
// id) and it auto-retires after MAX_AGE so a stale notice never greets a seeker
// weeks later. Stored on the server disk only — no per-person data (privacy-first).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const FILE = path.join(process.env.LOG_DIR || path.join(ROOT, "data"), "announcement.json");
const MAX_AGE = Number(process.env.ANNOUNCEMENT_DAYS || 10) * 864e5;

let current = null;
try {
  current = JSON.parse(readFileSync(FILE, "utf8"));
} catch {
  current = null;
}

function persist() {
  try {
    writeFileSync(FILE, JSON.stringify(current, null, 1));
  } catch {
    /* disk is best-effort */
  }
}

// Set whenever the admin sends a notification. Returns the stored notice.
export function setAnnouncement({ title, text, link } = {}) {
  const body = String(text || "").trim().slice(0, 300);
  if (!body) return null;
  current = {
    id: Date.now().toString(36),
    title: String(title || "").trim().slice(0, 80),
    text: body,
    link: String(link || "").trim().slice(0, 300),
    at: new Date().toISOString(),
  };
  persist();
  return current;
}

// What a seeker opening the guide should see — or null if nothing/expired.
export function getAnnouncement() {
  if (!current) return null;
  if (Date.now() - new Date(current.at).getTime() > MAX_AGE) return null;
  return current;
}

export function clearAnnouncement() {
  current = null;
  persist();
}
