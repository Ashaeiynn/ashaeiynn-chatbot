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
// Every seeker gets a fresh DAILY allowance that auto-refills each IST day —
// whatever they use, tomorrow it's back to full. On TOP of that, the admin can
// grant persistent "bonus" credits (Users tab) that carry over day to day.
// (A subscription model comes later.)
export const DAILY_CREDITS = 100;
const istDay = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
// today's remaining allowance (a new day = full again) + any admin bonus
const effective = (u) => (u.dailyDate === istDay() ? Number(u.dailyLeft || 0) : DAILY_CREDITS) + Number(u.bonus || 0);
// lazily refill the daily bucket at the first interaction of a new IST day
// (no cron needed — the reset rides on whatever the seeker does next)
function refill(u) {
  if (u.dailyDate !== istDay()) {
    u.dailyLeft = DAILY_CREDITS;
    u.dailyDate = istDay();
    return true;
  }
  return false;
}

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
    dailyLeft: DAILY_CREDITS, // today's allowance
    dailyDate: istDay(),
    bonus: 0, // persistent admin-granted extra
    at: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  all.push(u);
  save(all);
  return u;
}

// ——— credits: today's allowance (auto-refilled) + persistent admin bonus ———
export function credits(id) {
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return 0;
  if (refill(u)) save(all); // a new day → top the daily bucket back up
  return effective(u);
}
// admin grants EXTRA credits (Users tab) — these are a persistent bonus that
// carries over day to day, on top of the 100 everyone gets each day
export function addCredits(id, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (!n || n < 0) return null;
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  refill(u);
  u.bonus = Number(u.bonus || 0) + n;
  save(all);
  return effective(u);
}
// one credit spent per real answer — from today's allowance first (it refills
// tomorrow anyway), then from the admin bonus so a gift lasts as long as possible
export function spendCredit(id, n = 1) {
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  refill(u);
  const fromDaily = Math.min(Number(u.dailyLeft || 0), n);
  u.dailyLeft = Number(u.dailyLeft || 0) - fromDaily;
  const rest = n - fromDaily;
  if (rest > 0) u.bonus = Math.max(0, Number(u.bonus || 0) - rest);
  save(all);
  return effective(u);
}
// migrate any record from the old model (single `credits` field) or from before
// credits existed onto the daily model. Idempotent — runs once per new field.
(function migrateToDaily() {
  const all = load();
  let changed = false;
  for (const u of all) {
    if (u.dailyDate === undefined) {
      u.dailyLeft = DAILY_CREDITS;
      u.dailyDate = istDay();
      u.bonus = Number(u.bonus || 0);
      changed = true;
    }
    if ("credits" in u) {
      delete u.credits; // retire the old single-balance field
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
      credits: effective(u), // today's remaining + bonus (no save — display only)
      status: u.deleted ? "deleted" : now - new Date(u.lastSeen).getTime() <= ACTIVE_DAYS * 864e5 ? "active" : "inactive",
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}
