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
import { markDeleted, listUsers } from "./users.mjs";
import { setAnnouncement } from "./announce.mjs";

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

export function addSub(sub, lang, uid) {
  if (!sub?.endpoint || !sub?.keys) return false;
  const all = load(SUBS, []);
  const clean = lang === "en" ? "en" : "hi";
  const existing = all.find((s) => s.endpoint === sub.endpoint);
  if (existing) {
    existing.lang = clean; // language preference can change over time
    if (uid) existing.uid = uid;
  } else {
    all.push({ endpoint: sub.endpoint, keys: sub.keys, lang: clean, uid: uid || "", at: new Date().toISOString() });
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
// Only subscriptions belonging to a REGISTERED, non-deleted user count or
// receive anything. Anonymous ones (pre-registration installs) stay dormant
// on disk — they self-heal to an identity when that phone opens the app
// after signing up (same endpoint gets its uid attached).
function validSubs() {
  let ids;
  try {
    ids = new Set(listUsers().filter((u) => !u.deleted).map((u) => u.id));
  } catch {
    return [];
  }
  return load(SUBS, []).filter((s) => s.uid && ids.has(s.uid));
}
// count PEOPLE, not channels: reinstalls leave stale device-subscriptions
// behind (swept automatically when a send finds them dead) and one seeker may
// have two devices — the admin sees users, delivery still reaches every device
export const subCount = () => subUids().length;
export const subUids = () => [...new Set(validSubs().map((s) => s.uid))];
export function removeByUid(uid) {
  if (!uid) return 0;
  const all = load(SUBS, []);
  const left = all.filter((s) => s.uid !== uid);
  if (left.length !== all.length) save(SUBS, left);
  return all.length - left.length;
}
export const pushLog = () => load(LOG, []).slice(-120).reverse();

// title/body may be a plain string (sent as-is to everyone — the admin's
// choice of language) or {hi, en} — each subscriber gets their own language.
const inLang = (v, lang) => (v && typeof v === "object" ? v[lang] || v.hi || v.en || "" : v);
const forLog = (v) => (v && typeof v === "object" ? `${v.hi || ""}${v.en ? ` | EN: ${v.en}` : ""}` : String(v || ""));

export async function sendToAll(title, body, url, source) {
  if (!ready) throw new Error("push-not-configured");
  const all = validSubs(); // registered users only
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
  if (dead.length) {
    // a dead channel is the strongest "app removed" signal a phone ever sends
    for (const ep of dead) {
      const s = all.find((x) => x.endpoint === ep);
      if (s?.uid) {
        try {
          markDeleted(s.uid, "app removed (push channel died)");
        } catch {
          /* registry best-effort */
        }
      }
    }
    save(SUBS, all.filter((s) => !dead.includes(s.endpoint)));
  }
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
    if (new Date(i.at).getTime() <= now) {
      // a scheduled notice also becomes the in-bot notice, now that it is live
      setAnnouncement({ title: i.title, text: i.body, link: i.url });
      await sendToAll(i.title, i.body, i.url, "scheduled").catch(() => {});
    } else remain.push(i);
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
