# Ashaeiynn Voice Chatbot — project brief

Voice-first chatbot for Ashaeiynn (third-eye activation centre, Hisar — ashaeiynn.com).
Applicants SPEAK questions (Hindi/English) and HEAR grounded answers from Bhaiya's teachings.
Owner (Parikshit) is non-technical: explain simply, do the work for him, verify before claiming done.

## Read before big changes
- `README.md` — commands, architecture, costs
- `APP-INTEGRATION.md` — how the main app embeds the live guide (WebView at `GET /app`, `?uid=&name=`
  identity, mic-permission steps, and the Phase 2 app-content-feed + Phase 3 navigation-bridge contract)
- `API-INTEGRATION.md` — older API-only contract (POST /api/chat) for a native chat UI
- `DEPLOY.md` — Render/Docker go-live steps · `LAPTOP-SETUP.md` — new-machine setup

## Work journal (cross-machine chat memory)
`WORKLOG.md` is the shared memory of all Claude sessions across all machines.
- Session start: read its newest day to know what other machines did.
- During/at end of a session: append a timestamped (IST) summary of significant
  work under today's date (newest day first) — decisions and WHY, not chatter.
- NEVER put secrets, keys, passwords, or raw transcripts in it. It syncs via git.
Seekers' bot chats live ONLY on the VPS (data/questions.log, gitignored for
privacy — never push user chats to GitHub). Any machine can mirror them locally
with `bash scripts/pull-chats.sh` (merges live log into local, time-sorted);
the live admin at guide.ashaeiynn.com/admin is the realtime view from anywhere.

## Sync protocol (multiple computers share this repo via GitHub)
Hooks in `.claude/settings.json` run `scripts/auto-sync.sh`: pull on session start,
auto commit+push after every turn. Offline failures are silent (sync catches up later).
YOUR part as Claude, on any machine:
- Session start: if the hooks didn't run (not yet approved / settings not loaded),
  run `bash scripts/auto-sync.sh start` yourself before touching any file.
- If you ever see an AUTO-SYNC CONFLICT message (from a hook or the script): resolving
  it is your top priority — `git pull --rebase`, merge conflicted files keeping both
  sides' work (regenerate or take the newer side for package-lock.json / knowledge.db),
  `git rebase --continue`, `git push`. Don't ask permission; just fix and report.
- Never disable these hooks or leave the repo unpushed at the end of a task.

## Architecture (all local Node 22+, no external services except Anthropic API)
- `server/server.mjs` — HTTP server (port 3111): `POST /api/chat` (rate-limited, logs to
  `data/questions.log`), `POST /api/tts` (ElevenLabs if key set, else 501 → widget falls back
  to browser voice), `GET /health`. Detects question language server-side and pins reply
  language (English / Hinglish→Hindi / Devanagari→Hindi).
- Retrieval: `server/embed.mjs` (multilingual-e5-small via transformers.js, local) +
  `server/retrieve.mjs` (in-memory cosine over `data/knowledge.db`; per-video cap 3;
  brand questions — ashaeiynn/bhaiya/parikshit/gurudev/pathshala/aqua — always include the
  curated About doc). Bilingual query expansion: each question is also translated
  (by the active provider) and both texts searched.
- `server/prompt.mjs` — persona: warm elder-brother guide; speaks OF Bhaiya (Parikshit
  Bhaiya, founder) with reverence, never AS him; voice-style prose, no markdown; answers
  only from excerpts; translated fallback; Source line (stripped from speech).
