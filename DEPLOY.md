# Deploying the chatbot backend

The backend is one small Node service with a local knowledge base and no external database.
Once it's hosted at a public URL, your app calls `POST /api/chat` (see `API-INTEGRATION.md`).

You only deploy **after** the knowledge base is built (`npm run ingest` has produced
`data/knowledge.db`) and you have an Anthropic API key.

## What to set as environment variables (on any host)

| Variable | Required | Value |
|---|---|---|
| `CHAT_PROVIDER` | – | `gemini` (Google, free tier — current choice) or `anthropic` (Claude) |
| `GEMINI_API_KEY` | if gemini | Your key from aistudio.google.com. **Never commit this.** |
| `GEMINI_MODEL` | – | `gemini-3.5-flash` (current) |
| `ANTHROPIC_API_KEY` | if anthropic | Your key from console.anthropic.com. **Never commit this.** |
| `CHAT_MODEL` | – | `claude-opus-4-8` (best) / `claude-sonnet-5` / `claude-haiku-4-5` (cheapest) |
| `ALLOWED_ORIGIN` | – | Leave unset/`*` for a native app; set to your web origin if it's a browser app |
| `PORT` | – | Most hosts set this automatically |

Confirm a deploy is live by opening `https://<your-host>/health` — it returns
`{"ok":true,...,"knowledgeBase":"built"}`.

## Option A — Docker (most reliable; works anywhere)

A `Dockerfile` is included. It bakes in the knowledge base and the embedding model.

```bash
docker build -t ashaeiynn-chatbot .
docker run -p 3111:3111 -e ANTHROPIC_API_KEY="sk-ant-..." ashaeiynn-chatbot
```

Any container host (Fly.io, Railway, Render, a VPS, Google Cloud Run) can run this image.
Point it at port 3111 and set `ANTHROPIC_API_KEY`.

## Option B — Railway or Render (easiest, no server to manage)

1. Push this folder to a private GitHub repo (the `.gitignore` already excludes `.env`).
2. Create a new service from the repo. Both platforms detect the `Dockerfile` automatically.
3. Add the environment variables above in the dashboard.
4. Deploy. You get a public URL like `https://ashaeiynn-chatbot.up.railway.app`.
5. Put that URL into your app (as `CHATBOT_HOST` in `API-INTEGRATION.md`).

## Option C — Your own server / VPS

```bash
# Node 24+ required (for stable node:sqlite)
npm install --omit=dev
ANTHROPIC_API_KEY="sk-ant-..." node server/server.mjs   # listens on PORT (default 3111)
```

Run it under a process manager (pm2, systemd) and put it behind your existing HTTPS
(nginx/Caddy) at a subdomain like `chat.ashaeiynn.com`.

## Updating the knowledge base later

When you add videos: re-run the transcription pipeline + `npm run ingest` to rebuild
`data/knowledge.db`, then redeploy (Docker rebuild, or restart the VPS process). No code changes.

## Cost reminder

Only the answering step costs money (per the model above). Transcription, search, and hosting
are free or near-free. Set a monthly spend limit in the Anthropic console to stay safe.
