// Web-push notifications — the guide's gentle doorbell on members' phones.
// Design: whispers, not noise. Auto messages are rare (Sunday's article,
// festival eves from the पंचांग); the admin can also send one by hand.
// The server stores ONLY anonymous delivery addresses (endpoint + crypto keys)
// and which we sent — no names, no journeys (privacy-first, like everything).
// Gracefully disabled until the web-push package + VAPID keys exist:
//   npm install web-push
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env (web-push generate-vapid-keys)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const SUBS = path.join(ROOT, "data", "push-subs.json");
const LOG = path.join(ROOT, "data", "push-log.json");
const STATE = path.join(ROOT, "data", "push-state.json");

let webpush = null;
let ready = false;
try {
  webpush = (await import("web-push")).default;
  const pub = process.env.VAPID_PUBLIC_KEY || "";
  const priv = process.env.VAPID_PRIVATE_KEY || "";
  if (pub && priv) {
    webpush.setVapidDetails("mailto:ashaeiynhopein@gmail.com", pub, priv);
    ready = true;
  } else {
    console.error("push disabled: VAPID keys missing in .env");
  }
} catch (err) {
  console.error("push disabled:", err?.message);
}

export const pushReady = () => ready;
export const publicKey = () => process.env.VAPID_PUBLIC_KEY || "";

const load = (f, fallback) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};
const save = (f, v) => {
  try {
    writeFileSync(f, JSON.stringify(v, null, 1));
  } catch {
    /* disk is best-effort */
  }
};

export function addSub(sub, lang) {
  if (!sub?.endpoint || !sub?.keys) return false;
  const all = load(SUBS, []);
  const clean = lang === "en" ? "en" : "hi";
  const existing = all.find((s) => s.endpoint === sub.endpoint);
  if (existing) {
    existing.lang = clean; // language preference can change over time
  } else {
    all.push({ endpoint: sub.endpoint, keys: sub.keys, lang: clean, at: new Date().toISOString() });
  }
  save(SUBS, all);
  return true;
}
export function removeSub(endpoint) {
  const all = load(SUBS, []);
  const left = all.filter((s) => s.endpoint !== endpoint);
  if (left.length !== all.length) save(SUBS, left);
  return all.length - left.length;
}
export const subCount = () => load(SUBS, []).length;
export const pushLog = () => load(LOG, []).slice(-120).reverse();

// title/body may be a plain string (sent as-is to everyone — the admin's
// choice of language) or {hi, en} — each subscriber gets their own language.
const inLang = (v, lang) => (v && typeof v === "object" ? v[lang] || v.hi || v.en || "" : v);
const forLog = (v) => (v && typeof v === "object" ? `${v.hi || ""}${v.en ? ` | EN: ${v.en}` : ""}` : String(v || ""));

export async function sendToAll(title, body, url, source) {
  if (!ready) throw new Error("push-not-configured");
  const all = load(SUBS, []);
  let sent = 0;
  const dead = [];
  for (const s of all) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        JSON.stringify({ title: inLang(title, s.lang || "hi"), body: inLang(body, s.lang || "hi"), url: url || "/" }),
        { TTL: 86400 },
      );
      sent++;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint); // uninstalled
    }
  }
  if (dead.length) save(SUBS, all.filter((s) => !dead.includes(s.endpoint)));
  const log = load(LOG, []);
  log.push({ at: new Date().toISOString(), title: forLog(title).slice(0, 120), body: forLog(body).slice(0, 400), url: url || "", source: source || "admin", sent, of: all.length });
  save(LOG, log.slice(-500));
  return { sent, of: all.length, removed: dead.length };
}

// ——— scheduled notifications: the admin picks the moment ———
const QUEUE = path.join(ROOT, "data", "push-queue.json");
export const queuedNotifications = () => load(QUEUE, []).sort((a, b) => (a.at < b.at ? -1 : 1));
export function scheduleNotification(title, body, url, atIso) {
  const q = load(QUEUE, []);
  const item = { id: Date.now().toString(36), at: atIso, title, body: String(body).slice(0, 300), url: url || "" };
  q.push(item);
  save(QUEUE, q);
  return item;
}
export function cancelScheduled(id) {
  const q = load(QUEUE, []);
  const left = q.filter((i) => i.id !== id);
  if (left.length !== q.length) save(QUEUE, left);
  return q.length - left.length;
}
// called every minute by the server; also catches up anything missed while down
export async function processQueue() {
  if (!ready) return;
  const q = load(QUEUE, []);
  if (!q.length) return;
  const now = Date.now();
  const remain = [];
  for (const i of q) {
    if (new Date(i.at).getTime() <= now) await sendToAll(i.title, i.body, i.url, "scheduled").catch(() => {});
    else remain.push(i);
  }
  if (remain.length !== q.length) save(QUEUE, remain);
}

// ——— the automatic whispers (called hourly by the server) ———
// upcoming = [{name, start, end}] from panchang; each fires once, after 8am IST.
export async function autoWhispers(upcoming) {
  if (!ready || !subCount()) return;
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const today = ist.toISOString().slice(0, 10);
  const hour = ist.getUTCHours();
  if (hour < 8) return; // let people wake up
  const st = load(STATE, {});
  // Sunday: the week's new Pathshala article
  // auto messages are English by the owner's rule — titles above all
  if (ist.getUTCDay() === 0 && hour >= 9 && st.sunday !== today) {
    st.sunday = today;
    save(STATE, st);
    await sendToAll(
      "🙏 Sunday's Teaching",
      "This week's new Pathshala article has arrived — read it and take your journey forward.",
      "https://ashaeiynn.com/pathshala/",
      "auto",
    ).catch(() => {});
  }
  // festival eves: anything starting tomorrow
  const tomorrow = new Date(ist.getTime() + 864e5).toISOString().slice(0, 10);
  for (const e of upcoming || []) {
    const k = "ev:" + e.name + e.start;
    if (e.start !== tomorrow || st[k]) continue;
    st[k] = today;
    save(STATE, st);
    const days = Math.round((new Date(e.end) - new Date(e.start)) / 864e5) + 1;
    const name = e.nameEn || e.name;
    await sendToAll(
      "🪔 " + name,
      days > 1
        ? `${name} begins tomorrow (${days} days). Prepare for your sadhana 🙏`
        : `Tomorrow is ${name} — an excellent day for sadhana 🙏`,
      "/",
      "auto",
    ).catch(() => {});
  }
}
