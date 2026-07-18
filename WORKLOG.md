# Work journal — the shared memory across all machines

Every Claude session, on ANY machine (MacBook, iMac, VPS), appends a
timestamped summary of significant work here — decisions, changes, and WHY.
At session start, read the most recent day below to know what happened on the
other machines. This file syncs through git automatically (auto-sync hooks),
so it is near-realtime across all systems.

RULES: newest day first · times in IST · substance over chatter ·
NEVER paste secrets, API keys, passwords, or raw chat transcripts here.

---

## 2026-07-18 (MacBook Pro session, with the owner)

- **Ambiguous साधना questions now ask WHICH one** (owner: "in ashaeiynn we do many
  sadhanas — the bot should ask which sadhana the user is talking about"). New rule 7c
  in prompt.mjs: when a question asks about नियम / timings / food / instructions without
  naming the साधना, do NOT guess and do NOT blend — reply in one short warm line asking
  which, and put the choices in the सुझाव line so the seeker just taps one. Verified live.

- **Voice silent on Android too — code proved innocent.** Ran the real path in a browser with
  the server voice down: the MIC path made 6 /api/tts calls, got 502 on every one, then fell
  back and spoke through the device voice ("Lekha"); the TYPED path never calls the server at
  all (by design — typed chats use the free device voice) and also spoke. So the fallback chain
  is sound; the silence is on the device.
  Most likely cause: the phone has NO Hindi text-to-speech voice installed, in which case
  browserSpeak produces no sound and no error at all. Added a one-time notice so this stops
  being invisible: "🔈 इस फ़ोन में हिंदी आवाज़ नहीं है — phone की Settings › Text-to-speech में
  Hindi जोड़िए…" plus a console warning. STILL UNCONFIRMED on the owner's actual phone — needs
  the 🔊 toggle state and whether Hindi TTS is installed there.

- **Fallback voice had gone silent on iOS.** Owner: when the Gemini voice ran out, a different
  voice used to take over — it stopped. TWO separate things:
  1. The server voice IS currently down — /api/tts returns 502 (Gemini TTS 429, shared free
     tier exhausted, partly from my own testing today). It recovers on its own.
  2. The browser-voice fallback is intact in code and works on Android/desktop, but on iPhone
     Apple only allows speech that was started from a real tap. The guide always speaks LATER
     — after the answer arrives and after the server voice has been tried and failed — so by
     then the tap is gone and iOS silently refuses. Nothing had ever primed it.
  FIX: `primeVoice()` fires one silent utterance during the tap itself (mic tap and Send), which
  unlocks speech for the rest of the visit; also warms the async voice list via `voiceschanged`.
  Verified deployed (primer present, wired at both entry points, fallback path untouched).
  NOT verifiable from here — needs a real iPhone with the server voice still out of quota.

- **A seeker on iOS saw "server 503 · groq key missing".** Investigated and could NOT reproduce:
  the ear works (live /api/stt test returns 200 via Groq whisper-large-v3), /health reports
  iosEar=groq-whisper, and .env on the VPS is clean — one GROQ_API_KEY line, no CR endings, no
  trailing space, untouched since 2026-07-17. The failure window (19:37-19:39 UTC) sits between
  two deploy restarts and left NO log line, because the refusal path returned before logging.
  Root cause therefore unknown. Two changes so it cannot happen silently again:
  1. The refusal now logs loudly ("stt REFUSED: GROQ_API_KEY missing from the running process"),
     and before refusing it re-reads .env — if the key is on disk but absent from the process
     (e.g. started before it was added), the request recovers instead of failing.
  2. The seeker no longer sees server error strings. "server 503 · groq key missing" on a phone
     mid-prayer is a bad look; the widget now says "आवाज़ सुनने की सेवा अभी उपलब्ध नहीं है — अभी
     ⌨️ type कीजिए 🙏" and puts the technical detail in the browser console.
  Also seen in that window: Gemini TTS 429 quota errors — the shared free tier being hit, partly
  from my own testing. Worth watching if seekers report the voice going quiet.

- **Credit system switched ON as a DAILY allowance** (owner, 2026-07-19): 50 questions per
  seeker per day, renewing in full every day. This REVERSES the earlier pay-as-you-use model —
  users.mjs had already migrated away from a daily one, so it went back the other way.
  Design: no scheduled reset job. Each record holds `usedToday` + `dayKey`; the first question
  after midnight IST notices the new day and zeroes the count. Nothing to cron, nothing to fail
  silently. `DAILY_QUESTIONS` in .env overrides the 50.
  The admin's Users tab now grants EXTRA questions (`bonus`) instead of topping up a balance:
  extras sit on top of the daily 50, are only spent once the day's allowance is gone, and carry
  over day to day. Wording updated everywhere ("questions left today", "Grant extra").
  Migration drops the old `credits` field — nobody held a real balance, the system was off.
  CREDITS_ON = true in all three files (server.mjs, widget.js, admin.html).
  Verified: 8 logic cases offline (fresh seeker 50 → spend 50 → 0 → never negative → next day
  renews → +10 bonus = 60 → daily gone leaves 10 → bonus spends down → admin sees the same
  figure); live 50→49→48 on real questions; all 9 seekers migrated. The exhausted path was
  checked live too, by temporarily setting the owner's own record to 50 used and restoring it
  straight after — seeker sees "आज के आपके 50 प्रश्न पूरे हो गए। कल फिर से 50 प्रश्न मिल जाएँगे…"
  with the Contact link, NOT the old "credits finished" wording.

- **Installing on Android: grey "A" icon, and no install prompt.** A seeker's phone showed the
  app as a generic letter tile labelled with the PAGE TITLE ("Ask Your Guide — Ashaeiynn")
  instead of the manifest name ("Ashaeiynn Guide") — the signature of a plain bookmark shortcut,
  i.e. the manifest was never read. Server side was verified fine: manifest served as
  application/manifest+json, both icons genuine PNGs at exactly 192×192 and 512×512. So the
  install had been made by an in-app browser (WhatsApp/Facebook link) or a phone's own browser
  (that was a Xiaomi), neither of which reads manifests.
  TWO REAL GAPS FOUND AND FIXED:
  1. `sw.js` existed but had NO fetch handler, and was registered ONLY inside `pushSubscribe()`
     — so unless a seeker switched notifications on, no service worker ever existed and Chrome
     would not offer "Install app" by itself. Now registered on load (guide's own origin only —
     embedded elsewhere there is no /sw.js) and given a fetch handler.
     The handler caches NOTHING and only touches page navigations: the widget is deliberately
     served no-cache so fixes reach phones immediately, and API/TTS audio must not be
     intercepted. Verified live: registered, activated, controlling, chat round-trip normal,
     zero console errors.
  2. In-app browsers now get one dismissible line — "Open this in Chrome to install the app on
     your phone" (Safari wording on iPhone) — shown only when in an in-app browser, not already
     installed, and not previously dismissed. UA detection tested against 7 real user agents
     (FB_IAB, Instagram, WhatsApp, Android `; wv)`, vs real Chrome/Safari/desktop).
  NOT PROVEN FROM HERE: whether Chrome now actually raises the prompt on a real phone — it also
  applies its own engagement heuristics. Needs the owner to test on Android.

- **"Talk to your mentor" was landing in almost every answer** (owner: it should only say that
  when really necessary). Rule 15 was correctly scoped, but the MEMBER context block carried
  *"For personal matters send them to THEIR OWN mentor: अपने mentor से बात कीजिए"* on EVERY
  member request, keeping the referral permanently in view — so the bot reached for it as a safe
  close even on "मंत्र कैसे चुनें?". Fixed by deciding in code: `PERSONAL_ASK` (health, fear,
  crisis, black magic, their own condition or family — Hindi/Hinglish/English) picks the branch.
  Personal → rule 15 applies, mentor referral. Otherwise the note now says explicitly: this is a
  TEACHING question, answer it and do NOT refer them to their mentor, not even as a closing
  suggestion. Verified live: 4 teaching questions → no mentor; "मुझे बहुत डर लगता है, रात को नींद
  नहीं आती" → mentor, as it should. 16 offline cases for the detector.
  NOTE: "मुझे साधना शुरू करनी है" is deliberately NOT personal — it is a beginner's teaching
  question, and it was one of the answers that had been closing with a mentor referral.

- **Every answer opened "देखो Rohan भाई," — the clearest tell of a machine.** Owner: "once or
  twice is good, but to build it as a conversation, its not something a human does". Two causes:
  1. prompt.mjs rule 2 literally said *Open teachings with "देखो…", "देखो भाई…"*. Rewritten:
     those words are FLAVOUR, NOT A TEMPLATE — vary every time, most often just begin with the
     answer itself, never open two answers in a row alike.
  2. The addressing note said "address them by name ONCE", which the model read as "open with it".
  Prompt wording alone was not trusted (it has failed twice today), so the server now computes
  `recentOpenings` — the first 4 words of the last 3 answers — and forbids reusing them.
  ⚠️ FIRST ATTEMPT OVER-CORRECTED: warmth vanished completely — no name, no भाई/बहन anywhere
  ("most answers need no name at all" made it go cold, the opposite mistake). Fixed by deciding
  warmth in CODE on a rhythm: `addressedRecently` looks at the last 2 answers; if they were
  addressed, this answer does not; if not, it addresses them ONCE and never as the opening words.
  Measured over a 4-turn conversation: openings all different, warmth on turns 1 and 4 only.
  LESSON: when correcting a behaviour, check the opposite failure too — "stop doing X" reliably
  produces "never do X", which was not what was asked for.

- **"हां ठीक है" was treated as a new question.** Owner: two questions about सिद्धि, then a
  bare "हां ठीक है" — and the bot delivered a fresh teaching that wandered onto साधना rules.
  Reproduced exactly (83 words + 3 sources for an acknowledgement). Cause: nothing marked a
  bare agreement as conversation, so retrieval ran and the model wrote an essay. Fixed the
  same way as greetings — `ACK_ONLY` in server.mjs (Hindi/Hinglish/English: हाँ · ठीक है ·
  अच्छा · समझ गया · ओके · ok · thanks · got it …, up to 3 such words, ≤5 words total, and ONLY
  when there is a previous assistant turn to be agreeing with). Skips retrieval, translation
  and पंचांग; the injected note says stay on the CURRENT topic, one short line, and put the
  follow-ups on that same topic. After: 16-24 words, 0 sources, chips still about सिद्धि.
  Regression-checked: "सिद्धि क्या होती है?" still answers in full (107 words, 3 sources).

- **Teaching is now from written material only** (owner's decision, 2026-07-18): folder upload,
  audio/video upload and YouTube/Vimeo link teaching all REMOVED from the portal — machine
  transcription had proved unreliable enough to damage the knowledge, so Bhaiya's recordings
  come in as human-checked transcripts. Removed in both places: teach.mjs (`teachFile` media
  branch and `teachLink`'s video branch now refuse with a message pointing to the transcript)
  and admin.html (folder button/input and the drag-drop directory walk gone, file picker
  accepts documents only, card text rewritten). The transcription pipeline itself is NOT
  deleted — `node pipeline/6-audio.mjs "<file>" "<title>"` still works from the command line
  if it is ever wanted again, and this is one `git revert` away.

- **Cleared the video-era leftovers under every answer** (owner: the videos-to-watch are gone
  since we deleted them — "in their place lets give few questions to ask"). Sources were still
  arriving (3-5 per answer) but they are now ARTICLES, shown under a "📿 देखिए" (watch) heading
  with a play icon and a "0:00" badge. Fixed in the widget, all verified on the live UI:
  - the source heading now reads "📖 पढ़िए" unless a real video is among the links;
  - the "0:00" badge is hidden when there is no real position to jump to;
  - "🌱 आगे देखिए" (watch next) now only offers an actual YouTube/Vimeo link — it had been
    recommending "Website: Reviews (0:00)";
  - the follow-up question chips (which the bot was already returning every time) now carry a
    heading, "🙏 आप यह भी पूछ सकते हैं", so they read as the invitation they are.
  NOTE for testing the widget UI: the seeker onboarding form gates everything. Do NOT fill it
  in (it writes a real user); seed localStorage "ashaiJourney" with a uid/name instead and
  reload — that skips onboarding with no server-side effect.

- **Admin uploads: audio/video and folders** (owner reported neither works). Neither was a bug,
  both were bad signposting:
  - The VPS has no transcription tool at all (checked: no mlx_whisper, no ffmpeg), so the live
    portal rejects media BY DESIGN — but the upload box advertised "mp3 · mp4 · wav · m4a · mov"
    and let them be selected, failing one file at a time. /health already exposed
    `teachMedia:false`; the page now reads it and relabels itself, and catches recordings up
    front with one clear message.
  - Folder upload was already implemented (webkitdirectory + drag-drop tree walk) and works in
    a computer browser — but iPhone/iPad cannot pick folders at all (Apple). The button is now
    hidden on those devices with a line explaining to pick files instead.
  OPEN OFFER: audio/video COULD work on the live bot via Groq whisper (key already present for
  the iOS ear) — ~$2.50 for 64h, needs ffmpeg installed on the VPS. Awaiting the owner's call.

- **Corrections now understand what is being corrected** (owner: the member should either be
  told what to write, "or the bot should understand by itself when the user is correcting it").
  Members write like people — "I am correcting you, next time someone ask about X, tell them…".
  Filed literally, that whole sentence became the embedding key, so the correction never fired.
  Now, on submit, the server reads the exchange and works out (a) the QUESTION this teaching
  answers — using the member's own "next time someone asks about X" when they name it — and
  (b) the teaching alone, preamble stripped, every figure kept. Verified on the real message
  that failed: key → "siya tattva sadhana ke niyam ya khane ka samay kya hai?", teaching → the
  3/3/6 rule with nothing lost. The admin card now SHOWS that question and lets it be edited
  before approving, so a bad key can never again fail silently. Widget box also says plainly:
  write only the answer.

- **The same cross-language problem, in the KNOWLEDGE BASE — and it was live.** Uploaded
  material (PDF/Word/articles/transcripts) is stored in whatever language it was written in;
  there are no translated copies. Cross-language reach comes entirely from translating the
  QUESTION at ask time and searching both texts (searchMulti). Measured what happens when
  that translation is missing: "dhyan me man kyu bhatakta hai" returned
  "GMT20240122-173714_RecordingnewChat" and the bot's own about-page — matches by ALPHABET.
  With the translation: the meditation and Bodh articles, correctly.
  Then measured how often it was missing: the race was capped at 1.2s with no retry, and
  **3 of 4 translations took 1.14-1.79s** (Gemini rate-limited → slower backup answering), so
  the bot was quietly searching by alphabet much of the time. Raised the cap to 2.6s (it is a
  race — a fast translation still costs nothing) and added an 800-entry cache, since seekers
  re-ask and tap the same suggestion chips constantly. Verified live afterwards: that same
  Hinglish question now cites The Hidden Science of Meditation / The Science of Bodh.
  FOLLOW-UP (done, owner approved): legal/admin pages are now excluded from SEARCH —
  `BOILERPLATE_PAGE` in retrieve.mjs drops Website: Disclaimer / Terms & Conditions /
  No Refund Policy / Shipping (8 chunks of 902). They stay in the library, nothing deleted,
  one regex to undo. 894 usable chunks; verified live that "Disclaimer" no longer appears
  as a cited source. Every other website page is real content and was left alone.

- **⚠️ MAJOR FINDING — a Hinglish correction was invisible to Hindi seekers.** e5 compares
  SCRIPT as much as meaning across languages. Against a Latin-script (Hinglish) key:
  the SAME question in Devanagari scored 0.758, while an UNRELATED question ("ध्यान में मन
  क्यों भटकता है?") scored 0.858. So any correction a member wrote in Hinglish could never be
  reached by seekers asking in Hindi — and voice input is Devanagari, i.e. most of them.
  FIX: every approved correction is now also filed under 3-4 generated wordings — Hindi,
  English and Hinglish — and matching takes the best of them (`alts` in corrections.mjs).
  Measured after: an English asking of the same question went from 0.000 (dead) to 0.928;
  Devanagari and Hinglish rewordings 0.936-0.985 (DIRECT). Different questions stay silent.
  CAUTION for future work: do NOT use cosine to police a cross-language paraphrase — it is
  meaningless there. The same-question check now only runs Devanagari-to-Devanagari (a first
  version gated on "same script", which lumps English with Hinglish and silently threw away
  the good English wording).
  Old corrections (no alts) load and fire unchanged — verified live after deploy.

- **Ask back instead of answering vaguely** (owner: "if the bot is unable to find a proper
  answer or understand the question, it can ask a question to the user"). Two halves:
  - **Rule 7d in prompt.mjs** — ask ONE short question when the meaning is unclear OR the
    excerpts do not actually answer it. Guardrails against over-asking: answer if you can;
    read the conversation first (a short follow-up is clear from context); never twice in a
    row; off-topic still gets rule 8's fallback; never ask for personal details.
  - **`UNCLEAR_ONLY` in server.mjs** — a contentless OPENING message ("बताइए", "क्या करूँ?",
    "help me", "मेरी समस्या है") is caught in code and skips retrieval/translation/पंचांग
    entirely, like a greeting.
  MEASURED FIRST, and it changed the design twice:
  1. Retrieval score is USELESS as an "I don't know" signal — clear questions 0.812-0.878,
     vague 0.807-0.838, off-topic 0.788-0.847. "what is the price of bitcoin" (0.847) scores
     HIGHER than "सिया तत्व साधना क्या है?" (0.812). A confidence threshold would have
     misfired constantly. Same narrow-band trap as the correction thresholds.
  2. Rule 7d ALONE did not hold — the model still answered vague openers with 80-90 words of
     general advice before getting to the question. Only the code trigger fixed it: those
     openers now get 17-27 words + 3 tappable options.
  Regression-checked: a clear question still gets its full teaching (109 words), "क्या करूँ?"
  AFTER a real answer is answered in context (not re-asked), greetings stay greetings,
  off-topic stays the fallback.

- **"What IS this साधना?" vs "what are its नियम?" — two different questions** (owner:
  "if someone asks about the sadhana it should not contain the instruction… if they ask
  the rules, then only a member gets them"). Embedding similarity rated both the same, so
  the approved food-rules answer was being delivered to a plain "सिया तत्व साधना क्या है?".
  Decided in CODE now (server.mjs, next to the greeting detector), not left to the model:
  - `RULES_STRONG` (नियम/निर्देश/विधि/कैसे करें/rules/method…) = always a how-to.
  - `RULES_SOFT` (खाना/समय/नमक/दूध/व्रत…) = a how-to UNLESS the question asks for meaning
    (महत्व/फायदे/क्यों) — so "व्रत का महत्व क्या है?" stays a teaching question.
  - Hinglish covered too (niyam, khane, samay, kaise karu…) — many seekers type in Latin.
  - `SADHANA_TOPIC` scopes the members-only gate to साधना/अनुष्ठान/दीक्षा/नवरात्रि/जाप, read
    from the last 2 turns as well (so "इसके नियम?" after naming one still counts).
    Deliberate: "ध्यान कैसे करें?" is Bhaiya's OPEN teaching (it's on the channel) and must
    stay open to a newcomer — the gate is for a साधना's निर्देश, not every how-to.
  Behaviour: non-member + साधना rules → the approved answer is DROPPED from the context
  entirely (the model cannot leak what it never received) and it warmly says what the
  साधना is, explains the निर्देश are given personally, and invites a screening
  (`सहायता: screening` attaches the link). Member + rules → full निर्देश as before.
  Anyone asking "what is it" → the teaching, never the rule sheet. All 4 combinations
  verified live; 22 offline cases for the classifier.
  NOTE for the owner: membership comes from the admin Users tab — a real member on a
  new/unregistered device counts as a non-member until they're marked there.

- **CRITICAL — the bot changed a figure in Bhaiya's approved answer.** Asked about
  सिया तत्व साधना food rules it said milk is barred after **8 बजे**; the approved answer
  says **6 बजे**. The correction had fired correctly (DIRECT, 0.936) — the MODEL drifted
  while re-wording. Seekers act on these numbers, so this is a real-world error, not a
  wording nit. Two-layer fix:
  1. Prompt (rule 7b + the DIRECT-match note): never alter a number, clock time, count,
     duration or name — re-word the prose freely, never the figures.
  2. **Code guard** (prompt alone was NOT enough — measured 1 wrong run in 2 after the
     prompt fix): on a DIRECT match, compare the digits of the approved answer with the
     digits of the generated answer (Devanagari numerals normalised, Source line ignored).
     On any mismatch, one cheap narrow repair call; if that still disagrees, deliver
     Bhaiya's approved text as it stands. Accuracy of a rule outranks nice phrasing.
     Result: 4/4 runs now say 6 बजे, still freshly worded per seeker.
  LESSON for future sessions: for anything a seeker ACTS on (times, counts, दिन, mantra
  counts), verify in code — never trust the prompt alone.

- **Bug this exposed: marker lines leaked into the spoken answer.** सुझाव / वापसी /
  वार्ता / साधना / सहायता are all parsed with END-of-answer anchors, but the model does
  not always put `Source:` last — when it wrote Source *before* them, none matched and
  the seeker saw (and heard) the raw marker text, with no tappable chips. Fixed by
  lifting the Source line out before parsing and putting it back after. Verified.

- **Owner reported: answers too generic / "going round and round", greetings got essays.**
  THREE real causes found and fixed (all measured, not guessed):
  1. **BIGGEST — correction thresholds sat inside the noise band.** e5 rates ANY two
     same-language spiritual sentences 0.75–0.84. HINT was 0.80, so a loosely-related
     admin correction was injected as "outranks every excerpt" on nearly EVERY question
     (a bare greeting scored 0.801!), dragging answers off the real teachings. Measured:
     noise 0.75–0.84 · genuine rewordings 0.86–0.93 · exact 0.975. Recalibrated
     HINT 0.80→0.88, DIRECT 0.90→0.93 (corrections.mjs). Bias high on purpose: a missed
     correction just means a normal answer; a false match poisons every answer.
  2. **Greetings were treated as knowledge questions** (retrieved + taught + Source line).
     Now deterministic in code: GREETING_ONLY regex in server.mjs → skips retrieval,
     skips पंचांग, one short line back. Verified 89 → 15 words, no sources.
  3. **Its own nightly learning coached padding** ("open with the name", "end with an
     affirming tone"). Removed; reflect.mjs now forbidden from writing length-adding
     lessons; prompt.mjs `isPadding()` filters any that slip through (keeps trim ones).
  Also: rule 3 rewritten (answer in the FIRST sentence, ~90-word cap, never pad with
  general spiritual filler), rule 4b greeting brevity with examples, पंचांग no longer
  volunteered, and the parser now accepts the Hindi "स्रोत:" as a Source line.
  Verified live: knowledge answer 234→94 words, sources are real recordings again.

## 2026-07-17 (MacBook Pro session, with the owner)

- **~21:40** Credits FINAL model = pay-as-you-use (owner's call after seeing premium-voice
  cost ~₹75-140/user/day). Reverted the daily-refill: persistent single `credits` balance,
  NO reset. New seekers start with WELCOME_CREDITS=100; every response spends 1 (errors free);
  admin tops up in Users tab (persistent). Out-of-credits msg back to "contact team".
  migrateToPersistent() folded daily model (dailyLeft+bonus) into one balance + deleted daily
  fields. Verified live: 5 users on persistent balance, top-up works, Rohan reset to 100.
  Subscription/payment still deferred.

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
