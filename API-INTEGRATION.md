# Chatbot API — integration handoff

This is everything the **app** (built on the other laptop) needs to talk to the chatbot.
The chatbot runs as a small standalone backend; the app just makes one HTTP call per question.
Nothing about the app's language or framework matters — if it can make an HTTPS request, it works.

> Hand this file to the app's build (or the Claude session on the other laptop). It is
> self-contained: the endpoint, the exact request/response shapes, error handling, and
> ready-to-adapt client code.

---

## The one endpoint

```
POST  https://<CHATBOT_HOST>/api/chat
Content-Type: application/json
```

`<CHATBOT_HOST>` is the public address where this backend is hosted. It isn't live yet —
it'll be a URL like `https://chat.ashaeiynn.com` or a hosting URL (Railway/Render/Fly/VPS).
While developing against a laptop on the same network, it can be `http://<laptop-ip>:3111`.

### Request body

```json
{
  "message": "How do I protect my aura?",
  "history": [
    { "role": "user", "content": "What is Aqua Foundation?" },
    { "role": "assistant", "content": "..." }
  ]
}
```

- `message` (required) — the visitor's current question. Any language (Hindi or English).
- `history` (optional) — recent turns for follow-up context. Send the last few exchanges;
  the server keeps only the most recent and caps length. Omit it for a fresh question.
- `profile` (optional) — personal-guide context stored on the USER'S device (the server
  keeps no per-person memory): `{ "topics": ["their recent questions", …≤8],
  "seen": ["source titles already shown", …≤80] }`. When present, the answer is gently
  connected to their journey and the response gains a `suggest` field — one relevant
  source they haven't seen: `{ "title", "timestamp", "url" }`. Show it as a
  "watch next" hint and add its title to `seen`.

### Response body

```json
{
  "answer": "To protect your aura, ...",
  "sources": [
    { "title": "App Part 2.1 Aura Protection 1", "timestamp": "3:14", "url": "https://vimeo.com/848496690#t=194s" }
  ]
}
```

- `answer` — the reply to show the user, already in the user's language.
- `sources` — up to 3 videos the answer came from (title + timestamp + deep link). Show these
  as "watch the source" links, or ignore them — they're optional UI sugar.

If the question isn't covered by the videos, `answer` is a polite fallback message and
`sources` is empty. The app doesn't need to special-case that.

### Errors

The app should handle non-200 responses gracefully (show a friendly retry message):

| Status | Meaning | App should… |
|---|---|---|
| 429 | Too many messages from this user, too fast | Ask them to wait a moment |
| 503 | Backend not fully configured / busy | Show "temporarily unavailable" |
| 400 | Empty/oversized message | Validate input before sending |

Every error body is `{ "error": "human-readable message" }` — safe to surface directly.

---

## Client example (adapt to the app's framework)

The call is identical everywhere; only the surrounding UI differs. This plain-JS version works
as-is in a web/PWA/React-Native app; the Claude session building the app can translate it to
Flutter/Dart, Swift, or Kotlin one-to-one.

```js
async function askChatbot(message, history = []) {
  const res = await fetch("https://<CHATBOT_HOST>/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Chatbot unavailable");
  return data; // { answer, sources }
}

// Maintain a running history array in the chat screen:
const history = [];
async function onSend(userText) {
  const { answer, sources } = await askChatbot(userText, history);
  history.push({ role: "user", content: userText });
  history.push({ role: "assistant", content: answer });
  if (history.length > 12) history.splice(0, history.length - 12); // keep it short
  return { answer, sources };
}
```

That's the entire integration. A text input, a send button, a scrolling message list, and
this one function.

---

## Security / hosting notes (for whoever deploys the backend)

- **CORS:** set `ALLOWED_ORIGIN` in the backend `.env` to the app's origin once known (or leave
  `*` if the app is native and origin-less). For a native app, requests aren't origin-bound, so
  consider adding a shared secret header if abuse is a concern.
- **Rate limiting** is built in (20 messages / 5 min per IP) so the Claude bill can't be run up.
- **The Anthropic API key lives only in the backend `.env`** — never ship it inside the app.
- The backend is one Node process with a local SQLite knowledge base; it hosts anywhere Node 22+
  runs. See `README.md` → Hosting.
