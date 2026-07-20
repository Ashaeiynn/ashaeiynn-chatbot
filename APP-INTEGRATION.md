# Putting the guide inside the main app — integration contract

This is the handoff for the **main Ashaeiynn app** (built on the other Mac). It explains how the
app shows the guide, how the same person stays the same seeker across both, and how the guide can
learn the app's own content and walk a user to a screen inside the app.

> Hand this file to the Claude session building the app. It is self-contained.

---

## The one idea that makes this simple

There is **one** guide, and it lives on the VPS at **`https://guide.ashaeiynn.com`**. The app does
not carry a copy of it — the app opens a **door** to that one live guide.

So everything the owner does to the guide — approve a correction, teach a PDF, ship a fix from
either Mac — reaches the app **instantly, with no app-store update**, because the app is showing the
same live guide. There is nothing to "sync".

---

## Phase 1 — show the live guide in the app  *(built & live on the guide side)*

The guide already serves a full-screen page made for a WebView:

```
https://guide.ashaeiynn.com/app
```

It fills the screen, opens straight into the guide (no floating bubble, no demo text), and works in
Hindi + English with voice. **The app side is just: a "Guide" button that opens this URL in a WebView.**

### Pass the signed-in user in (recommended)

So the same person is the same seeker in the app and the guide (their journey + any member badge
follow them, and the guide skips its own name/sign-up):

```
https://guide.ashaeiynn.com/app?uid=<APP_USER_ID>&name=<Display Name>
```

- `uid` — the app's own user id. Use the **same id the app already uses** for that user. Optional but
  strongly recommended.
- `name` — the user's first name, for a warm greeting. Optional.
- URL-encode both. Send nothing else — no phone/email in the URL.

### The one thing to get right: microphone permission

The guide is voice-first, so the WebView must be allowed to use the mic. This is the only real work
on the app side.

- **Android (native WebView):** set `webView.settings.javaScriptEnabled = true` and
  `mediaPlaybackRequiresUserGesture = false`; handle `WebChromeClient.onPermissionRequest` →
  `request.grant(request.resources)`; declare `RECORD_AUDIO` in the manifest and request it at runtime.
- **iOS (WKWebView):** add `NSMicrophoneUsageDescription` to Info.plist; on iOS 15+
  `configuration.allowsInlineMediaPlayback = true` and (iOS 15) grant via the media-capture delegate.
- **Flutter:** `flutter_inappwebview` — `onPermissionRequest` → `PermissionResponse(action: GRANT)`,
  plus the platform mic permissions above.
- **React Native:** `react-native-webview` with `mediaCapturePermissionGrantType="grant"` (iOS) and the
  Android `onPermissionRequest` handling above.

If the mic can't be granted, the guide still works — the user taps **"⌨️ type instead"**.

### Web / PWA app instead of native?

Two choices: open `/app` in an `<iframe>` (mic works via the browser; the guide sends no
`X-Frame-Options` on `/app`, so it may be framed), **or** drop the one-line embed on any page:

```html
<script src="https://guide.ashaeiynn.com/widget.js" data-embed="app" defer></script>
```

---

## Phase 2 — teach the guide the app's own content  *(app side produces a feed)*

So the guide can answer "how do I book a session in the app?" or "where are my orders?", the app's
content is fed into the guide's knowledge. The app produces a simple export; the owner teaches it to
the guide (Teach tab, or an automatic pull we can add later). Shape:

```json
[
  {
    "id": "orders",
    "title": "My Orders",
    "route": "/orders",
    "text": "The Orders screen lists every session and product you have booked. Tap an order to see its date, status, and receipt. To reschedule, open the order and tap Reschedule.",
    "updatedAt": "2026-07-21"
  }
]
```

- `title` — human name of the screen/feature.
- `route` — the app's **own deep link** for that screen (whatever the app router uses). This is what
  makes "take me there" possible in Phase 3.
- `text` — a plain-language description of what the screen is and how to use it. Written for a person,
  not code — the guide answers from this.
- Re-export whenever the app's screens/flows change; re-teaching is a one-click study on the guide.

Keep this feed to **app how-to content** — Bhaiya's spiritual teachings already live in the guide.

---

## Phase 3 — "take me there": the guide opens a screen in the app  *(needs Phase 2 routes)*

When the guide answers from an app-content item, it will offer a **button** ("Open My Orders"). Tapping
it asks the host app to navigate. The guide will call, in this order, whichever the app provides:

```js
// 1) native bridge object the app injects (preferred)
window.AshaeiynnApp && window.AshaeiynnApp.navigate(route);
// 2) React-Native WebView
window.ReactNativeWebView &&
  window.ReactNativeWebView.postMessage(JSON.stringify({ source: "ashaeiynn-guide", type: "navigate", route }));
// 3) web / iframe
window.parent && window.parent.postMessage({ source: "ashaeiynn-guide", type: "navigate", route }, "*");
```

**The app side implements ONE of these** for its framework:
- **Android:** `webView.addJavascriptInterface(obj, "AshaeiynnApp")` with a `navigate(String route)` method.
- **iOS:** a `WKScriptMessageHandler` — or expose `window.AshaeiynnApp.navigate` via injected JS that posts
  to `window.webkit.messageHandlers`.
- **Flutter:** an `InAppWebView` JavaScript handler named `AshaeiynnApp` / a `JavascriptChannel`.
- **React Native:** handle `onMessage`, parse `{type:"navigate", route}`, call the app's router.
- **Web:** `window.addEventListener("message", …)`, check `e.data.source === "ashaeiynn-guide"`.

`route` is exactly the `route` from the Phase-2 feed, so the app just hands it to its own router.
The guide-side rendering of this button ships when the first app routes exist — tell us the feed and
we wire it.

*(Optional, later: the app can push a question INTO the guide — a quick-action chip — by calling
`window.AshaeiynnGuide.ask("...")`. Say the word and we add that receiver.)*

---

## Membership & the daily question limit

- Members (⭐ in the guide's admin) are never pitched screening/joining and get members-only answers.
  For the app's users to be recognised as members, they must exist in the guide's user registry with
  the **same `uid`** the app passes. Simplest path: the owner marks them in the guide admin; if the app
  should register/mark users automatically, we can add a tiny authenticated endpoint that takes the
  app's `uid` — ask and we build it.
- The guide gives each seeker **25 questions/day** (resets daily; admin-granted extras carry forward).
  This keys off `uid`, so passing the app's `uid` keeps one honest count per person.

---

## Security notes

- **CORS / framing:** `/app` is meant to be framed by the app and sends no `X-Frame-Options`. The API
  allows the app's origin via `ALLOWED_ORIGIN` in the guide's `.env` (native apps are origin-less; leave
  `*` or set the web app's origin).
- **No secrets in the app.** All keys (Gemini/Anthropic/Groq/ElevenLabs) live only in the guide's `.env`
  on the VPS. The app only ever holds a URL.
- **Rate limiting** is built in on the guide, so the app cannot run up the bill.
- Never put phone/email or any personal data in the `/app` URL — only `uid` + first `name`.
