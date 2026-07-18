// Devanagari → Latin, so knowledge written in Hinglish is reachable by seekers
// who ask in Hindi.
//
// WHY THIS EXISTS: the embedding model compares SCRIPT as much as meaning across
// languages. Measured 2026-07-19 — against a Hinglish document, the very same
// question written in Devanagari scored 0.758 while an unrelated question scored
// 0.858. Voice input always produces Devanagari, so Bhaiya's Hinglish PDFs were
// effectively invisible to most seekers.
//
// The fix is on the QUERY side, not the knowledge side: every question is also
// searched in the other script. That costs nothing (this is plain rules, no AI
// call), needs no re-ingest, and covers every source already in the library as
// well as everything uploaded in future.
//
// It does not need to be a scholarly transliteration — it needs to land on the
// spellings people actually type: sadhana, guru, shakti, jaap.

const VOWELS = {
  अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ri",
  ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e",
};

// matras (the vowel signs that hang off a consonant)
const MATRA = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
  "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
  "ॉ": "o", "ॅ": "e",
};

const CONS = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", ळ: "l", व: "v",
  श: "sh", ष: "sh", स: "s", ह: "h",
  // nukta forms people actually write
  क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f",
};

const DIGITS = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };

const HALANT = "्";
const NUKTA = "़";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";

export const hasDevanagari = (t) => /[ऀ-ॿ]/.test(String(t));

export function toLatin(text) {
  const s = String(text || "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    // fold a following nukta into the consonant (क + ़ = क़)
    if (s[i + 1] === NUKTA && CONS[ch + NUKTA]) {
      ch = ch + NUKTA;
      i++;
    }
    if (CONS[ch]) {
      out += CONS[ch];
      const next = s[i + 1];
      if (next === HALANT) {
        i++; // joined to the next consonant — no vowel between them
      } else if (MATRA[next]) {
        out += MATRA[next];
        i++;
      } else {
        out += SCHWA; // the INHERENT vowel — the only one Hindi may drop
      }
      continue;
    }
    if (VOWELS[ch]) { out += VOWELS[ch]; continue; }
    if (DIGITS[ch]) { out += DIGITS[ch]; continue; }
    if (ch === ANUSVARA || ch === CHANDRABINDU) { out += "n"; continue; }
    if (ch === VISARGA) { out += "h"; continue; }
    if (ch === "।" || ch === "॥") { out += "."; continue; }
    if (ch === NUKTA || MATRA[ch] || ch === HALANT) continue; // stray sign
    out += ch; // spaces, punctuation, Latin already present
  }
  return out.replace(/\s+/g, " ").trim().split(" ").map(dropSchwa).join(" ").replace(SCHWA_RE, "a");
}

// Hindi does not pronounce the inherent vowel at the end of a word, and often not
// in the middle either: जाप is "jaap" not "jaapa", करना is "karna" not "karana".
// ONLY the inherent vowel may go — a written matra is a real sound and must stay,
// or "जाप" collapses to "jp". That is why the inherent one is marked apart above.
const SCHWA = "\u0001";
const SCHWA_RE = /\u0001/g;
const CONSONANT = "[bcdfghjklmnpqrstvwxyz]";

function dropSchwa(w) {
  let t = w;
  // medial: k·a·r·a·n·aa → karna (a schwa between two consonants, with a vowel
  // following soon after)
  t = t.replace(new RegExp(`(${CONSONANT})${SCHWA}(${CONSONANT})(?=[aeiou])`, "gi"), "$1$2");
  // final: jaap·a → jaap, band·a → band
  t = t.replace(new RegExp(`(${CONSONANT})${SCHWA}([^a-z\u0001]*)$`, "i"), "$1$2");
  return t;
}

// One word, many spellings. Bhaiya's material writes "pitra" (212 times in the
// library); a spoken "पितृ" transliterates to "pitri" and a typed one may be
// "pitru" or "pitar" — none of which appear in the knowledge at all. Owner,
// 2026-07-19: "Pitru, Pitr, Pitar, all these are same".
//
// TO ADD A WORD: one line here — the pattern of every spelling people use, and
// the spelling the LIBRARY uses. Applied to the search text only; nothing on
// screen and nothing stored ever changes.
const SPELLINGS = [
  [/\bpit(?:ri|ru|ar|ra|r)(?=\b|paksh|dosh)/gi, "pitra"],
  [/\bpitra\s*paksh/gi, "pitrapaksh"],
  [/\bkul\s*(?:devta|dev|devata)\b/gi, "kuldevta"],
  [/\bgur(?:u|oo)\s*dev(?:ta)?\b/gi, "gurudev"],
  [/\bsadh(?:a|)na\b/gi, "sadhna"],
  [/\bshakt(?:i|ee)y?an?\b/gi, "shakti"],
  [/\bmantr(?:a|)\b/gi, "mantra"],
  [/\bja(?:a|)p\b/gi, "jaap"],
];

export function normalizeSpelling(text) {
  return SPELLINGS.reduce((acc, [re, to]) => acc.replace(re, to), String(text || ""));
}
