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

### Identity: the app supplies it, the guide never asks for it

Everyone using the guide **from the app is a member of Ashaeiynn**, and the app already knows their
name, email and phone — so the guide must NOT ask for any of that. Two steps:

**Step 1 — enrol the user once (on their first guide open).** The app POSTs their details to the guide,
which stores them keyed by the app's own user id and marks them a **member**. Idempotent — safe to call
on every open.

```
POST https://guide.ashaeiynn.com/api/app/register
Header:  x-app-key: <APP_KEY>          ← shared secret (see below)
Body:    { "uid": "<APP_USER_ID>", "name": "Full Name",
           "email": "person@example.com", "phone": "+9198…" }
→ 200 { "ok": true, "uid": "…", "member": true }
```

- `uid` — the app's own user id (**the same id the app already uses**). This is how the guide knows the
  same person across sessions and marks their membership.
- `name`, `email`, `phone` — captured silently for the owner's records (the admin Users tab). The guide
  never shows them to the seeker or asks for them.
- **These details go in the BODY, never a URL** (URLs get logged/cached — never put email/phone there).
- `APP_KEY` is a shared secret set in the guide's `.env` on the VPS. Ideally the app's **backend** makes
  this call (so the secret isn't shipped in the app binary); if the app has no backend it can call it
  directly. Until `APP_KEY` is set the endpoint replies `501` — tell us and we'll set it when you wire
  this up. (Marking someone a member only means they're never pitched to "join", so the risk if the
  secret leaked is low.)

**Step 2 — open the guide with the user's id.**

```
https://guide.ashaeiynn.com/app?uid=<APP_USER_ID>&name=<First name>
```

- `uid` — same id as above; makes them the same seeker **and** a recognised member.
- `name` — first name only, used to pre-fill the one thing the guide DOES ask (below). Still **no email
  or phone in the URL**.

**What the guide asks:** exactly one warm question — *"What would you like me to call you?"* — pre-filled
with the first name, once per device. Nothing else. (Name/email/phone already came from Step 1; the user
is already a member; sign-up is skipped entirely in the app.)

### Native container settings — get these THREE right (this is the whole app-side job)

The guide is full-screen and voice-first. The three things below are exactly the iOS quirks we hit
while testing in Safari / the home-screen shortcut — **a native app fixes all three, but only if the
WebView is configured as follows.** Get them right once and it "just works" on day one.

**A · Fill the whole screen (no empty strip at the bottom).**
In Safari/home-screen the browser sizes the page and iPhone mis-measures the height, leaving a gap. In
your app, YOU size the WebView — pin it edge-to-edge and the gap is gone. The guide's `/app` page
already declares `viewport-fit=cover` and pads its own controls clear of the home indicator, so
edge-to-edge is the correct, safe choice.
- **iOS (WKWebView):** pin the web view to the view controller's **edges**, not the safe area (so it
  extends under the status bar and home indicator); set
  `webView.scrollView.contentInsetAdjustmentBehavior = .never`.
- **Android (WebView):** draw edge-to-edge (`WindowCompat.setDecorFitsSystemWindows(window, false)`)
  and give the WebView `MATCH_PARENT` width/height.
- **Flutter / React Native:** give the web view the full screen (full-bleed container; don't wrap it in
  padding or a `SafeArea` that reserves a bottom strip — the page handles insets itself).

**B · Let it make sound on open (the spoken "Jai Siya Ram" welcome).**
Apple blocks all audio until the user first touches the screen — and the app auto-opens with no touch.
A website can't lift that rule; **your app can**, with one WebView setting:
- **iOS (WKWebView):** on the `WKWebViewConfiguration`, set
  `mediaTypesRequiringUserActionForPlayback = []` **and** `allowsInlineMediaPlayback = true`.
- **Android (WebView):** `webView.settings.mediaPlaybackRequiresUserGesture = false`.
- **Flutter (`flutter_inappwebview`):** `mediaPlaybackRequiresUserGesture: false`,
  `allowsInlineMediaPlayback: true`. **React Native (`react-native-webview`):**
  `mediaPlaybackRequiresUserAction={false}`, `allowsInlineMediaPlayback`.