- `widget/widget.js` — voice-first UI: third-eye orb launcher + golden "Ask Your Guide"
  nudge; जय सिया राम splash → docks to blessing strip; animated solar system background;
  the tap-to-speak button holds a TRUE-3D meditating guide (three.js r128 vendored at
  widget/three.min.js, served /three.min.js immutable; lazy-loaded on open; SVG figure
  is the instant view + fallback for reduced-motion/no-WebGL/context-lost; 3D reads
  panel.dataset.vstate each frame; drag rotates him, >14px drag swallows the mic click);
  tap-to-speak stage (SpeechRecognition hi-IN/en-IN toggle), answers spoken (server TTS →
  browser fallback); "⌨️ type instead" fallback. Served no-cache. Personal guide:
  the seeker's journey lives ONLY in their device's localStorage ("ashaiJourney" —
  asked/seen/convo); each question sends a profile context card (topics+seen) that the
  server uses once (prompt note + unseen `suggest` in response) and never stores.
  Welcome-back greeting after 3h+; conversation survives app restarts.
- Answering AI is switchable via `server/llm.mjs`: `CHAT_PROVIDER` in `.env` — `"gemini"`
  (`GEMINI_API_KEY` + `GEMINI_MODEL`, currently `gemini-3.5-flash`, free tier; owner switched
  2026-07-13 to save cost) or `"anthropic"` (`CHAT_MODEL=claude-haiku-4-5`, prepaid $5).
  Note: Gemini reports a bad key as HTTP 400; `gemini-2.5-flash` is retired for new accounts.

## Admin portal (`/admin`, password = ADMIN_KEY in .env)
- Questions tab: every Q&A from `data/questions.log` (answers now logged too) with stats,
  filters, search, knowledge-gap flags (answer without a Source line).
- Teach tab: upload audio/video (→ pipeline/6-audio.mjs transcription), PDF (pypdf) /
  docx/rtf/html (textutil) / txt-md, add YouTube/Vimeo/article links, or paste text.
  `server/teach.mjs` queues jobs, batches ONE `npm run ingest` per batch (~7 min — full
  re-embed), then hot-reloads retrieval via `reload()` in retrieve.mjs — no restart.
  Uploads land in `data/uploads/` (gitignored). Transcription/textutil are Mac-only.

## Knowledge pipeline (resumable; re-run safe)
`data/inventory.json` = master video list. `npm run process` (download yt-dlp → ffmpeg →
mlx_whisper large-v3-turbo hi) → `data/transcripts/*.json` → `npm run ingest` → knowledge.db.
- `npm run articles` — pulls ALL Pathshala articles (WP REST API; new article every Sunday)
- `node pipeline/5-pages.mjs` — website pages (allowlisted IDs inside)
- `node pipeline/6-audio.mjs "<file>" "<title>"` — any local audio/video file
- Curated identity doc: `data/transcripts/about-ashaeiynn.json` (About + Who is Bhaiya, EN+HI)
- After ANY knowledge change: `npm run ingest`, then restart the server.

## Testing
- `npm run test:retrieval` — search quality, free
- `npm run test:answers` — 22-question answer suite (needs server running; self-paced
  ~9s/question ≈ 7 min). Passing bar 22/22. Contract (updated 2026-07-17): the model
  still ends grounded answers with a `Source:` line (kept in questions.log for gap
  review), but the RESPONSE only shows it when it names a public source — owner's
  link policy: seekers only ever see YouTube-channel + ashaeiynn.com links/sources;
  studio material (Vimeo/Zoom/audio) appears nowhere on screen. So a grounded
  studio-sourced response has NO visible Source line and empty sources[] — the suite
  may need this in mind before judging pass/fail. Off-topic: canonical fallback or a
  short in-character refusal, no sources. The server strips sources/chips off any
  sourceless answer deterministically.
- ⚠️ QUOTA: local testing and the LIVE bot share ONE Gemini free-tier key — heavy
  test runs throttle real members ("chatbot is very busy"). Test in off-hours, pace
  calls ≥9s apart, and never loop the suite back-to-back.
