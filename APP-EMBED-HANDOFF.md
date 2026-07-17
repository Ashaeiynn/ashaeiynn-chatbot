# Handoff — embed the Ashaeiynn Guide into the iOS/Android app

Give this whole file to the Claude session (or developer) building the app.
It is self-contained: nothing else is needed from the chatbot side.

---

## What this is

A ready-made, **voice-first** spiritual chatbot — "Ask Your Guide". It is **already
fully built and live**. Do NOT rebuild it, do NOT call any API, do NOT copy any code.
You are only **displaying** it inside the app.

**It lives here (already deployed, always on):**

```
https://guide.ashaeiynn.com
```

That URL is the complete experience — the UI, the voice, the knowledge base, sign-up,
everything. The app's only job is to show it.

## How to embed it

Put a **full-screen WebView** on a screen or tab of the app (for example an
"Ask Your Guide" tab, or a button that opens it) and load
`https://guide.ashaeiynn.com`. No backend, no API keys, no login wiring.

## Critical WebView settings — the guide is voice-first, so these make or break it

1. **JavaScript** — enabled.
2. **DOM / local storage** — enabled AND persisted across app launches. The guide stores
   each seeker's sign-up and journey in `localStorage`; without persistence they'd have to
   sign up again every time.
3. **Microphone permission** — REQUIRED for speaking questions:
   - **Android:** add `<uses-permission android:name="android.permission.RECORD_AUDIO"/>`
     to the manifest, and in `WebChromeClient.onPermissionRequest(...)` **grant**
     `PermissionRequest.RESOURCE_AUDIO_CAPTURE`.
   - **iOS (WKWebView):** add `NSMicrophoneUsageDescription` to `Info.plist`, and allow the
     WebView's `getUserMedia` (WKWebView supports mic capture on iOS 14.5+ — grant it via
     the UI delegate; don't block it).
4. **Media autoplay** — so the spoken answers play automatically after a tap:
   - **Android:** `webSettings.mediaPlaybackRequiresUserGesture = false`.
   - **iOS:** `configuration.allowsInlineMediaPlayback = true` and
     `configuration.mediaTypesRequiringUserActionForPlayback = []`.

## Framework-specific (pick the one you're using)

- **Flutter** → use `flutter_inappwebview` (best permission handling). Set
  `javaScriptEnabled: true`, `mediaPlaybackRequiresUserGesture: false`; implement
  `onPermissionRequest` → return `GRANT`. Add the mic permission to `AndroidManifest.xml`
  and `NSMicrophoneUsageDescription` to `Info.plist`.
- **React Native** → `react-native-webview` with props:
  `javaScriptEnabled`, `domStorageEnabled`, `allowsInlineMediaPlayback`,
  `mediaCapturePermissionGrantType="grant"`. Add native mic permission on both platforms.
- **Native Android (Kotlin/Java)** → `WebView` + `WebChromeClient.onPermissionRequest`
  grant; `settings.javaScriptEnabled = true`, `settings.domStorageEnabled = true`,
  `settings.mediaPlaybackRequiresUserGesture = false`.
- **Native iOS (Swift)** → `WKWebView` + `WKUIDelegate`; `Info.plist` mic key; config
  `allowsInlineMediaPlayback = true`, `mediaTypesRequiringUserActionForPlayback = []`.

## The one thing you MUST test

Open the guide screen → tap the third-eye orb → **speak a question in Hindi** → confirm it
(a) hears you and (b) speaks the answer back. Microphone-in-a-WebView is the #1 thing that
breaks; if the mic doesn't work it is a **WebView permission-grant** problem on the app
side, not a problem with the guide.

## Good to know

- **Self-contained:** seekers sign up inside the guide (name / WhatsApp), separate from the
  app's own login for now. That's fine for a first version. (Later, the app's logged-in
  user can be passed into the guide to skip the second sign-up — ask when you want that.)
- **Credits:** currently OFF — nothing to handle.
- **Embedding is already allowed** on the guide's server (cross-origin open, no frame
  blocking) — verified, so the WebView will load with no server changes.
- Full API details (for a custom-built chat screen instead of this ready-made UI) live in
  `API-INTEGRATION.md` — not needed for this WebView approach.
