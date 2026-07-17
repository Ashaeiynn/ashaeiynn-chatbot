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
// Pay-as-you-use: each seeker has a persistent question-credit balance that
// only goes down as they use it (1 per response). New seekers start with
// WELCOME_CREDITS; the ONLY way to add more is the admin's Users tab.
// (No daily refill, no payment gateway yet — a subscription model comes later.)
export const WELCOME_CREDITS = 100;
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
    credits: WELCOME_CREDITS, // pay-as-you-use starting balance
    at: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  all.push(u);
  save(all);
  return u;
}

// ——— credits: a persistent pay-as-you-use balance ———
export function credits(id) {
  const u = byId(id);
  return u ? Number(u.credits || 0) : 0;
}
// admin tops a seeker up (Users tab) — persistent, any positive whole number
export function addCredits(id, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (!n || n < 0) return null;
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  u.credits = Number(u.credits || 0) + n;
  save(all);
  return u.credits;
}
// one credit spent per response (see server.mjs); never goes below zero
export function spendCredit(id, n = 1) {
  const all = load();
  const u = all.find((x) => x.id === id);
  if (!u) return null;
  u.credits = Math.max(0, Number(u.credits || 0) - n);
  save(all);
  return u.credits;
}
// migrate off the earlier DAILY model onto one persistent balance = whatever the
// seeker had available at switch-over; then retire the daily fields. Idempotent.
(function migrateToPersistent() {
  const all = load();
  let changed = false;
  for (const u of all) {
    if (typeof u.credits !== "number") {
      // fold daily allowance + bonus into a single balance (or a fresh welcome)
      u.credits =
        u.dailyDate !== undefined
          ? (u.dailyDate === istDay() ? Number(u.dailyLeft || 0) : WELCOME_CREDITS) + Number(u.bonus || 0)
          : WELCOME_CREDITS;
      changed = true;
    }
    if ("dailyLeft" in u || "dailyDate" in u || "bonus" in u) {
      delete u.dailyLeft;
      delete u.dailyDate;
      delete u.bonus;
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
      credits: Number(u.credits || 0),
      status: u.deleted ? "deleted" : now - new Date(u.lastSeen).getTime() <= ACTIVE_DAYS * 864e5 ? "active" : "inactive",
    }))
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}
