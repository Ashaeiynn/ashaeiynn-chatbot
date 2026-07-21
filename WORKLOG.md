# Work journal — the shared memory across all machines

Every Claude session, on ANY machine (MacBook, iMac, VPS), appends a
timestamped summary of significant work here — decisions, changes, and WHY.
At session start, read the most recent day below to know what happened on the
other machines. This file syncs through git automatically (auto-sync hooks),
so it is near-realtime across all systems.

RULES: newest day first · times in IST · substance over chatter ·
NEVER paste secrets, API keys, passwords, or raw chat transcripts here.

---

## 2026-07-21 (MacBook Pro session, with the owner)

- **APP-INTEGRATION.md: documented the exact iOS/Android WebView settings so the app never hits the
  iOS issues we just fixed.** Replaced the mic-only note with "three settings the native container must
  get right": (A) full-screen — iOS pin WKWebView to edges (not safe area) + `contentInsetAdjustment
  Behavior = .never`; Android edge-to-edge + MATCH_PARENT; (B) sound-on-open — iOS `mediaTypesRequiring
  UserActionForPlayback = []` + `allowsInlineMediaPlayback = true` (with the honest caveat that the
  device-voice welcome may still gate → first-touch fallback already built, or native AVSpeechSynthesizer
  via the bridge); (C) mic — iOS `NSMicrophoneUsageDescription` + the iOS-15 media-capture delegate
  `decisionHandler(.grant)`, noting the guide records+server-transcribes on iOS (no reliance on WKWebView-
  absent SpeechRecognition). Plus Flutter/RN equivalents and an iOS quick-checklist. Doc-only, no deploy.

- **iOS fixes: full-screen fill + the spoken welcome now reaches iPhone.**
  (1) BOTTOM UNUSED: the embed/mobile panel set `top/bottom:0` AND `height:100dvh` — over-constrained,
  so `height` wins and `bottom` is ignored; iOS home-screen apps under-report dvh, leaving the bottom
  blank. Fixed by dropping the vh/dvh height and letting `inset:0` (top+bottom+left+right:0, height:auto)
  pin to the real viewport edges. app.html body got `min-height:-webkit-fill-available`. Verified: panel
  offsetHeight === innerHeight (812), fills top:0→bottom, nav pinned to the very bottom. (If it ever
  persists it's the NATIVE WKWebView frame, not the web layer.)
  (2) GREETING VOICE SILENT ON iOS: iOS blocks speechSynthesis until the first touch, and the app
  auto-opens with none — and the mic tap deliberately can't prime speech (priming+recording together is
  what silenced the iPhone mic). New flow (`greetNamaste`): still tries to speak on open (Android/
  already-interacted play it); if a 1.3s probe finds nothing spoke, it ARMS `greetPending`. A
  capture-phase document `pointerdown` then plays the welcome on the seeker's FIRST touch and sets
  `greetSpeaking`; the guide's tap handler early-returns while `greetSpeaking` — so that first tap
  greets and the NEXT tap speaks (the welcome literally invites it: "…what would you like to know?").
  `greetSpeaking` is set ONLY on this first-touch path, so Android taps during the auto-greeting still
  record normally. Verified: full-screen fill; Android-style path (greeting auto-plays, first tap →
  mic requested, not suppressed); iOS first-touch/suppression logic reviewed sound; no console errors.

- **The guide now greets on EVERY open and opens the conversation (not just once, not just the blessing).**
  Owner: "every time a user opens the bot, the bot greets and starts the conversation." Changes in
  `greetNamaste()` (widget.js): (1) fires on every panel open (was once-per-page-load) — the
  `greetedThisLoad` flag became an 8s cooldown `lastGreetAt` that only guards a stutter; (2) BUG caught
  in testing — the cooldown suppressed the FIRST greeting too (lastGreetAt=0 vs performance.now()≈1s
  read as "just greeted"); fixed with `if (lastGreetAt && …)`; (3) the blessing now leads into a warm
  conversation-opener — रotated set (4 per language) so a frequent opener doesn't hear the same line,
  and "welcome back" for returning (cameBack) seekers; (4) app-resume: a visibilitychange handler
  re-greets when the app returns to the foreground after >45s hidden (installed/WebView apps that
  suspend rather than reload). Namaste-hold now scales to the (longer) line length. Verified in-browser:
  Rohan→"जय सिया राम, भाई! कहिए, आज क्या जानना चाहते हैं?"; Priya(EN)→"Jai Siya Ram, behen! I'm right
  here — ask whatever is on your mind."; close+reopen → greetCount 2 with a rotated opener; gender
  learned+stored; still free device voice, still respects 🔇 and notification-tap.

- **The guide now greets on open: hands fold in namaste and he SAYS "जय सिया राम भाई/बहन".**
  Owner's ask. Built: (1) 3D arms reworked to POSEABLE unit-cylinder segments re-aimed per frame
  (`poseArms(k)` lerps elbow/hand joints from lap ध्यान pose to hands-at-heart namaste + 0.15rad bow;
  smoothstepped `namT`, mouth flutters while he speaks); triggered while `now < g3greetUntil`.
  (2) `greetNamaste()` in widget: once per page load, 1.9s after open (post-splash) — adds
  `.vcb-greet` (SVG fallback bows via CSS keyframe) and speaks the line with the FREE device voice
  (browserSpeak — zero TTS quota per open, owner's cost rule; respects the 🔇 toggle; skipped when a
  tapped notification is about to speak). If autoplay is blocked (auto-opened app WebView, no gesture
  yet) a one-shot pointerdown listener replays greeting+namaste on first touch.
  (3) भाई vs बहन NEVER guessed: new `GET /api/gender?name=` — ONE light-model call per unique name
  (in-memory cache, rate-limited, "u" on any doubt/error) returns m/f/u; the device stores it in
  journey.gender forever. Verified: Rohan→m, Priya→f, Kiran(unisex)→u; unknown/unclear speaks "जी".
  Verified in-browser: namaste plays on open and on the blocked-autoplay retry (screenshots: hands
  rising, folded at heart, bowed head), gender learned+stored on device, zero console errors.

- **The guide is now TRUE 3D — a sculpted WebGL figure (owner: "make it real").**
  Owner wanted real depth, full body, not the flat SVG that tilts. Process: built an interactive
  three.js preview first (owner feedback "looks fat" → reshaped slim/young: broad shoulders, narrow
  waist, upright), verified it with a 3-agent workflow (three.js r128 API check came back clean; the
  logic verifier's mobile findings — touch-action pan-y, pointerId tracking, click-vs-drag, dt-based
  particles, ResizeObserver, teardown — all applied), then owner approved. Integration:
  - `widget/three.min.js` — three.js r128 VENDORED (no CDN; self-contained per architecture rule),
    served at `GET /three.min.js` with `Cache-Control: immutable` (server.mjs) — phones fetch it once.
  - Widget: `g3init()` (called on first panel open) lazily loads the engine and builds the scene
    inside the SAME `.vcb-orbbig` tap-to-speak button (`.mg3-wrap` fades in over the SVG;
    `.vcb-panel.mg3-live .mg-3d{display:none}`). The SVG guide REMAINS the instant view and the
    fallback: prefers-reduced-motion, script-load failure, no WebGL, and `webglcontextlost` (listener
    removes the wrap → SVG returns seamlessly).
  - The 3D tick POLLS `panel.dataset.vstate` (no setVState coupling): idle/error=rest (breathing,
    halo pulse), listening=third eye opens + base ripples, thinking=3 planets orbit the head,
    speaking=8 rays from the third eye + mouth + aura pulse + bob. Incense-spark particles always.
  - Drag rotates him in space (clamped, eases back to a slow sway); a drag > 14px of movement
    SWALLOWS the click in capture phase so rotating can never start the mic. Verified in-browser:
    drag → vstate stays idle; clean tap → real microphone request fired; speaking shows rays in 3D;
    zero console errors. Pauses rendering when the panel is hidden (offsetParent check); DPR capped 2.

- **The seeker's name is now an occasional touch, not every reply (owner: felt robotic).**
  The per-question context block used to instruct "address them ONCE using their name" whenever the
  name/भाई/बहन hadn't appeared in the last 2 turns — so the name showed up almost every answer. New
  rhythm (server.mjs): `useName = !nameUsedRecently && (firstReply || Math.random()<0.3)` — the name
  is a rare personal touch (first reply, then ~1 in a few), and the OTHER replies must still carry
  warmth via family address (भाई male / बहन female / जी unclear), never going cold and never as the
  opener. Gender is judged from the name (never call a बहन भाई). Reinforced the same in prompt.mjs
  rule 2. Removed the old `addressedRecently`. Verified live: male "Rohan" → name 1/6, भाई the other
  5/6; female "Priya" → बहन every reply, never भाई. (Earlier the naive "use the name less" had made it
  drop all warmth — the fallback now explicitly insists on भाई/बहन.)

- **Guide stays BIG while its answer shows.** Owner: with the answer coming, the guide shrank
  (has-ans → 126px). Since the conversation is saved in the Chats tab, the stage needn't shrink the
  guide to hold a transcript. Raised the `data-has-ans` figure 126→196px (still a light trim from the
  214px rest size so the answer has room). Verified: even a long answer keeps the guide big and fully
  on-screen — the answer scrolls in its own capped area instead of pushing the guide down.

- **Guide character: bigger, no tap-box, interactive 3D tilt.** Three owner fixes to the new figure
  (`widget/widget.js`): (1) enlarged the `.vcb-orbbig` figure 150→214px (has-ans shrink 92→126px).
  (2) The "blue box" on tap was the button's mobile tap-highlight (now a square because the orb is a
  non-rounded box) — killed with `-webkit-tap-highlight-color:transparent` + `outline:none` +
  `user-select:none`. (3) Interactive 3D: the figure now leans in 3D toward the pointer/finger and
  eases back (pointermove→CSS var `--mgtx/--mgty`→`rotateX/rotateY`, `perspective:660px` on the orb,
  reset on pointerleave/up). GOTCHA: CSS 3D transforms are IGNORED on `<svg>` elements (even 2D) — had
  to wrap the SVG in an HTML `<span class="mg-3d">` and tilt that. Also: `getComputedStyle().transform`
  reads the PRE-transition value right after a change (looks like identity); force reflow + kill the
  transition, or wait > the transition, to verify — cost 20 min chasing a non-bug. Verified: 214px,
  tap-highlight transparent, tilt returns matrix3d. NOTE for later: this is an interactive tilt (feels
  3D), NOT a volumetric 3D model — a true rotatable 3D model needs a .glb asset + a WebGL lib
  (model-viewer/three.js), a separate project if the owner wants photoreal 3D.

- **The voice orb is now a meditating guide character (replaces the mic icon).**
  Owner picked, from 3 animated concepts, the symbolic meditating figure with an opening third eye
  (generic, NOT a likeness of Bhaiya — per the persona rule). Built as hand-drawn SVG + CSS in
  `widget/widget.js`, wired to the EXISTING `data-vstate` (no setVState change): idle=rest (eyes
  closed, breathing, halo + heart glow), listening=third eye opens & glows green + ripples,
  thinking=planets orbit the head + shimmer, speaking=rays from the third eye + aura pulse + mouth +
  bob. Ambient always: incense sparks rising, slow mandala ring, twinkling stars. Implementation
  notes: swapped the `.vcb-mic-big` SVG for the `mg-*` figure inside the same `.vcb-orbbig` button
  (tap-to-talk handler unchanged — verified it still fires the mic flow); appended all character CSS
  at the END of the style string and used `!important` to neutralise the old orb circle/ring/pulse in
  BOTH theme blocks rather than editing them (lower risk); `.mg-svg{pointer-events:none}` so taps
  resolve to the button; reduced-motion + `.lite` (Apple) disable the heavy loops. Idle prompt copy
  changed "mic"→"guide" (hi+en). Verified in-browser: all 4 states animate correctly (third eye
  open on listen, rays on speak), tap fires the voice handler, no console errors.

- **In-bot notice — admin notifications now show INSIDE the guide on open (for app users).**
  Owner: the main app has its own notification system, so the bot doesn't need its own push there —
  instead, an admin notification should appear as a card when the user next opens the bot; they "go
  for it" or dismiss, shown once. Owner's two choices: (1) keep the bot's own phone-push on the WEBSITE
  only, hide it in the app; (2) tapping "go for it" starts a CONVERSATION about the notice. Built:
  - `server/announce.mjs` — stores the single latest notice `{id,title,text,link,at}`, auto-retires
    after ANNOUNCEMENT_DAYS (10). Works WITHOUT push (so it reaches app users where push is off).
  - `GET /api/announcement` (public). Admin `/api/admin/push/send` now ALSO calls `setAnnouncement`
    (immediate) — response gains `inBot:true`; scheduled sends set it when they fire (push.processQueue).
    `POST /api/admin/announcement/clear` + the notice shown in `/api/admin/push` status.
  - Widget: `showAnnouncement()` on open — fetches the notice, shows a gold-edged card (📣 + Open /
    Not now) once per device (`journey.seenAnnounce`). "Open/देखिए" → `converseAbout()` (extracted from
    notifWelcome — same doorstep conversation; opens the link too if set); "Not now/बाद में" dismisses.
    Both mark it seen. In app-embed mode the 🔔 bell + its offer are hidden (`body.vcb-embedded .vcb-bell`,
    `maybeOfferBell()` early-returns on EMBED); on the website they stay.
  - Admin Notify tab: description says it shows in-bot + pings 🔔 phones; new "Showing inside the guide
    now" card with a "Take it down" (clear) button.
  - Verified end-to-end locally: send → `/api/announcement` set (inBot:true even with 0 push subs) →
    /app open shows the card, bell hidden → "Open" starts a warm conversation + marks seen → reload does
    NOT re-show → clear endpoint empties it.

- **App integration — Phase 1 shipped: the live guide embeds in the main app's WebView.**
  Owner wants the guide inside the main app (built on the other Mac, same user id) as a button that
  opens the bot; the bot stays on the VPS; every change/upload here must reach the app's bot too — AND
  (bigger vision) the bot should learn the app's own content and be able to navigate the user to a
  screen in the app. Key framing for the owner: there is ONE bot; the app is a door to it, so
  "the app's bot gets the same updates" is automatic (nothing to sync). Built the embed foundation:
  - `widget/app.html` + server route `GET /app` — a full-screen page (no demo chrome) that loads the
    widget with `data-embed="app"`. `/app` is the WebView target.
  - Widget app-embed mode (`EMBED`, from `data-embed="app"` or `?embed=app`): fills the WebView
    (new `.vcb-embed` CSS, any screen size), auto-opens on load, hides the floating launcher/nudge
    (`body.vcb-embedded`). Reads `?uid=&name=` and ADOPTS them as the seeker's identity
    (`journey.uid/name`) so sign-up is skipped and journey/membership follow the same person across
    app + guide. Ordinary website embeds (WordPress) are unaffected — EMBED defaults false.
  - Verified in a 375×812 WebView: auto-opens full-screen (radius 0), launcher+nudge hidden, identity
    adopted (app_user_777/Rohan), no sign-up wall, a real question answered end-to-end.
  - `APP-INTEGRATION.md` written for the other Mac's Claude — the full contract: WebView + per-platform
    MIC PERMISSION steps (the one real app-side task), the `/app?uid=&name=` URL, Phase 2 app-content
    feed format `[{id,title,route,text,updatedAt}]` (teach it so the bot learns app screens), and
    Phase 3 "take me there" navigation bridge (`window.AshaeiynnApp.navigate(route)` /
    ReactNativeWebView / postMessage — app implements one). Phases 2-3 are specced, wired once the app
    defines its screens/routes. Membership needs the app's uid in the guide registry (documented).
  - Pending follow-ups: auto-register/mark app users in the guide registry by uid (small endpoint, on
    request); wire the Phase-3 button on the guide side when the first app routes exist.

- **Approved answer asked-in-Hindi came back in English — figure guard was reverting the translation.**
  Owner sent a screenshot: "Gupt navaratri ke sadhana ka niyam batao" (Hinglish) → the admin-approved
  answer delivered in full ENGLISH. Root cause in `server/server.mjs` figure-fidelity guard: it compares
  the digit-SET of the generated answer against the approved answer. The approved text has "7:00 PM /
  11:00 PM"; a faithful Hindi translation naturally writes "7 बजे / 11 बजे" and DROPS the ":00" minutes.
  The guard saw the "00" tokens vanish, declared a figure drift, and — since a wrong figure is a serious
  error — threw the Hindi away and shipped Bhaiya's verbatim ENGLISH approved text as the safe fallback.
  Fix: `digitsOf()` now normalises a whole-hour "H:00" → "H" and drops bare-zero tokens BEFORE comparing,
  so want becomes {7,11} instead of {00,7,11}. A faithful Hindi rendering ({7,11}) now passes and is kept;
  a genuine 7→8 change still drifts and is still caught (verified deterministically both ways). Runs only
  on DIRECT correction matches (the block was already gated on `approved.score >= DIRECT_MATCH`).
- **Studio-source hardening.** The same screenshot showed a stale phone app suggesting
  "session11_malin_samay_complete (0:00)" (a studio session). Diagnosed as a phone home-screen app that
  had not reloaded since the widget's "आगे देखिए" rename — the CURRENT code already blocks it (video 79
  has an empty url; `publicUrl` passes only YouTube/ashaeiynn.com). Belt-and-braces: removed the
  contradictory `|vimeo` from the `suggest` allow-list regex so a studio recording can never surface as a
  "watch next", even if `publicUrl` is ever loosened. Owner should fully close & reopen the phone app to
  pick up the latest widget (SW caches nothing, so a reopen is enough).

- **Full-UI language toggle — the language button now switches the WHOLE widget, not just some labels.**
  Owner: "changing the language from hindi to english should change entire UI to english, thats not
  happening currently." Root causes and fixes, all in `widget/widget.js`:
  - The stage/voice-status prompt (idle/listening/thinking/speaking) was set once by `setVState()` and
    never re-rendered on a language change, so it stayed stale in the old language after a toggle.
    Fix: `applyLang()` now re-runs `setVState(panel.dataset.vstate)` (and `renderChats()` when the
    Chats view is open) so live views re-render in the new language.
  - The `जय सिया राम` blessing (the persistent bless strip AND the open-splash) was hard-Devanagari.
    Added a `bless` key to the `T` dict and localised it to `Jai Siya Ram` in English mode; splash
    flips symmetrically (Devanagari headline + Latin sub in Hindi ↔ Latin headline + Devanagari sub in
    English). Guarded by `SPLASH_CUSTOM` — a site that sets its own `data-splash` keeps that exact
    text in both languages.
  - Verified live in-browser (returning English user): every element switches EN↔HI both directions —
    lang button, placeholder, type-instead, send, Guide/Chats nav, chats header, blessing, and the
    stage prompt; English mode now has ZERO stray Devanagari (was: only the blessing remained).

---

## 2026-07-20 (MacBook Pro session, with the owner)

- **"Latest knowledge wins" — shipped as a REVIEW (owner's final choice: flag for review).**
  After the delete approach was proven harmful (see next bullet), the owner chose "flag it for
  your review, you approve the update." Built:
  - `retrieve.bestNewerMatch(vecs, afterMs)` + per-chunk `sourceAt` (transcript mtime).
  - `corrections.supersedeReview()` — report-only, deterministic: flags a correction when a source
    added AFTER it matches the correction's ANSWER at ≥0.90 (near-identical republish), honouring a
    per-pair dismissed set. `updateCorrectionAnswer()` refreshes the answer via addCorrection (keeps
    the question as the retrieval anchor). `dismissSupersede()` remembers "keep".
  - Endpoints GET/POST `/api/admin/supersede`; a new "🔄 Updates" chip in the admin Questions view
    shows each: the correction, its current answer, and the newer source content pre-filled to edit
    → "Update the answer to this" or "Keep current — don''t ask again". Never automatic.
  Verified live: the endpoint surfaces exactly 1 genuine case (Gupt Navratri, 0.902), empty-answer
  → 400, no-key → 401, item stays live for the owner to action. The bot answers it correctly from
  the (restored) correction meanwhile.

- **"Latest knowledge wins" — the delete approach, attempted and REVERTED after a decisive finding.** Owner wants a
  newer file/article to supersede an older correction on the same topic; chose (via AskUserQuestion)
  "newer wins, delete the old correction." Built it carefully — but two findings killed the delete
  mechanism:
  1. LLM can't decide it: asked to judge "is this correction superseded?", the SAME model on the
     SAME input returned 6, 7, and 16 retirements across three runs, the 16 including clearly-wrong
     ones (retiring a negativity remedy because a havan file mentions negativity). Unusable for
     permanent deletion. Fell back to a deterministic near-identical rule (answer-content ≥0.90),
     which consistently flagged exactly 1 genuine republish (Gupt Navratri guidelines).
  2. ⚠️ THE DEEPER PROBLEM — deleting even that one made the answer WORSE. A correction exists
     because the QUESTION doesn't retrieve the right content well; the correction is the retrieval
     GUARANTEE. Matching the correction's ANSWER to a newer source (0.90) does NOT mean the QUESTION
     finds that source — measured: after retiring Gupt Navratri, its own newer guidelines source was
     not even in the top 8 for the question, so the bot gave a generic fallback.
  DELETING A CORRECTION CANNOT SAFELY ACHIEVE "LATEST WINS." Restored the correction from git,
  disabled the auto-delete wiring (teach.mjs), kept the supersede detector report-only. The RIGHT
  fix is to UPDATE the correction's answer to the newer content (keeping the correction as the
  retrieval anchor) — proposed to the owner, awaiting confirmation. New building blocks kept for it:
  retrieve.bestNewerMatch + chunk sourceAt dates, corrections.supersedeByNewer (report-only),
  llm.complete `strong` option.

- **Complete knowledge-base audit** (owner asked to confirm all files + corrections are in).
  RESULT: fully prepared. Every uploaded file produces searchable chunks (0 missing), /health
  self-check green, all 33 approved corrections verified firing (tested a spread live). Note:
  many corrections are sadhana/havan RULES — they correctly fire for MEMBERS and are withheld
  from non-members by the members-only gate (a non-member test looked like "no match" until
  re-run as a member, where all fired CORRECTED). 0 pending suggestions.
  FOUND & FIXED: two exact-content duplicate uploads — session10_hawan_parikrama (same title,
  uploaded twice → chunks doubled to 98) and "Kul Devta" ≡ "Kul Part 2 Mool tattva" (identical
  content, two names). Both confirmed byte-identical, redundant copies removed, rebuilt:
  1536→1473 chunks, 122→121 sources, session10 back to 49 chunks. Committed on VPS.
  NOTED (not changed): 11 of 33 corrections have 0 generated alt-wordings (older ones) — they
  still fire on their own question but are less robust across script/language than the 22 with
  4 alts; re-approving them through the Suggestions flow would regenerate the alts if wanted.
  Left the two "chat" meeting-log duplicates alone (already excluded from search, harmless).

- **Voice: long pause after every sentence** (owner: should be a very short pause, just a
  new-sentence feel). Cause: browserSpeak spoke EACH sentence as its own SpeechSynthesisUtterance
  with a 150ms breath — and a separate utterance also carries the device speech-engine's restart
  latency, so the real gap was ~150ms + engine latency after every full stop. Fix: GROUP sentences
  into ~160-char utterances (a lone >200-char sentence splits on a comma so it still can't hit
  Chrome's ~15s single-utterance cut), and drop the breath 150→30ms. Now the engine flows through
  several sentences in one breath and its OWN natural short pause at each "।" gives the new-sentence
  feel — a 5-sentence / 123-char answer went from 5 utterances to 1. Server-voice (Gemini) chunk
  path untouched. AUDIBLE result needs the owner's ear (no audio in the test browser); grouping
  verified in node. If it now runs together with NO pause, the engine is under-pausing at the danda
  and the next step is 2-sentence chunks with a ~50ms gap.

- **Daily allowance changed 50 → 25** (owner). The model was already exactly what was asked —
  the daily part resets each morning to the limit (whatever was left does NOT carry), and an
  admin-granted bonus sits on top and carries forward until used. So the only real change was
  the number: `DAILY_LIMIT` 50→25 in users.mjs (+ the hardcoded fallbacks for consistency).
  Also made the credits answer HONEST about the split — with a bonus present it was saying
  "nothing carries over," which is false for the bonus. New `balance(id)` returns
  {dailyLeft, bonus, left, limit}; the quota answer now says e.g. "43 right now — 24 of today's
  and 19 extra from the team; the daily 25 refill at midnight, your 19 extra stay until used."
  A fresh user with no bonus gets the plain "25 a day, resets each night." Both verified live.

- **Chats tab — the seeker's own 24h conversation, on their phone, with a new bottom menu**
  (owner: "Save the chats of each user for 24 hours which will show to the user as Chats… a menu
  option at the bottom… be creative"). KEY FINDING before building: two of the three things the
  owner described ALREADY existed — the bot already gets conversation context (last 12 turns +
  distilled summary + comm-style + recent topics), per-user learning already saves to the DEVICE
  (`/api/distill` → journey.summary + journey.commStyle every 5 questions), and general learning
  already saves to the VPS (chatbot-reflect.timer nightly → style-notes.json, both verified active).
  So the genuinely new work was the VISIBLE history + the menu:
  - `journey.chatlog` = [{r:'u'|'b', t, at}] on device, pruned to 24h, capped 300; `logChat()`
    hooked at the exact turn-complete point (and the return-visit check-in). Never sent to a
    server — honors the privacy design (journey lives only on the device).
  - A bottom menu (Guide / Chats) added below the form — slim, gold-underline active tab, in the
    app's dark/gold/green palette. `data-view` toggles the guide stage ↔ the Chats screen; the
    voice stage and जय सिया राम strip are untouched.
  - Chats screen: gold user bubbles / green bot bubbles, time headers grouped by >30-min gaps
    ("आज · 1:19"), tap a past question to re-ask it, a "मिटाएँ" clear (confirm-gated), and an
    empty state with a "पूछना शुरू करें" button. Verified live: renders, switches back to the
    intact voice stage, empty state, zero console errors.
  DID NOT feed the full 24h log to the bot — the recent turns + the distilled summary already
  capture "what the conversation was going on"; sending 24h of raw turns would bloat every call.


- **Removed the dead media/video-link code** (owner: "if these are not required, remove these").
  Since audio/video teaching was withdrawn 2026-07-18, three things were unreachable: the `media`
  and `"video-link"` job RUNNERS in teach.mjs (the latter called yt-dlp, absent on the VPS), the
  `/api/admin/studio-status` endpoint + its 30s heartbeat (STUDIO_SYNC_URL is set on no machine),
  and the `alreadyStudied` helper. All gone; the four live handlers (document/note/forget/article)
  and the media/video-link REFUSAL messages stay. Verified: .txt upload still 200, studio-status
  now 404, restart clean. pipeline/6-audio.mjs kept for command-line use.

- **Sources no longer listed under answers — at most ONE relevant article instead** (owner:
  "No need to show the sources to the users. Only if an article is to be suggested based on the
  question, suggest the article which opens on the website, or else don't show sources").
  server.mjs: replaced the up-to-3 public-source list with a single suggestion — the highest-ranked
  `Article:` chunk (an individual ashaeiynn.com Pathshala page, NOT a "Website:" landing page or the
  About doc), above `ARTICLE_SUGGEST_MIN` (0.84, env-overridable), and not one the seeker has already
  read. Its URL is the article page itself (no `#t=` video fragment). Nothing shown if no article
  clears the bar. PRESERVED: explicit link requests still return the asked link; personal handoffs
  still return Book-a-screening/Contact (those are the human door, not citations). Verified live:
  on-topic → 1 clean article URL; off-topic → 0; link request → channel link; handoff → screening.
  The video "आगे देखिए" watch-next is now permanently dormant (0 youtube/vimeo urls in the library),
  so only articles can surface — matches the intent exactly.