- **Test the welcome on a real iPhone.** That flag reliably autoplays the guide's `<audio>` (its natural
  answer voice); the short *welcome* uses the phone's built-in voice, which Apple sometimes still gates.
  If it won't autoplay, nothing breaks — the guide already greets on the seeker's **first touch** as a
  fallback. (If you want it guaranteed on open, the app can speak the welcome with native
  `AVSpeechSynthesizer` — ask and we'll expose the exact line/gender/language over the Phase-3 bridge.)

**C · Microphone (tap-to-speak).**
- **iOS (WKWebView):** add **`NSMicrophoneUsageDescription`** to Info.plist (a user-facing reason);
  implement the iOS-15+ capture delegate
  `webView(_:requestMediaCapturePermissionFor:initiatedByFrame:type:decisionHandler:)` →
  `decisionHandler(.grant)`; keep `allowsInlineMediaPlayback = true`. (Microphone in WKWebView works on
  iOS 14.3+. Note: the guide records audio and transcribes it on our server on iOS — it does **not**
  rely on Safari's `SpeechRecognition`, which WKWebView doesn't have — so nothing extra is needed there.)
- **Android (WebView):** declare `RECORD_AUDIO` in the manifest and request it at runtime; handle
  `WebChromeClient.onPermissionRequest` → `request.grant(request.resources)`.
- **Flutter:** `onPermissionRequest` → `PermissionResponse(action: GRANT)` plus the platform mic
  permission. **React Native:** `mediaCapturePermissionGrantType="grant"` (iOS) + the Android
  `onPermissionRequest` handling above.

If the mic can't be granted, the guide still works — the user taps **"⌨️ type instead"**.

**iOS quick checklist:** ① WebView pinned to edges + `contentInsetAdjustmentBehavior = .never` ·
② `mediaTypesRequiringUserActionForPlayback = []` + `allowsInlineMediaPlayback = true` ·
③ `NSMicrophoneUsageDescription` + grant the iOS-15 media-capture permission.

### Getting back to the app

The guide fills the screen with no browser bar, so **the app provides the way back** — and because
the guide is a single screen, this is simple. **Chosen approach: a native back bar** — a thin strip
the app places **above** the guide with a **← / ✕** button; tapping it returns the user to wherever
they were. The bar sits on top and the guide fills the area below it (keep the *bottom* edge-to-edge,
per setting A above).

- **iOS:** host the WKWebView inside a `UINavigationController` (its nav bar gives the back button and
  the edge-swipe-back gesture), **or** put a small custom header with a Close button above the web view
  and call `dismiss` / `popViewController` on tap.
- **Android:** host the WebView in its own Activity/Fragment with a `Toolbar` back arrow; the **system
  Back** gesture should also exit. The guide is one page with **no internal web history**
  (`webView.canGoBack()` is `false`), so on Back just finish the screen — do **not** call
  `webView.goBack()`.
- **Flutter:** a `Scaffold` + `AppBar` (leading back) around the `InAppWebView`; `Navigator.pop`.
- **React Native:** a header (e.g. React Navigation) with a back button around `react-native-webview`;
  `navigation.goBack()`.

The guide's own **Guide / Chats** tabs are internal toggles, not separate pages — so "back" always
means "leave the guide," never "switch its tab." Nothing is needed on the guide side for this
approach; the app simply dismisses its own screen. *(If you'd rather keep the guide fully immersive
with the back control INSIDE it — no top bar — we can add a `←` in the guide's corner that posts a
`{ source: "ashaeiynn-guide", type: "close" }` message over the Phase-3 bridge for the app to handle.
Just ask.)*

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

- **App users are members automatically** — the `POST /api/app/register` call above marks them a member
  (⭐ in the guide's admin), so they're never pitched screening/joining and get members-only answers.
  (Each chat reply also carries `"member": true` if the app ever wants to know.) Non-app visitors are
  not members unless the owner marks them.
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
