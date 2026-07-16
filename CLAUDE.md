# Ashaeiynn Voice Chatbot — project brief

Voice-first chatbot for Ashaeiynn (third-eye activation centre, Hisar — ashaeiynn.com).
Applicants SPEAK questions (Hindi/English) and HEAR grounded answers from Bhaiya's teachings.
Owner (Parikshit) is non-technical: explain simply, do the work for him, verify before claiming done.

## Read before big changes
- `README.md` — commands, architecture, costs
- `API-INTEGRATION.md` — API contract for the owner's separate app (built on another laptop)
- `DEPLOY.md` — Render/Docker go-live steps · `LAPTOP-SETUP.md` — new-machine setup

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
  tap-to-speak stage (SpeechRecognition hi-IN/en-IN toggle), answers spoken (server TTS →
  browser fallback); "⌨️ type instead" fallback. Served no-cache.
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
- `npm run test:answers` — 22-question answer suite (needs server running; ~$0.15). Passing
  bar is 22/22; a grounded answer must end with a `Source:` line, fallbacks must not.
- Mac quirks: PATH needs `~/.local/node/bin`, `~/.local/bin`, `~/Library/Python/3.9/bin`
  (no Homebrew, no profile edits). Kill stale servers: `lsof -ti :3111 | xargs kill -9`.
  The owner's second Mac is Intel (x86_64): `onnxruntime-node` is pinned to 1.23.0 in
  package.json `overrides` (1.24+ ships Apple-Silicon-only macOS binaries) — never remove.
  Hidden browser tabs freeze CSS animations and SpeechRecognition — verify via
  `getAnimations()` clock jumps; real voice tests need the owner's own browser.

## State (2026-07-16)
Knowledge: ~180 sources / ~2,700 chunks (91 Vimeo/YouTube videos ~64h + 58 articles +
29 site pages + Bhaiya audio/video files). 3 Vimeo videos remain password-locked (skipped).
Suite 22/22. Anthropic key funded (~$5, hard cap). ElevenLabs key NOT yet added.
Done: GitHub repo (Ashaeiynn/ashaeiynn-chatbot, private) + both Macs cloned & auto-syncing.
Pending: Render deploy → owner's app integrates via API-INTEGRATION.md.
