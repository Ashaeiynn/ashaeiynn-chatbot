// पंचांग awareness: the guide knows today's date (IST), पूर्णिमा/अमावस्या, and
// festival windows (नवरात्रि, गुप्त नवरात्रि, होली, दिवाली…) so it can resolve
// "नवरात्रि के आख़िरी 3 दिन" like a human guide would.
//
// Moon phases are COMPUTED (mean synodic month from a known epoch — day-level
// accuracy for decades, no yearly maintenance). Festivals are derived from the
// right moon in a Gregorian window. True पंचांग tithis can differ by ±1 day
// (skipped/doubled tithis), so answers should treat dates as "पंचांग से ±1 दिन".
// The owner can pin exact dates in data/calendar.json — overrides always win:
//   { "events": [ { "name": "गुप्त नवरात्रि (आषाढ़)", "start": "2026-07-15", "end": "2026-07-23" } ] }
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SYNODIC_MS = 29.530588853 * 864e5;
const EPOCH = Date.UTC(2000, 0, 6, 18, 14); // a known new moon

// IST calendar date (YYYY-MM-DD) of an instant
const istDate = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
const fmt = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${d} ${M}`;
};
const inWindow = (iso, [from, to]) => {
  const md = iso.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
};

// true moon-phase instant (Meeus first-order): mean phase + the main periodic
// corrections — brings the mean (±14h) down to ~1-2h, enough to trust the day.
const RAD = Math.PI / 180;
function truePhaseMs(k, phase /* 0 = new, 0.5 = full */) {
  const kk = k + phase;
  const M = (2.5534 + 29.1053567 * kk) * RAD; // sun's mean anomaly
  const Mp = (201.5643 + 385.81693528 * kk) * RAD; // moon's mean anomaly
  const F = (160.7108 + 390.67050284 * kk) * RAD; // argument of latitude
  const c1 = phase === 0 ? -0.4072 : -0.40614;
  const c2 = phase === 0 ? 0.17241 : 0.17302;
  const corr =
    c1 * Math.sin(Mp) +
    c2 * Math.sin(M) +
    0.01608 * Math.sin(2 * Mp) +
    0.01039 * Math.sin(2 * F) +
    0.00739 * Math.sin(Mp - M) -
    0.00514 * Math.sin(Mp + M) +
    0.00208 * Math.sin(2 * M);
  return EPOCH + kk * SYNODIC_MS + corr * 864e5;
}

// all new/full moon IST dates within [nowMs-45d, nowMs+400d]
function moonDays(nowMs, phase /* 0 = new, 0.5 = full */) {
  const out = [];
  const k0 = Math.floor((nowMs - 45 * 864e5 - EPOCH) / SYNODIC_MS);
  for (let k = k0; k <= k0 + 16; k++) {
    const ms = truePhaseMs(k, phase);
    if (ms >= nowMs - 45 * 864e5 && ms <= nowMs + 400 * 864e5) out.push(istDate(ms));
  }
  return out;
}

// festivals derived from a moon day: start = moon + offset, lasting duration days
const DERIVED = [
  { name: "चैत्र नवरात्रि", phase: 0, window: ["03-15", "04-16"], offset: 1, duration: 9 },
  { name: "गुप्त नवरात्रि (आषाढ़)", phase: 0, window: ["06-20", "07-22"], offset: 1, duration: 9 },
  { name: "शारदीय नवरात्रि", phase: 0, window: ["09-15", "10-17"], offset: 1, duration: 9 },
  { name: "गुप्त नवरात्रि (माघ)", phase: 0, window: ["01-12", "02-13"], offset: 1, duration: 9 },
  { name: "महाशिवरात्रि", phase: 0, window: ["02-05", "03-10"], offset: -1, duration: 1 },
  { name: "होली (होलिका दहन)", phase: 0.5, window: ["02-25", "03-25"], offset: 0, duration: 2 },
  { name: "गुरु पूर्णिमा", phase: 0.5, window: ["07-03", "08-02"], offset: 0, duration: 1 },
  { name: "रक्षाबंधन", phase: 0.5, window: ["08-04", "09-02"], offset: 0, duration: 1 },
  { name: "जन्माष्टमी (लगभग)", phase: 0.5, window: ["08-04", "09-02"], offset: 8, duration: 1 },
  { name: "दिवाली", phase: 0, window: ["10-15", "11-14"], offset: 0, duration: 1 },
];

function ownerEvents() {
  try {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "calendar.json"), "utf8"));
    return (raw.events || [])
      .filter((e) => e && e.name && (e.date || e.start))
      .map((e) => ({ name: String(e.name), start: e.start || e.date, end: e.end || e.date || e.start, pinned: true }));
  } catch {
    return [];
  }
}

// every known event around now: [{name, start, end}]
function allEvents(nowMs) {
  const events = [];
  for (const d of moonDays(nowMs, 0)) events.push({ name: "अमावस्या", start: d, end: d });
  for (const d of moonDays(nowMs, 0.5)) events.push({ name: "पूर्णिमा", start: d, end: d });
  for (const f of DERIVED) {
    for (const d of moonDays(nowMs, f.phase)) {
      const start = addDays(d, f.offset);
      if (!inWindow(start, f.window)) continue;
      events.push({ name: f.name, start, end: addDays(start, f.duration - 1) });
    }
  }
  const pinned = ownerEvents();
  // an owner-pinned event replaces any computed one with the same name nearby
  const out = events.filter(
    (e) => !pinned.some((p) => p.name === e.name && Math.abs(daysBetween(e.start, p.start)) <= 20),
  );
  return out.concat(pinned).sort((a, b) => (a.start < b.start ? -1 : 1));
}

// one compact Hindi line the model can reason with
export function panchangLine(now = Date.now()) {
  const today = istDate(now);
  const events = allEvents(now);
  const parts = [`आज ${fmt(today)} ${today.slice(0, 4)}`];
  for (const e of events) {
    if (today >= e.start && today <= e.end) {
      const day = daysBetween(e.start, today) + 1;
      const total = daysBetween(e.start, e.end) + 1;
      parts.push(
        total > 1
          ? `${e.name} चल रही है: ${fmt(e.start)}–${fmt(e.end)} (आज दिन ${day}/${total})`
          : `आज ${e.name} है`,
      );
    }
  }
  const upcoming = events.filter((e) => e.start > today && daysBetween(today, e.start) <= 40).slice(0, 4);
  if (upcoming.length)
    parts.push("आगे: " + upcoming.map((e) => `${e.name} ${fmt(e.start)}${e.end !== e.start ? `–${fmt(e.end)}` : ""}`).join(", "));
  return parts.join(" · ");
}
