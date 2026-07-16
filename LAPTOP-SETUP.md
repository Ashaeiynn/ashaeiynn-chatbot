# Working on the chatbot from another computer

This project syncs between computers through its private GitHub repository.
Golden rule: **pull before you start, push when you stop** (or just ask Claude to do it).

## One-time setup on the new computer

1. **Install Node.js 22 or newer** — nodejs.org → download LTS → install.
   (Check with: `node --version`)
2. **Clone the repository** (Claude Code can do all of this for you — just show it this file):
   ```bash
   git clone https://github.com/Ashaeiynn/ashaeiynn-chatbot.git
   cd ashaeiynn-chatbot
   npm install
   ```
   (Sign in to GitHub as the user "Ashaeiynn" when prompted — the repo is private.)
3. **Recreate the secrets file** — `.env` is deliberately NOT in the repository (it holds your
   API key). Copy the `.env` file from the other computer (AirDrop the single file, or retype it).
   It lives in the project root.
4. **Run it:**
   ```bash
   npm start        # → http://localhost:3111
   ```

## For Claude on the new computer — project context

You're continuing an existing, working project. Before doing anything, read:
- `README.md` — what this is and how it runs
- `API-INTEGRATION.md` — the API contract the user's app will call
- `DEPLOY.md` — how it goes live (Render + Docker, prepared)

Current state: 91 videos transcribed and indexed (`data/knowledge.db`, cross-language
Hindi/English semantic search), answer quality suite at 22/22 (`npm run test:answers`,
needs the server running), voice-first widget (speech in/out, `widget/widget.js`),
warm Hindi/English persona (`server/prompt.mjs`), optional ElevenLabs natural voice
(`ELEVENLABS_API_KEY` in `.env`). Model: claude-haiku-4-5. Pending: Render deployment,
then integration into the user's app.

Useful commands: `npm start` (server), `npm run test:retrieval` (no API cost),
`npm run test:answers` (calls the API, costs ~$0.15), `npm run process` (ingest new
videos listed in `data/inventory.json`), `npm run ingest` (rebuild knowledge base).

## Day-to-day rhythm (both computers)

**Syncing is fully automatic** — hooks in `.claude/settings.json` (committed in this repo)
run `scripts/auto-sync.sh`: `git pull` when a Claude Code session starts, auto-commit + push
every time Claude finishes a turn. The script also sets up git identity on a brand-new
machine by itself, and CLAUDE.md tells Claude to sync manually if the hooks haven't loaded
yet — so on any computer: clone, open Claude Code, done.

- If Claude Code ever asks to approve the project's hooks, say yes (one time, security prompt).
- If both computers edited the same lines while one was offline, the conflict is reported
  to Claude automatically and it resolves it in-session — nothing for you to do.
- Being offline is fine: syncing just catches up the next time you work.
- Manual fallback still works: `git pull` / `git add -A && git commit -m "…" && git push`.

_Auto-sync verified end-to-end from the Intel MacBook on 2026-07-16 — this very line was committed and pushed by the sync system itself._
