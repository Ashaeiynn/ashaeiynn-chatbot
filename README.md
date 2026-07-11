# Video Chatbot

A chatbot for your website and app that answers visitor questions using **only** the knowledge
from your video library. Answers include links to the exact video moment the information came from.

## How it works

```
Vimeo videos ──▶ transcripts ──▶ searchable knowledge base ──▶ chatbot answers
   (yours)        (automatic)       (free, local SQLite)        (Claude API)
```

## Your to-do list (the only manual steps)

1. **Paste your Vimeo links** into `data/videos.txt`, one per line.
2. **Get an API key** at https://console.anthropic.com → Settings → API keys → Create key.
   Buy a small amount of credit ($5 is plenty to start) and set a monthly spend limit.
3. **Paste the key** into the `.env` file: `ANTHROPIC_API_KEY="sk-ant-..."`

Everything else is automated.

## Commands

| Command | What it does |
|---|---|
| `npm run download` | Downloads audio from the Vimeo links in `data/videos.txt` |
| `npm run transcribe` | Converts audio to timestamped transcripts (free, runs locally) |
| `npm run ingest` | Builds/rebuilds the searchable knowledge base |
| `npm start` | Runs the chatbot server → http://localhost:3111 |
| `npm run compare -- "question"` | Same question answered by cheap vs premium model, with per-answer cost |

**Adding new videos later:** add the link to `data/videos.txt`, then run
`npm run download && npm run transcribe && npm run ingest`. That's it — the bot now knows the new content.

## Putting it on your website (WordPress)

Once the server is hosted (see below), add this single line to your site
(Appearance → Theme File Editor → footer.php, or any "custom HTML/scripts" plugin):

```html
<script src="https://YOUR-CHATBOT-DOMAIN/widget.js" defer></script>
```

Optional customization:

```html
<script
  src="https://YOUR-CHATBOT-DOMAIN/widget.js"
  data-title="Ask us anything"
  data-color="#4f46e5"
  defer
></script>
```

## Using it from your app

Your app calls the same backend — one endpoint:

```
POST https://YOUR-CHATBOT-DOMAIN/api/chat
Content-Type: application/json

{ "message": "How do I get started?",
  "history": [ {"role":"user","content":"..."}, {"role":"assistant","content":"..."} ] }
```

Response:

```
{ "answer": "…", "sources": [ { "title": "…", "timestamp": "3:05", "url": "https://vimeo.com/…#t=185s" } ] }
```

## Hosting

The server is a single Node.js process with no external database — it runs anywhere Node 22+
runs (Railway, Render, Fly.io, a $5 VPS, or your existing server). Deploy the folder, set the
environment variables from `.env`, done. The `data/knowledge.db` file ships with the deploy.

## Costs

- Transcription: free (local). Search: free (local SQLite). Hosting: free tier works.
- Answers: the only recurring cost. Approximate, per 1,000 visitor questions:
  - `claude-haiku-4-5` ≈ $7 · `claude-sonnet-5` ≈ $15–20 · `claude-opus-4-8` ≈ $35
- Change models any time by editing `CHAT_MODEL` in `.env`.

## Safety rails built in

- Answers come only from your transcripts; off-topic and uncovered questions get a polite fallback.
- Per-visitor rate limiting (20 messages / 5 minutes) so nobody can run up your bill.
- Message length caps, locked-down CORS (`ALLOWED_ORIGIN` in `.env`), and friendly error messages.