## 2026-07-18 (MacBook Pro session, with the owner)

- **Ambiguous साधना questions now ask WHICH one** (owner: "in ashaeiynn we do many
  sadhanas — the bot should ask which sadhana the user is talking about"). New rule 7c
  in prompt.mjs: when a question asks about नियम / timings / food / instructions without
  naming the साधना, do NOT guess and do NOT blend — reply in one short warm line asking
  which, and put the choices in the सुझाव line so the seeker just taps one. Verified live.

- **⚠️ THE KNOWLEDGE BASE WAS SILENTLY HALF-BUILT — and nothing said so.** Chasing why
  session8_aghor_panth showed "learnt" in the Library but "failed" in Teach, found the live bot
  running on 288 chunks / 42 sources when there were 112 transcripts on disk (it had been
  1146/111). An interrupted study leaves knowledge.db PARTIAL; the bot just answers from less of
  Bhaiya's teaching and says nothing. My own `systemctl restart` during studies caused it.
  Rebuilt to 1176 chunks / 112 sources; session8 now answers.
  THREE GUARDS ADDED:
  1. STARTUP AUDIT — compares transcripts on disk against what is actually searchable and logs
     "⚠️ KNOWLEDGE INCOMPLETE — N source(s) on disk but NOT searchable … Run: node
     pipeline/3-ingest.mjs". Also surfaced in /health as `knowledge:{ok,learnt,onDisk,missing}`
     so it is visible without SSH. PROVEN by deliberately deleting 6 sources: the alarm fired
     with the exact names, then the base was restored.
  2. LIBRARY TRUTH — the Library lists FILES, so a failed study still looked learnt. Each card
     now checks the bot's real memory and warns "uploaded, but NOT in the bot's memory".
     Deliberately excluded legal pages are NOT flagged (isExcludedTitle).
  3. A failed banner can be dismissed (POST /api/admin/jobs/clear) instead of living forever.
  ⚠️ OPERATIONAL RULE FOR EVERY FUTURE SESSION: never `systemctl restart chatbot` while a study
  is running. Check first: `ps -eo args | grep "[p]ipeline/3-ingest"` — note the BRACKET, a
  plain grep matches its own command line and lies (that bug wasted an hour tonight).

- **Tap feedback: buzz on Android, tick on iPhone, and light for everyone.**
  Android gets `navigator.vibrate(18)`. Apple supports NO vibration on the web at all, so
  iPhone gets a short synthesised tone instead (one shared AudioContext for the visit — making
  one per tap would churn iOS's audio session, which is what silenced the mic earlier today).
  ⚠️ BUT iOS also honours the physical ring/silent switch for web audio and a page cannot
  override it, so a phone on silent stays silent whatever we do. Hence the real answer, at the
  owner's steer: a VISUAL bloom at the touch point, in the tapped control's own colour.
  It makes no sound and touches no audio session, so it fires on EVERY tap INCLUDING the one
  that opens the microphone — the tap that until now had no feedback at all.
  ⚠️ First version rendered rgba(0,0,0) — several buttons carry no text colour and compute to
  black, i.e. invisible light on a dark panel. Now: use the control's colour only if it is
  actually bright, else green for chips and gold for everything else. Verified per control.

- **Denial now clears the stored practice BY ITSELF** (owner asked: won't her phone do this
  automatically?). It would not have: the memory only cleared if the denial was the CURRENT
  message, and Soni's denial predated the fix — she would have had to repeat herself. But her
  recent questions and turns travel with every request, so the check now looks at those too:
  the next thing she asks clears it, whatever she asks.
  ⚠️ FIRST VERSION FALSE-CLEARED. "negation + practice word" fired on "आज साधना में मन नहीं लगा"
  — a seeker confiding a hard day inside their practice — and forgot the practice they ARE
  doing. That is the opposite of listening. Narrowed to `NOT_DOING`: the negation must sit
  beside a doing verb ("साधना नहीं कर रहा", "कोई साधना नहीं"), or they say they stopped
  ("छोड़ दी", "बंद कर दिया", "stopped my sadhna"). 14 cases tested both directions.
  A fresh declaration in the same turn still wins over an older denial.

- **The guide kept insisting a member was doing a साधना she had denied.** Soni told it
  "मैं कोई गुरुतत्व साधना नहीं कर रहा हूँ अभी।" and later answers still opened
  "सोनिया बहन, आपकी गुरु तत्व साधना के मार्ग पर…". The negative-reply handling DID fire — but it
  only shaped that one reply. The cause is separate: a declared practice is remembered on the
  seeker's device (`profile.sadhana`) and injected into every later prompt as "their ongoing
  practice". Nothing ever cleared it. The mechanism existed (`sadhana: "-"` tells the app to
  forget) but only the model could trigger it, and it never did.
  FIX, in code: `deniesPractice` = a negation plus a practice word (साधना/जाप/abhyas/sadhna/
  practice). When it fires, the remembered practice is (a) left OUT of this answer's prompt and
  (b) the reply carries `sadhana: "-"` so the app forgets it for good. Rule 14 also extended:
  "-" on denial, and never refer to it as theirs again.
  Verified end to end with her exact words: reply carries "-", and the following question no
  longer calls it her साधना.
  LESSON: acknowledging something for one turn is not the same as remembering it. Anything the
  seeker states about THEMSELVES has to reach the stored profile, not just the current reply.

- **Admin progress panel was lying, and deletions looked like studying.** Four fixes:
  1. The live admin was polling `/api/admin/studio-status` — the studio Mac's relayed progress —
     while teaching happens ON THIS SERVER. An upload made here showed no progress at all and
     the panel announced "studio Mac hasn't reported yet". The relay is REMOVED; it reads its
     own queue, polls every 2s. (Media teaching was withdrawn today, so the Mac teaches nothing.)
  2. Phases are named with percentages: Uploading X% → Reading n of N / Learning X% → Finished 100%.
     Hands over to "now learning" the moment the bytes land instead of waiting for a poll.
  3. A REMOVAL runs through the same queue and was labelled "reading"/"studying". Own labels now:
     removing / unlearning / removed & forgotten.
  4. Deleting only QUEUES the removal, so reloading the Library brought the row straight back and
     looked like a failed delete. The row now greys out with "removing — the bot is unlearning
     this now…", and the list refreshes once the queue drains. The finished banner also clears
     itself after 9s instead of sitting there for good.

- **"Pitru, Pitr, Pitar are all the same"** (owner). Measured: the library writes **pitra** (212
  occurrences) and contains ZERO Devanagari पितृ — so a spoken "पितृ दोष" transliterated to
  "pitri" and matched nothing at all. Added `normalizeSpelling()` in translit.mjs: a table of
  spelling variants → the spelling the KNOWLEDGE uses, applied to the search text only (nothing
  on screen or in storage changes). Covers pitru/pitr/pitar/pitri/पितृ → pitra, plus kul devta →
  kuldevta, gurudev, sadhna, jaap, mantra, shakti.
  TO ADD A WORD: one line in SPELLINGS. This is the place for any future "these are the same word".

- **Duplicate knowledge: measured, capped, and reported.** Owner asked what happens if the same
  teaching is uploaded twice. MEASURED on their own two PDFs (one prose, one Q&A of the same
  session): the duplicate took **6 of the 12** excerpts the model receives — the per-source cap
  of 3 is keyed on TITLE, so one teaching under two names got 3 slots each. Contradiction is the
  worse risk (two versions disagreeing on a figure) but theirs agree.
  TWO CHANGES:
  1. retrieve.mjs now also suppresses a chunk that is near-identical to one already chosen
     ACROSS sources. ⚠️ FIRST ATTEMPT WAS WRONG and degraded live answers: applied within a
     source too, it stripped the main teaching from 6 chunks to 1 (chunks of one document
     overlap ~200 chars BY DESIGN), and the reply visibly lost its specifics. Restricted to
     cross-source: now 3 of 12 for the teaching, 9 freed, specifics back.
  2. `duplicateSources()` reports sources that teach the same thing; the Library shows a warning
     line on the card. ⚠️ ALSO MISCALIBRATED FIRST: "share of chunks above 0.90" flagged 45
     pairs, mostly merely-related articles. What separates them is the MEAN best match —
     same document twice 0.957-0.975, related-but-distinct 0.929-0.941 (the template hawan
     pages sit at 0.939). Threshold 0.95 → 45 false flags down to 10 real ones, including a
     genuine duplicate nobody had noticed: the "How Mantra Chanting Reduces Planetary Effects"
     docx is 98% the same as the Pathshala article of the same teaching.
  Nothing is ever deleted automatically — two versions are sometimes deliberate.

- **Every teaching now reachable in Hindi, Hinglish AND English** (owner: "make sure each
  knowledge no matter if in hinglish, also reach english and hindi user in the language they
  asked"). Chose the QUERY side over the knowledge side: instead of translating 937 chunks
  (LLM cost, a re-ingest, and it would have to be redone for every future upload), each question
  is now searched in THREE forms — as asked, the AI translation, and a rule-based SCRIPT FLIP.
  new server/translit.mjs — Devanagari→Latin, free, no AI call. It is not scholarly; it aims at
  the spellings people type. Two things it must get right, both learned the hard way:
    · SCHWA DELETION — जाप is "jaap" not "jaapa", करना is "karna" not "karana". Without it the
      output matches nothing a human would write.
    · Only the INHERENT vowel may be dropped, never a written matra. The first version deleted
      both and turned जाप into "jp" and साधना into "sadhn". The inherent one is now marked with
      a private character during conversion and resolved at the end.
  Result: "मेरी शक्तियाँ काम करना बंद क्यों हो गईं?" → "meri shaktiyan kam karna band kyon ho gain?"
  MEASURED on the Hinglish PDFs: Devanagari question 0/3 → 3/3 chunks in the top 3; Hinglish
  3/3; English 0 → 4 chunks inside the 12 excerpts the model receives (English ARTICLES still
  outrank it there, which is reasonable — that is also Bhaiya's teaching).
  This needs no re-ingest and covers every source already in the library and every future upload.

- ⚠️ **OUTAGE I CAUSED (~21:45-21:55 IST, real questions returned 502).** Shipping the above, I
  imported a helper as `isDevanagari` — a name ALREADY used inside handleChat for a BOOLEAN
  (line 495). The local shadowed my import, so `isDevanagari(message)` threw "not a function"
  and the server crash-looped. `node --check` passes this happily; it is a runtime shadowing
  bug, not a syntax one. GREETINGS still worked (they short-circuit before the search), which is
  why my first probe returned 200 and I believed it was fixed — the outage was invisible to the
  check I chose. Fixed by using the existing boolean instead of importing my own.
  LESSONS: (1) grep for the identifier BEFORE introducing one in a 2000-line file; (2) after
  deploying a change to the answer path, probe a REAL QUESTION, never a greeting — greetings
  skip most of the pipeline and prove almost nothing.

- **iPhone spoke "गुरु" as "गुरुवार"** (Thursday). Apple's Hindi voice expands a standalone
  गुरु; Android does not. Fixed with a device-voice-only respelling to the long ū ("गुरू"),
  applied in browserSpeak behind the `isApple` check — the text on screen, the text sent to the
  server voice, and questions.log are all untouched. Word boundaries tested: गुरुदेव, गुरुकुल
  and गुरुवार itself are left alone; only a standalone गुरु is respelled.
  `APPLE_SPEECH_FIXES` is a LIST — add a pair to it for any future word the iPhone voice
  mangles, rather than inventing a new mechanism.
  UNVERIFIED FROM HERE: no iPhone available; the respelling is a well-founded guess at what
  breaks Apple's expansion, and the owner needs to confirm by ear.

- **"ठीक है?" had become a tic** (owner: it is irritating). TWO rules were pushing it: the
  persona line said use it "once or twice per answer", and rule 12 offered an "understanding
  check" as a way to end answers — so nearly every reply closed with it. Persona line rewritten
  (at most one answer in four or five, only after a genuinely difficult instruction, never as a
  closing formula, never twice running); rule 12's check form marked as the rarest. Plus a code
  guard, since wording alone has failed repeatedly today: if either of the last two answers used
  it, a TRAILING "ठीक है?" is stripped — so it can still appear, but never twice in a row.
  Measured over a 5-turn conversation: 0 of 5, twice.
  BUG FOUND WHILE TESTING: an answer ended "वाथी: जाप की प्रक्रिया में…" — the model MISSPELLED
  the internal marker "वापसी:", so no named pattern caught it and the label was shown (and read
  aloud) to the seeker. Added a final seatbelt: any last line that is a short Devanagari label
  followed by a colon is one of ours and is stripped. Real answers are flowing speech and never
  end in a labelled line; verified it leaves normal answers untouched.

- **iOS: mic dead, and typing laggy — Android fine. Both traced.**
  1. ⚠️ I CAUSED THE MIC FAILURE EARLIER THE SAME DAY. `primeVoice()` (the silent utterance that
     unlocks iOS speech) was wired to the mic tap — and speaking, even silently, flips iOS's
     audio session to playback. The very next line of that handler starts the microphone, so the
     mic could not open. Android is unaffected because it has no such gate.
     FIX: never prime on the tap that records. Priming now happens on the launcher tap, on
     "type instead", on Send, and — the important one — right AFTER recording stops, since the
     home-screen app auto-opens the panel and its launcher tap never happens at all, so a
     voice-only seeker would otherwise never prime.
  2. LAG: every message bubble carried `backdrop-filter: blur(3px)`, sitting over a continuously
     animated background (blurred nebulae on transform, a 780s rotating galaxy, drifting
     starfields, 16 twinkles). iOS re-blurs each bubble on every repaint, so the whole
     conversation was being re-composited while typing. Removed the per-bubble backdrop blur
     for everyone (invisible difference, large win) and added a `.lite` class on Apple devices
     that stops the nebula/galaxy/starfield animations and cuts the stars from 16 to 6.
  NOT VERIFIABLE FROM HERE — needs the owner's iPhone. Deployed and code-verified only.

- **Sources under an answer are now pills, and the Source line is gone from the screen.**
  Owner: the article suggestions take huge space. They were video CARDS — each with an 82×50
  thumbnail box that, with the recordings deleted, held nothing but a 📖 emoji. Three of those
  ate most of a phone screen. Now: a wrapping row of small pills, gold = something to READ,
  green = something to ASK (matching the सुझाव chips), 82px instead of ~200px. Titles are
  stripped of their furniture ("Article: ", "— Ashaeiynn Official", "| Asha Pathshala") and
  ellipsised, with the full title kept on hover/long-press. Deleted 1,381 chars of now-dead
  card CSS that every seeker was downloading.
  While looking at it on a phone viewport, found a bigger waste: the answer ALSO printed
  "Source: Article: … (0:00)" as four lines of text, directly above pills saying the same thing.
  That line is now always stripped from the seeker's screen. It is still written to
  questions.log (so knowledge-gap review is untouched) and its PRESENCE still drives the
  deterministic no-source rules — only its display is gone.

- **Admin: conversation is no longer mistaken for a knowledge gap, and studying shows progress.**
  Owner saw "no source — knowledge gap?" on turns like "नहीं अभी के लिए इतना ही जय सियाराम" and
  "मैं साधना कर ही नहीं रहा हूं अभी". `isUnanswered` flagged anything without a Source line — but
  conversational turns never have one BY DESIGN. Now `isChat(e)` (chat|ack|negReply|unclear)
  excludes them from the gap count AND from the questions list, with their own 💬 Conversation
  chip so nothing is hidden. Verified live: All tab 300 cards / 16 real gaps, Conversation tab
  3 cards / 0 gap badges — exactly the turns from the owner's screenshot. (Only turns logged
  since today's flags carry them; older ones age out of view.)
  Progress bar: `showStatus()` already accepted a `pct` but `statusFromJobs` never passed one.
  Now determinate per item (done/total) during processing, and during the ~7-minute rebuild an
  elapsed-time estimate capped at 95% with an honest "about N of ~7 minutes" label — the
  rebuild reports no progress of its own, so it is labelled as an estimate rather than faked.

- **First two PDFs taught — extraction was badly broken, and they are unreachable in Hindi.**
  Owner uploaded bhaiya_gyaan_qa_pairs.pdf and bhaiya_gyaan_knowledge_base.pdf.
  1. EXTRACTION WAS MANGLING WORDS. pypdf's default mode sprays spaces inside words —
     "Bhaiya k e discourse", "T one: war m", "gr eeting style", "users k o guide k arne".
     Measured 30% of words came out as 1-2 letter fragments. `extraction_mode="layout"` fixes
     it (18%, which is just the natural rate of short Hinglish words). New pipeline/pdf-text.py
     also strips running headers/footers/page numbers, rejoins hyphen-split words, and explains
     itself when a PDF is a scan. Both PDFs were re-extracted and re-ingested: 26-31% broken →
     16-19%, segments 9→72 and 5→33, 937 chunks total from 104 sources.
  2. ⚠️ THE REAL PROBLEM — the documents are written in HINGLISH (0% Devanagari), and this
     embedding model matches script as much as meaning. Measured on the live bot:
       Hinglish question  → top 3 chunks ALL from the PDF (0.859/0.857/0.856) — excellent
       Devanagari question → PDF nowhere in the top 3 (articles won)
       English question    → PDF not even in the top 40
     Since voice input produces Devanagari, most seekers will never reach this material.
     Told the owner: supply the teachings in Devanagari (or let a Devanagari version be stored
     alongside each chunk — the same trick that fixed corrections). Awaiting their choice.
  NOTE FOR FUTURE TESTING: `sources[]` in the API response is filtered by the public-link
  policy, so uploaded documents NEVER appear there even when they were used. Judging "did the
  bot use the PDF" by sources[] is wrong — read `top` in data/questions.log instead.

- **Saying "no" to the guide's own question triggered a lecture.** The bot asked "साधना कैसी
  चल रही है?", the seeker answered "मैं साधना नहीं कर रहा हूँ अभी", and it replied with a
  teaching about साधना — the one thing they had just said they were NOT doing. Fixed in code:
  `isNegativeReply` = message contains a negation, contains NO interrogative and no "?", is ≤12
  words, and there is a previous assistant turn to be answering. The injected note splits two
  cases — (a) "I'm not doing that": accept warmly in one line, no persuasion, ask what they
  WOULD like; (b) "समझ नहीं आया": say the same thing again in simpler words, never re-teach a
  new topic. Verified live: 47 words, 0 sources, "कोई बात नहीं, साधना की जल्दी क्या है…"; the
  re-explain branch stayed on सिद्धि with a homely example; and "साधना क्यों नहीं हो पा रही है?"
  (a real question that contains a negation) still gets its full 107-word answer with sources.
  ⚠️ TRAP WORTH REMEMBERING: `\b` in JavaScript is ASCII-only, so `/\b(नहीं)\b/` matches
  NOTHING in Devanagari. The first version silently detected zero Hindi negations and the unit
  test caught it. Also "ना" needs its own boundaries or it fires inside साध-ना.

- **Microphone icon is now green** (owner's request) — the mic glyph gradient and its faint
  inner fill only; the orb, its ring and every other colour left exactly as they were.

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