- Mac quirks: PATH needs `~/.local/node/bin`, `~/.local/bin`, `~/Library/Python/3.9/bin`
  (no Homebrew, no profile edits). Kill stale servers: `lsof -ti :3111 | xargs kill -9`.
  The owner's second Mac is Intel (x86_64): `onnxruntime-node` is pinned to 1.23.0 in
  package.json `overrides` (1.24+ ships Apple-Silicon-only macOS binaries) — never remove.
  Hidden browser tabs freeze CSS animations and SpeechRecognition — verify via
  `getAnimations()` clock jumps; real voice tests need the owner's own browser.

## State (2026-07-16)
Knowledge: 577 sources / 8,112 chunks in data/knowledge.db (91 original Vimeo/YouTube
videos ~64h + articles + site pages + everything taught via the admin portal through
2026-07-16). 3 Vimeo videos remain password-locked (skipped).
Suite 22/22. Anthropic key funded (~$5, hard cap). ElevenLabs key NOT yet added.
Done: GitHub repo (Ashaeiynn/ashaeiynn-chatbot, private) + both Macs cloned & auto-syncing.
Live: https://guide.ashaeiynn.com — owner's Hostinger VPS (root@200.97.172.186,
Ubuntu 24.04, shared with the OMS: chatbot in /opt/chatbot, own Node 24, own
chatbot.service, Caddy site /etc/caddy/sites/chatbot.caddy; OMS untouched).
chatbot-update.timer syncs from GitHub every 5 min via scripts/auto-sync.sh
(deploy key currently read-only — teach-on-server can't push back yet).
VPS disk is permanent: questions.log/corrections survive restarts, no LOG_DIR
needed. Render retired 2026-07-16 (keep-alive Action removed; owner deletes the
service in the Render dashboard). Teach-on-VPS: docx via python3 zip-extract,
PDF via pypdf, txt/md/html/links/text natively; .doc/.rtf and audio/video stay
Mac-only (textutil / mlx_whisper).
Owner's real .env is installed on the VPS and this MacBook (2026-07-16): fully
live — Gemini answers + natural voice working end-to-end on guide.ashaeiynn.com.
Failover (2026-07-17): ANTHROPIC_API_KEY (fresh "chatbot-backup" key) added to
.env on VPS+MacBook — any Gemini failure silently retries on claude-haiku-4-5
(llm.mjs); /health shows backup.lastUsed/answers. Balance ~$0.80 — owner may
top up at console.anthropic.com. iMac .env lacks the backup key (fine — iMac
is studio only).
The ear — Groq is now the SOLE speech-to-text for EVERY device (owner, 2026-07-22;
was iOS-only since 2026-07-17). Every device that can record (widget `useRecorder()`
= `canRecord`) records a short clip → POST /api/stt → Groq whisper-large-v3 → turbo
(GROQ_API_KEY in .env, MacBook+VPS). This ended the "one phone hears well, another
doesn't" split (iOS used Groq, Android/Safari used their weaker on-device recognizer).
The Gemini STT fallback was REMOVED — NEVER Gemini for listening, by the owner's cost
rule; on Groq failure the seeker gets "please try again", no fall-through. The phone's
own recognizer (SR) is kept ONLY as a last resort for devices that can't record.
Free Groq = ~2,000 transcriptions/day pooled across all seekers (plenty now); move
Groq to paid before that caps at scale. /health shows iosEar. Verified live with real
audio (a src='web' Hindi clip transcribed via whisper-large-v3).
Admin Users tab (2026-07-17): second lock, same password as Library
(x-library-key header on /api/admin/users + user-update; one unlock opens
both tabs per session). Admin CSS: [hidden]{display:none!important}.
VPS ops note: the repo lives at /opt/chatbot/app and pulls run AS USER
chatbot (deploy key is theirs) — root `git pull` fails; to force-deploy run
`/opt/chatbot/update.sh` (skips while a teach job is studying).
Pending: owner's app integrates via API-INTEGRATION.md; retire Render (owner's
call); VPS deploy key still read-only (teach-on-live can't push back yet).
