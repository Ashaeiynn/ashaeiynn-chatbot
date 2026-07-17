# Work journal — the shared memory across all machines

Every Claude session, on ANY machine (MacBook, iMac, VPS), appends a
timestamped summary of significant work here — decisions, changes, and WHY.
At session start, read the most recent day below to know what happened on the
other machines. This file syncs through git automatically (auto-sync hooks),
so it is near-realtime across all systems.

RULES: newest day first · times in IST · substance over chatter ·
NEVER paste secrets, API keys, passwords, or raw chat transcripts here.

---

## 2026-07-17 (MacBook Pro session, with the owner)

- **~21:00** Credits switched to a DAILY model (owner's call): every seeker gets
  100 free questions/day, auto-refilled per IST day (lazy refill() on first
  interaction — no cron). Admin "Add credits" now grants a PERSISTENT bonus that
  carries over, on top of the daily 100. Spend takes from daily first (refills
  anyway), then bonus (preserves the gift). Fields on each user: dailyLeft,
  dailyDate, bonus; old single `credits` field retired via migrateToDaily().
  Out-of-credits msg reframed to "100 more tomorrow". Subscription model deferred.
  Verified live: all 5 users migrated to 100/day, bonus grant + daily-first
  deduction (99+50) correct, test residue cleaned.

- **~20:30** CREDITS shipped (admin-topup only, NO payment gateway — owner declined
  Razorpay for now). users.mjs: WELCOME_CREDITS=1000, register() grants it, one-time
  grantExisting() migration gives 1000 to all pre-credit users, credits()/addCredits()/
  spendCredit(). Server: out-of-credits gate BEFORE any AI call (warm "contact team"
  msg, since seekers can't self-recharge); 1 credit spent per real teaching answer
  (FREE: errors, greetings/small-talk, off-topic refusals, mentor handoffs); chat +
  signup responses return `credits`; GET /api/credits?uid; POST /api/admin/user-credits
  (usersOk lock). Uniform — members ARE charged too (owner said give everyone 1000; no
  members-free exception). Widget: 🪙 coin in header beneath 🔔🔇× (per mockup), amber
  when ≤10, refreshed on open + after each answer. Admin Users tab: credits column +
  🪙 Add credits button (prompt amount) + "credits held" stat.

- **~19:00** Member-suggested corrections shipped (owner chose MEMBERS-ONLY).
  Flow: bot detects a member says an answer was wrong (LLM emits `सुधार: 1`,
  server-gated to members → correctionInvite) OR a member taps 👎 (/api/feedback
  returns invite:true for members) → widget shows a "teach the right answer" box
  → POST /api/suggest (members-only, verified via users.byId) → PENDING queue in
  server/suggestions.mjs (data/suggestions.json, gitignored). Admin: new
  "📝 Suggestions (N)" chip in Questions tab → review card (question, bot answer,
  editable suggestion) → Approve (→ addCorrection, SAME pipeline as admin edits,
  bot learns it) / Reject. SACRED RULE preserved: nothing user-submitted touches
  knowledge until admin approves. New: users.byId(); markers सुधार parsed+
  seatbelt-scrubbed. Verified live end-to-end (member gating, submit, list,
  approve→correction, reject); admin UI screenshot-confirmed.
- **~14:30** iOS Hindi STT: auto-detect on English toggle (was force-en →
  mangled Hindi), short spelling prompt (long Devanagari prompt made Whisper echo
  it on short clips), verbose_json diagnostics (`stt ok:` lines in journalctl show
  size/lang/duration/text). Likely root cause = user's language toggle on English.

- **08:2x** Gendered address: male seekers = भाई, female = बहन (judged from the
  sign-up name; unclear = जी / neutral openers). prompt.mjs rule 2 + the
  per-question seeker note in server.mjs.
- **08:0x** Corrections became LEARNED knowledge, not canned replies: removed the
  verbatim early-return (it gave 3 different users the identical text and skipped
  name/style/followups). Same-meaning matches (≥0.9) now inject the correction as
  THE answer with strict adapt-don't-alter orders; related (0.8–0.9) stays
  highest-authority excerpt (rule 7b in prompt.mjs). Log flags: corrected (same
  meaning) / guided (related); admin badges ✏️/✍️ with explanation lines. Also:
  ✅ label previously showed only on the exact edited question — now every answer
  that used a correction is labeled.

- **07:42** Questions tab now shows the CORRECTED answer on corrected questions
  (not the old reply) with a ✅ note; corrected entries excluded from the
  "knowledge gap" count. Verified live: correction system works cross-wording +
  cross-user — a reworded जाप question from a different uid returned the owner's
  approved answer verbatim (corrected:true). Corrections = same-meaning ≥0.9 →
  verbatim; related ≥0.8 → highest-authority excerpt; per-question replace.
- **07:36-07:38** Owner's rule: studio sources (Vimeo/Zoom/audio) appear NOWHERE
  on screen — seekers get answer + Bhaiya's quote only; the visible "Source:"
  line shows only when it names a public source. Admin log keeps full answers
  (gap review intact). Quote parser now accepts "~ Excerpt N"; seatbelt scrubs
  unparsed quote-marker lines from display. Test contract updated in CLAUDE.md.
- **07:28** iOS ear upgraded: full whisper-large-v3 FIRST (turbo = fallback,
  separate quota) + सत्संग vocabulary prompt → live Hindi test heard
  "जय सिया राम। गुरुदेव कौन है..." word-perfect. Owner reported turbo couldn't
  understand Hindi. LINK POLICY: every seeker-facing link (sources, 🌱 suggest,
  quote) passes publicUrl() — only YouTube + ashaeiynn.com; all else citation-only
  (then hidden entirely per 07:36 rule).
- **07:17-07:20** Member-aware guidance: admin ⭐ Member flag now changes behavior
  — members NEVER pitched screening/joining (personal matters → "अपने mentor से
  बात कीजिए"); non-members warmly invited to screening when natural. Server-side
  backstop: help "screening"→"contact" for members. Handoff answers without the
  सहायता marker now still carry the human-door links (members: Contact only).
  questions.log entries now carry member:true; nightly study sees it.
- **07:09** Learning charter (owner pasted a spec; chose "Add A+B" over full
  charter — server-side per-user profiles REJECTED to preserve privacy design):
  (A) nightly reflect.mjs computes counted facts (timing buckets IST, repeat
  questions, sourceless gaps, Hindi %, chips taken, suggestions opened) → LLM
  writes 3-6 English "observations" → new 🔭 Observations card in Learning tab.
  (B) recommendation outcomes: widget labels chip asks via followup/thought,
  suggestion-link clicks beacon /api/feedback {opened,title} → reco entries in
  log → acceptance counts in style-notes.json + Learning tab line.
- **06:43-06:53** iOS voice = Groq ONLY (owner's cost rule — Gemini must never
  listen for iOS; on Groq failure iOS gets the error, no fall-through). GROQ_API_KEY
  installed in .env on MacBook + VPS. /health shows iosEar. Users tab got a second
  lock — SAME password as Library (x-library-key); one unlock opens both tabs.
  Admin CSS: [hidden]{display:none!important}. Girudev/गिरुदेव → Gurudev corrections.
- **~06:30** "3 subscribed phones" mystery solved: reinstalls leave stale push
  channels; subCount now counts unique registered USERS (people, not channels);
  Notify tile renamed "subscribed users". Registration already dedupes by
  WhatsApp/email (revives the same record — better than delete+recreate).
- **Context**: 2 registered users (Rohan, Soni — both ⭐ members, both subscribed).
  First nightly self-review ran 03:00 (53 conversations → 8 coaching lessons).
  VPS ops: repo at /opt/chatbot/app, pulls run AS USER chatbot — force-deploy
  with /opt/chatbot/update.sh (root git pull fails). Owner's pending decision:
  Google billing vs current free-tier setup (Groq now covers the iOS ear).

## 2026-07-16 → 17 night (earlier work, summarized)

- Anthropic failover live: any Gemini failure retries on claude-haiku-4-5
  (llm.mjs); /health shows backup. Balance ~$0.80.
- देवालय Gold theme everywhere; app renamed "Ashaeiynn Guide" with premium gold
  icon (?v=g3); Android WebAPK identity still propagating (Google factory cache).
- Push notifications: VAPID via scripts/gen-vapid.mjs, admin Notify tab (compose,
  templates, schedule by date/time, history), auto-whispers (Sunday article,
  festival eves from panchang.mjs — Meeus moon phases + owner overrides in
  data/calendar.json). Notification-tap opens a conversation about it.
- Mandatory sign-up (name/WhatsApp/nickname/email) before use; admin 👥 Users
  tab (active ≤15d / inactive / deleted, ⭐ member marking); delete-account via
  avatar tap; per-device journey in localStorage (privacy-first, server stores
  no journeys).
- Two-tier self-learning: nightly reflect.mjs (chatbot-reflect.timer 03:00 IST)
  → core (proven, ≤10) + daily (≤6) style lessons → 🧠 Learning tab.
- iOS voice path: MediaRecorder → /api/stt (SpeechRecognition dead in standalone);
  12s cap + RMS auto-send; TTS via tap-blessed reusable Audio element.
