// The member registry: who uses the guide. Created because the owner needs
// to know members vs. visitors. Stored ONLY on the server disk (data/users.json,
// gitignored — personal details never travel to GitHub).
// Status is computed, never stored: deleted flag wins; otherwise active =
// used the guide within the last 15 days, else inactive.
import { readFileSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ROOT } from "./env.mjs";

const FILE = path.join(ROOT, "data", "users.json");
const ACTIVE_DAYS = 15;
// A DAILY allowance (owner, 2026-07-19): every seeker may ask DAILY_LIMIT
// questions each day, and the allowance comes back in full the next day.
// It renews lazily — the first question after midnight IST resets the count —
// so there is no scheduled job to run or to fail silently.
// The admin's Users tab can still grant EXTRA questions to one seeker; that
// bonus sits on top and is only touched once the day's allowance is spent.
export const DAILY_LIMIT = Number(process.env.DAILY_QUESTIONS || 25);
export const WELCOME_CREDITS = DAILY_LIMIT; // kept for older callers
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const load = () => {
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
};
const save = (v) => {
  try {
    writeFileSync(FILE, JSON.stringify(v, null, 1));
  } catch {
    /* disk is best-effort */
  }
};
const norm = (s, n = 80) => String(s || "").trim().slice(0, n);

export function register({ name, nick, whatsapp, email }) {
  name = norm(name);
  nick = norm(nick, 40);
  whatsapp = norm(whatsapp, 20).replace(/[^\d+]/g, "");
  email = norm(email, 120).toLowerCase();
  if (name.length < 2) throw new Error("Please write your full name.");
  if (!nick) nick = name.split(" ")[0];
  if (whatsapp.replace(/\D/g, "").length < 8) throw new Error("Please check the WhatsApp number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please check the email address.");
  const all = load();
  // same person on a new device (same WhatsApp or email) — one identity
  const existing = all.find((u) => u.whatsapp === whatsapp || u.email === email);
  if (existing) {
    existing.deleted = false;
    delete existing.deletedReason;
    existing.lastSeen = new Date().toISOString();
    existing.nick = nick;
    save(all);
    return existing;
  }
  const u = {
    id: crypto.randomBytes(9).toString("base64url"),
    name,
    nick,
    whatsapp,
    email,
    member: false,
    deleted: false,
    usedToday: 0,
    dayKey: istDay(),
    bonus: 0, // extra questions granted by the admin, spent after the daily allowance
    at: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  all.push(u);
  save(all);
  return u;
}

// Create or update a registry entry by a CALLER-PROVIDED id — used by the main
// app to enrol its users into the guide (the app owns the id and the identity).
// Everyone the app sends is a member of Ashaeiynn (member defaults to true here).
// Only the fields provided are touched, so re-calls are safe.
export function upsertById(id, fields = {}) {
  id = norm(id, 64).trim();
  if (!id) return null;
  const all = load();
  let u = all.find((x) => x.id === id);
  const now = new Date().toISOString();
  if (!u) {
    u = { id, member: true, deleted: false, usedToday: 0, dayKey: istDay(), bonus: 0, at: now, lastSeen: now };
    all.push(u);
  }
  if (fields.name != null) u.name = norm(fields.name);
  if (fields.nick != null) u.nick = norm(fields.nick, 40);
  if (fields.whatsapp != null) u.whatsapp = norm(fields.whatsapp, 20).replace(/[^\d+]/g, "");
  if (fields.email != null) u.email = norm(fields.email, 120).toLowerCase();
  if ("member" in fields) u.member = !!fields.member;
  if (!u.nick && u.name) u.nick = u.name.split(" ")[0];
  u.deleted = false;
  delete u.deletedReason;
  u.lastSeen = now;
  save(all);
  return u;
}

// ——— the daily allowance ———
// How many questions this seeker has left right now: today's remainder plus any
// admin-granted bonus. Reading it never writes — the reset happens on spend.
function leftFor(u) {
  if (!u) return 0;
  const usedToday = u.dayKey === istDay() ? Number(u.usedToday || 0) : 0;
  return Math.max(0, DAILY_LIMIT - usedToday) + Math.max(0, Number(u.bonus || 0));
}

export function credits(id) {
  return leftFor(byId(id));
}

// The split behind the total, so the guide can explain it accurately: the daily
// part resets tomorrow, the bonus part carries forward until used.
export function balance(id) {
  const u = byId(id);
  const usedToday = u && u.dayKey === istDay() ? Number(u.usedToday || 0) : 0;
  const dailyLeft = Math.max(0, DAILY_LIMIT - usedToday);
  const bonus = Math.max(0, Number(u?.bonus || 0));
  return { dailyLeft, bonus, left: dailyLeft + bonus, limit: DAILY_LIMIT };
}

// admin grants EXTRA questions (Users tab) — on top of the daily allowance,
// carried over day to day until used
export function addCredits(id, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (!n || n < 0) return null;
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  u.bonus = Math.max(0, Number(u.bonus || 0)) + n;
  save(all);
  return leftFor(u);
}

// one question spent per response (see server.mjs). Spends the day's allowance
// first, then any bonus. A new IST day resets the count before charging.
export function spendCredit(id, n = 1) {
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  const today = istDay();
  if (u.dayKey !== today) {
    u.dayKey = today;
    u.usedToday = 0;
  }
  for (let i = 0; i < n; i++) {
    if (Number(u.usedToday || 0) < DAILY_LIMIT) u.usedToday = Number(u.usedToday || 0) + 1;
    else if (Number(u.bonus || 0) > 0) u.bonus = Number(u.bonus) - 1;
  }
  save(all);
  return leftFor(u);
}
// Move records onto the daily model (owner switched back 2026-07-19). The old
// persistent `credits` balance is dropped rather than carried over: the credit
// system was switched OFF while it existed, so no seeker ever really held one.
// Idempotent — safe to run on every boot.
(function migrateToDaily() {
  const all = load();
  let changed = false;
  for (const u of all) {
    if (typeof u.usedToday !== "number") {
      u.usedToday = 0;
      u.dayKey = istDay();
      changed = true;
    }
    if (typeof u.bonus !== "number") {
      u.bonus = 0;
      changed = true;
    }
    if ("credits" in u || "dailyLeft" in u || "dailyDate" in u) {
      delete u.credits;
      delete u.dailyLeft;
      delete u.dailyDate;
      changed = true;
    }
  }
  if (changed) save(all);
})();

// every question refreshes lastSeen (and revives a wrongly-deleted user);
// returns the record so the caller can see flags like member at question time
export function touch(uid) {
  if (!uid) return null;
  const all = load();
  const u = all.find((x) => x.id === uid);
  if (!u) return null;
  u.lastSeen = new Date().toISOString();
  if (u.deleted) {
    u.deleted = false;
    delete u.deletedReason;
  }
  save(all);
  return u;
}

export function markDeleted(uid, reason) {
  if (!uid) return;
  const all = load();
  const u = all.find((x) => x.id === uid);
  if (u && !u.deleted) {
    u.deleted = true;
    u.deletedReason = reason || "account";
    save(all);
  }
}

// admin actions: member badge, delete/restore
export function setFlags(id, patch) {
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  if ("member" in patch) u.member = !!patch.member;
  if ("deleted" in patch) {
    u.deleted = !!patch.deleted;
    if (u.deleted) u.deletedReason = "admin";
    else delete u.deletedReason;
  }
  save(all);
  return u;
}

// look a user up by id (for member checks at question/feedback/suggest time)
export function byId(id) {
  if (!id) return null;
  return load().find((u) => u.id === id) || null;
}

export function listUsers() {
  const now = Date.now();
  return load()
    .map((u) => ({
      ...u,
      // what the admin sees: questions left today (allowance remainder + bonus)
      credits: leftFor(u),
      usedToday: u.dayKey === istDay() ? Number(u.usedToday || 0) : 0,
      dailyLimit: DAILY_LIMIT,
      status: u.deleted ? "deleted" : now - new Date(u.lastSeen).getTime() <= ACTIVE_DAYS * 864e5 ? "active" : "inactive",
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}
