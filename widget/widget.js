// Embeddable chat widget. Add to any site (WordPress, app webview, anything) with:
//   <script src="https://YOUR-CHATBOT-DOMAIN/widget.js" defer></script>
// Optional attributes:
//   data-api="https://YOUR-CHATBOT-DOMAIN"  (defaults to where the script came from)
//   data-title="Ask Your Guide"
//   data-color="#0b0b0f"
//   data-splash="जय सिया राम"          (the blessing shown when the chat opens)
//   data-splash-sub="JAI SIYA RAM"
(() => {
  const script = document.currentScript;
  const API = (script?.dataset.api || new URL(script.src).origin).replace(/\/$/, "");

  // Register the service worker on load. It used to be registered only when a
  // seeker switched notifications ON — so for almost everyone no worker existed,
  // Chrome never offered "Install app", and people ended up making a bookmark
  // shortcut by hand (grey "A" icon). Only on the guide's own origin: embedded
  // on another site there is no /sw.js to register.
  if ("serviceWorker" in navigator && location.protocol === "https:" && API === location.origin) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // An in-app browser (a link tapped inside WhatsApp, Instagram, Facebook)
  // CANNOT install anything — its "add to home screen", where it exists at all,
  // makes a bookmark. Most seekers arrive exactly that way, so say so plainly.
  const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FB4A|Instagram|WhatsApp|Line\/|Twitter|MicroMessenger|Snapchat|; wv\)/i;
  const isInAppBrowser = IN_APP_BROWSER.test(navigator.userAgent);
  const isInstalled = () =>
    window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const TITLE = script?.dataset.title || "Ask Your Guide";
  const COLOR = script?.dataset.color || "#0b0b0f";
  const SPLASH = script?.dataset.splash || "जय सिया राम";
  const SPLASH_SUB = script?.dataset.splashSub || "JAI SIYA RAM";
  // Only the DEFAULT blessing follows the UI language (जय सिया राम ↔ Jai Siya Ram);
  // a site that set its own data-splash keeps that exact text in both languages.
  const SPLASH_CUSTOM = !!script?.dataset.splash;

  // ——— App-embed mode: the guide is opened INSIDE the main Ashaeiynn app's
  // WebView (the app's "Guide" button brought the seeker here). Triggered by
  // data-embed="app" on the loader — the /app page sets it — or ?embed=app.
  // In this mode the guide fills the whole screen and drops its own floating
  // launcher/nudge (the app already has its own button), and it TRUSTS the
  // identity the app hands in so the same person is the same seeker in both.
  // On any ordinary website (WordPress, etc.) EMBED is false and nothing changes.
  const qs = new URLSearchParams(location.search);
  const EMBED = script?.dataset.embed === "app" || qs.get("embed") === "app";
  // Identity passed by the app (same user id across app + guide). uid makes them
  // a known seeker (their journey and any member badge follow them); name only
  // personalises the greeting. Both are optional — without them the guide still
  // works, it just runs its own name/sign-up like it does on the website.
  const appUid = (qs.get("uid") || "").trim().slice(0, 64);
  const appName = (qs.get("name") || "").trim().slice(0, 40);

  const history = [];

  // ——— the seeker's diary — kept ONLY on this device (localStorage), never on
  // the server. Each question carries a small context card (recent topics +
  // already-seen sources) that the server uses once and forgets. ———
  const J_KEY = "ashaiJourney";
  const journey = (() => {
    try {
      const j = JSON.parse(localStorage.getItem(J_KEY) || "{}");
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  })();
  journey.asked = Array.isArray(journey.asked) ? journey.asked : [];
  journey.seen = Array.isArray(journey.seen) ? journey.seen : [];
  journey.convo = Array.isArray(journey.convo) ? journey.convo : [];
  // ids of admin notices this device has already been shown (so each shows once)
  journey.seenAnnounce = Array.isArray(journey.seenAnnounce) ? journey.seenAnnounce : [];
  // The seeker's own conversation, kept on THIS phone for 24 hours (owner,
  // 2026-07-20) — viewable in the Chats tab, and never sent anywhere or stored
  // on a server. Each entry: { r:'u'|'b' (user/bot), t:text, at:ms }.
  journey.chatlog = Array.isArray(journey.chatlog) ? journey.chatlog : [];
  const CHAT_TTL = 24 * 3600 * 1000;
  function pruneChatlog() {
    const cutoff = Date.now() - CHAT_TTL;
    journey.chatlog = journey.chatlog.filter((m) => m && typeof m.at === "number" && m.at >= cutoff);
    if (journey.chatlog.length > 300) journey.chatlog.splice(0, journey.chatlog.length - 300);
  }
  pruneChatlog();
  function logChat(role, text) {
    const t = String(text || "").trim();
    if (!t) return;
    journey.chatlog.push({ r: role === "user" ? "u" : "b", t: t.slice(0, 2000), at: Date.now() });
    pruneChatlog();
    saveJourney();
    if (typeof renderChats === "function" && panel?.dataset.view === "chats") renderChats();
  }
  // returning after 3+ hours (not just a page reload in the same sitting)?
  const cameBack =
    journey.asked.length > 0 &&
    journey.lastSeen &&
    Date.now() - new Date(journey.lastSeen).getTime() > 3 * 3600 * 1000;
  // Every open is a FRESH conversation — the new question gets a clean answer,
  // never the old thread's leftovers. But the guide remembers where the last
  // conversation ended and, after answering, may OFFER to pick that thread up
  // ("वैसे पिछली बार हम … पर रुके थे — वहीं से आगे बढ़ें?"). The seeker chooses.
  const agoLabel = (iso) => {
    const h = (Date.now() - new Date(iso).getTime()) / 3600e3;
    return h < 3 ? "कुछ देर पहले" : h < 24 ? "आज ही" : h < 48 ? "कल" : `${Math.round(h / 24)} दिन पहले`;
  };
  let sessionAsks = 0;
  function saveJourney() {
    journey.lastSeen = new Date().toISOString();
    try {
      localStorage.setItem(J_KEY, JSON.stringify(journey));
    } catch {
      /* private mode — the guide still answers, just without memory */
    }
  }
  // The app told us who this is — adopt it as the seeker's identity so sign-up is
  // skipped and their journey/membership carry across the app and the guide.
  if (appUid) {
    journey.uid = appUid;
    if (appName && !journey.name) journey.name = appName;
    saveJourney();
  }
  function recordAsk(q) {
    journey.asked.push({ q: q.slice(0, 120), at: new Date().toISOString() });
    if (journey.asked.length > 30) journey.asked.splice(0, journey.asked.length - 30);
    saveJourney();
    // every 5 questions: quietly distill the journey into a one-line summary
    // (stored on this device) so the guide's understanding deepens over days
    if (journey.asked.length >= 5 && journey.asked.length % 5 === 0) {
      fetch(`${API}/api/distill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: journey.asked.map((a) => a.q) }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.summary) journey.summary = d.summary;
          if (d?.style) journey.commStyle = d.style; // how THIS seeker likes to talk
          if (d?.summary || d?.style) saveJourney();
        })
        .catch(() => {});
    }
  }
  function recordSeen(titles) {
    for (const t of titles) if (t && !journey.seen.includes(t)) journey.seen.push(t);
    if (journey.seen.length > 80) journey.seen.splice(0, journey.seen.length - 80);
    saveJourney();
  }

  const style = document.createElement("style");
  style.textContent = `
    .vcb-btn{position:fixed;bottom:20px;right:20px;width:62px;height:62px;border-radius:50%;
      background:radial-gradient(circle at 34% 28%,#20202a 0%,#0d0d13 45%,#000 100%);
      border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
      z-index:999998;transition:transform .2s ease;
      box-shadow:0 0 0 1.5px rgba(52,211,153,.6),0 0 22px rgba(52,211,153,.35),0 8px 24px rgba(0,0,0,.5);
      animation:vcbBreathe 3.6s ease-in-out infinite}
    .vcb-btn:hover{transform:scale(1.1)}
    @keyframes vcbBreathe{0%,100%{box-shadow:0 0 0 1.5px rgba(52,211,153,.55),0 0 16px rgba(52,211,153,.28),0 8px 24px rgba(0,0,0,.5)}
      50%{box-shadow:0 0 0 2px rgba(52,211,153,.85),0 0 34px rgba(52,211,153,.5),0 8px 24px rgba(0,0,0,.5)}}
    .vcb-btn::after{content:"";position:absolute;inset:-5px;border-radius:50%;
      border:2px solid #34d399;opacity:0;animation:vcbPing 3.6s ease-out infinite}
    @keyframes vcbPing{0%{transform:scale(.9);opacity:.5}70%{transform:scale(1.4);opacity:0}100%{opacity:0}}
    .vcb-logo{width:38px;height:auto;filter:drop-shadow(0 0 7px rgba(52,211,153,.45))}
    .vcb-ava img{width:22px;height:auto}
    .vcb-nudge{position:fixed;bottom:32px;right:94px;z-index:999997;cursor:pointer;
      background:linear-gradient(135deg,#b8f5dc,#2bbd85);color:#04231a;
      border:none;border-radius:999px;padding:10px 16px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      font-size:13.5px;font-weight:700;white-space:nowrap;
      box-shadow:0 6px 22px rgba(0,0,0,.4),0 0 24px rgba(52,211,153,.45);
      opacity:0;transform:translateX(12px);pointer-events:none;
      transition:opacity .5s ease,transform .5s ease}
    .vcb-nudge.show{opacity:1;transform:translateX(0);pointer-events:auto;animation:vcbNudgeFloat 3s ease-in-out infinite}
    @keyframes vcbNudgeFloat{0%,100%{transform:translateX(0) translateY(0)}50%{transform:translateX(0) translateY(-4px)}}
    .vcb-nudge::after{content:"";position:absolute;right:-4px;top:50%;width:10px;height:10px;
      background:#2bbd85;transform:translateY(-50%) rotate(45deg)}

    .vcb-panel{position:fixed;bottom:92px;right:20px;width:min(380px,calc(100vw - 32px));
      height:min(580px,calc(100vh - 124px));border-radius:22px;z-index:999999;
      background:radial-gradient(135% 100% at 50% 28%,#0b0b14 0%,#040407 55%,#000 100%);
      box-shadow:0 22px 70px rgba(8,5,30,.65),0 0 0 1px rgba(52,211,153,.14);
      display:none;flex-direction:column;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      transform-origin:bottom right}
    .vcb-panel.open{display:flex;animation:vcbPanelIn .4s cubic-bezier(.18,.89,.32,1.15)}
    @keyframes vcbPanelIn{from{opacity:0;transform:scale(.86) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}
    /* App-embed: the guide fills the host WebView (any screen size) and the
       floating launcher/nudge are gone — the app's own button opened us. */
    .vcb-panel.vcb-embed{top:0;left:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;
      border-radius:0;transform-origin:center bottom}
    body.vcb-embedded .vcb-btn,body.vcb-embedded .vcb-nudge{display:none !important}
    body.vcb-embedded .vcb-bell{display:none !important} /* the app owns phone push */
    .vcb-embed .vcb-head{padding-top:calc(12px + env(safe-area-inset-top))}
    .vcb-embed .vcb-form{padding-bottom:calc(12px + env(safe-area-inset-bottom))}

    /* (phone-specific rules live at the end of this stylesheet so they win) */

    /* ——— animated universe (slow motion) ——— */
    .vcb-cosmos{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
    .vcb-neb{position:absolute;border-radius:50%;filter:blur(26px);will-change:transform}
    .vcb-neb.n1{width:340px;height:300px;left:-90px;top:6%;
      background:radial-gradient(ellipse at 40% 45%,rgba(52,211,153,.08) 0%,rgba(255,255,255,.03) 45%,transparent 72%);
      animation:vcbNeb1 90s ease-in-out infinite alternate}
    .vcb-neb.n2{width:300px;height:280px;right:-80px;bottom:8%;
      background:radial-gradient(ellipse at 55% 50%,rgba(52,211,153,.07) 0%,rgba(217,120,50,.05) 40%,transparent 70%);
      animation:vcbNeb2 110s ease-in-out infinite alternate}
    .vcb-neb.n3{width:240px;height:220px;left:24%;bottom:-70px;
      background:radial-gradient(ellipse at 50% 50%,rgba(255,255,255,.04) 0%,transparent 68%);
      animation:vcbNeb1 130s ease-in-out infinite alternate-reverse}
    @keyframes vcbNeb1{from{transform:translate(0,0) rotate(0deg) scale(1)}to{transform:translate(46px,30px) rotate(28deg) scale(1.18)}}
    @keyframes vcbNeb2{from{transform:translate(0,0) rotate(0deg) scale(1.1)}to{transform:translate(-38px,-26px) rotate(-24deg) scale(.95)}}
    .vcb-galaxy{position:absolute;inset:-42%;animation:vcbGalaxy 780s linear infinite;will-change:transform}
    @keyframes vcbGalaxy{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .vcb-starfield{position:absolute;inset:-240px 0 0 0;background-repeat:repeat;will-change:background-position}
    .vcb-starfield.s1{background-size:240px 240px;opacity:.7;animation:vcbDrift1 210s linear infinite;
      background-image:radial-gradient(1.1px 1.1px at 22px 34px,rgba(255,255,255,.55) 50%,transparent 51%),
        radial-gradient(1px 1px at 118px 90px,rgba(255,255,255,.4) 50%,transparent 51%),
        radial-gradient(1.3px 1.3px at 197px 156px,rgba(52,211,153,.5) 50%,transparent 51%),
        radial-gradient(1px 1px at 68px 198px,rgba(255,255,255,.35) 50%,transparent 51%),
        radial-gradient(1.2px 1.2px at 160px 44px,rgba(190,200,255,.45) 50%,transparent 51%)}
    .vcb-starfield.s2{background-size:320px 320px;opacity:.45;animation:vcbDrift2 340s linear infinite;
      background-image:radial-gradient(1px 1px at 44px 120px,rgba(255,255,255,.4) 50%,transparent 51%),
        radial-gradient(.9px .9px at 210px 60px,rgba(255,255,255,.32) 50%,transparent 51%),
        radial-gradient(1.1px 1.1px at 280px 230px,rgba(52,211,153,.38) 50%,transparent 51%),
        radial-gradient(.9px .9px at 120px 280px,rgba(190,200,255,.3) 50%,transparent 51%)}
    @keyframes vcbDrift1{from{background-position:0 0}to{background-position:-240px 240px}}
    @keyframes vcbDrift2{from{background-position:0 0}to{background-position:320px 320px}}
    /* iOS composites blurred, animated layers far more slowly than Android. The
       look survives; the endless GPU work does not (owner reported lag while
       typing, iOS only, 2026-07-19). */
    .vcb-panel.lite .vcb-neb{animation:none}
    .vcb-panel.lite .vcb-galaxy{animation:none}
    .vcb-panel.lite .vcb-starfield{animation:none}
    .vcb-panel.lite .vcb-twinkle{animation:none;opacity:.4}
    .vcb-panel.lite .vcb-orb-halo,.vcb-panel.lite .vcb-shoot{display:none}
    .vcb-twinkle{position:absolute;border-radius:50%;background:#fff;will-change:opacity,transform;
      animation:vcbTwinkle ease-in-out infinite}
    @keyframes vcbTwinkle{0%,100%{opacity:.12;transform:scale(.8)}50%{opacity:.85;transform:scale(1.25)}}
    .vcb-shoot{position:absolute;top:12%;left:-30%;width:110px;height:1.5px;border-radius:2px;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.85),rgba(52,211,153,.9),transparent);
      transform:rotate(24deg);opacity:0;animation:vcbShoot 17s linear infinite;animation-delay:6s}
    .vcb-shoot.sh2{top:58%;left:-35%;width:80px;animation-duration:23s;animation-delay:14s;transform:rotate(18deg)}

    /* ——— the solar system ——— */
    .vcb-solar{position:absolute;left:50%;top:52%;width:0;height:0}
    .vcb-sun{position:absolute;left:0;top:0;width:30px;height:30px;border-radius:50%;
      transform:translate(-50%,-50%);
      background:radial-gradient(circle at 38% 34%,#fff6d8 0%,#ffd76b 38%,#f2a63a 68%,#c96f1e 100%);
      animation:vcbSun 7s ease-in-out infinite alternate}
    @keyframes vcbSun{
      from{box-shadow:0 0 18px 4px rgba(255,196,84,.55),0 0 60px 18px rgba(242,166,58,.22)}
      to{box-shadow:0 0 26px 7px rgba(255,196,84,.75),0 0 84px 26px rgba(242,166,58,.3)}}
    .vcb-orbit{position:absolute;left:0;top:0;transform:translate(-50%,-50%);
      border:1px solid rgba(255,255,255,.09);border-radius:50%;
      animation:vcbSpin linear infinite;will-change:transform}
    @keyframes vcbSpin{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}
    .vcb-planet{position:absolute;left:50%;top:0;transform:translate(-50%,-50%);border-radius:50%}
    .vcb-planet.saturn::after{content:"";position:absolute;left:50%;top:50%;
      width:210%;height:210%;transform:translate(-50%,-50%) rotate(24deg) scaleY(.32);
      border:1.6px solid rgba(236,208,142,.65);border-radius:50%}
    .vcb-moon{position:absolute;left:50%;top:50%;width:15px;height:15px;margin:-7.5px 0 0 -7.5px;
      animation:vcbSpin 6s linear infinite}
    .vcb-moon::after{content:"";position:absolute;left:50%;top:0;width:2.2px;height:2.2px;
      transform:translate(-50%,-50%);border-radius:50%;background:#d8d5cc}
    @keyframes vcbShoot{
      0%{transform:translate(0,0) rotate(24deg);opacity:0}
      1.2%{opacity:.9}
      5%{transform:translate(560px,240px) rotate(24deg);opacity:0}
      100%{transform:translate(560px,240px) rotate(24deg);opacity:0}}

    .vcb-head{position:relative;z-index:2;padding:13px 18px;display:flex;justify-content:space-between;align-items:center;
      background:linear-gradient(135deg,rgba(10,10,14,.92),rgba(0,0,0,.85));
      backdrop-filter:blur(6px);border-bottom:1px solid rgba(52,211,153,.22)}
    .vcb-head-left{display:flex;align-items:center;gap:11px}
    .vcb-head-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;margin-top:-2px}
    .vcb-head-btns{display:flex;align-items:center;gap:8px}
    .vcb-credit{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;
      color:#b8f5dc;border:1px solid rgba(52,211,153,.45);border-radius:999px;padding:2px 9px;white-space:nowrap;
      background:rgba(52,211,153,.08)}
    .vcb-credit.low{color:#ffcf8a;border-color:rgba(255,184,77,.6);background:rgba(255,184,77,.1)}
    .vcb-ava{width:36px;height:36px;border-radius:50%;flex-shrink:0;font-size:17px;
      display:flex;align-items:center;justify-content:center;color:#b8f5dc;
      background:radial-gradient(circle at 35% 30%,#1c1c26,#0a0a10);
      box-shadow:0 0 0 1.5px rgba(52,211,153,.55),0 0 14px rgba(52,211,153,.25)}
    .vcb-title{font-weight:700;font-size:15px;line-height:1.2;color:#fff}
    .vcb-sub{font-size:11.5px;color:rgba(255,236,182,.75);font-weight:400;margin-top:1px}
    .vcb-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.85}
    .vcb-close:hover{opacity:1}

    /* A drop of light where the seeker touched. Floats ABOVE everything and is
       never inside the control, so it cannot clip a rounded edge or fight an
       existing animation. Colour is taken from whatever was tapped, so gold
       buttons bloom gold and the green chips bloom green. */
    .vcb-tapglow{position:absolute;pointer-events:none;z-index:12;width:40px;height:40px;
      margin:-20px 0 0 -20px;border-radius:50%;border:2px solid currentColor;
      animation:vcbTapGlow .5s cubic-bezier(.22,.61,.36,1) forwards}
    /* A ring that spreads from the fingertip and thins as it goes — a ripple,
       which reads as touch far more clearly than a glow (owner's call). The
       faint fill inside gives it body without turning it back into a blob. */
    @keyframes vcbTapGlow{
      0%{transform:scale(.25);opacity:.9;border-width:2.5px}
      100%{transform:scale(3);opacity:0;border-width:.5px}}
    @media (prefers-reduced-motion:reduce){.vcb-tapglow{animation-duration:.01s}}
    .vcb-openin{display:flex;align-items:center;gap:8px;justify-content:center;
      padding:7px 12px;margin:0 10px 4px;border-radius:9px;
      background:rgba(217,169,79,.10);border:1px solid rgba(217,169,79,.30);
      color:#f0dbb0;font-size:12px;line-height:1.35;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-openin[hidden]{display:none}
    .vcb-openin button{background:none;border:0;color:#e8cf9a;cursor:pointer;
      font-size:13px;line-height:1;padding:2px 4px;opacity:.7}
    .vcb-openin button:hover{opacity:1}
    /* the docked blessing strip */
    .vcb-bless{position:relative;z-index:2;text-align:center;padding:6px 0 7px;
      font-family:Georgia,'Noto Serif Devanagari',serif;font-size:15px;font-weight:700;
      letter-spacing:.06em;border-bottom:1px solid rgba(52,211,153,.14);
      background:linear-gradient(90deg,transparent,rgba(52,211,153,.07),transparent);
      opacity:0;transition:opacity .6s ease}
    .vcb-bless.show{opacity:1}
    .vcb-bless span{background:linear-gradient(100deg,#0e7a54 0%,#b8f5dc 28%,#34d399 50%,#b8f5dc 72%,#0e7a54 100%);
      background-size:220% 100%;-webkit-background-clip:text;background-clip:text;
      -webkit-text-fill-color:transparent;animation:vcbShimmer 4.5s linear infinite}
    @keyframes vcbShimmer{from{background-position:220% 0}to{background-position:-220% 0}}

    .vcb-msgs{position:relative;z-index:1;flex:1;overflow-y:auto;padding:16px 14px;
      display:flex;flex-direction:column;gap:10px}
    .vcb-msgs::-webkit-scrollbar{width:6px}
    .vcb-msgs::-webkit-scrollbar-thumb{background:rgba(52,211,153,.25);border-radius:3px}
    .vcb-m{max-width:86%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.55;
      white-space:pre-wrap;word-wrap:break-word;animation:vcbMsgIn .3s ease both}
    @keyframes vcbMsgIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}
    .vcb-m.user{align-self:flex-end;color:#04231a;font-weight:500;
      background:linear-gradient(135deg,#b8f5dc,#2bbd85);
      border-bottom-right-radius:5px;box-shadow:0 3px 12px rgba(52,211,153,.25)}
    .vcb-m.bot{align-self:flex-start;color:#eeeafc;
      background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.09);
      border-bottom-left-radius:5px;backdrop-filter:blur(3px)}
    .vcb-src{font-size:12px;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(52,211,153,.3);color:#9d96c4}
    .vcb-src a,.vcb-ans a{color:#34d399;text-decoration:none;font-weight:500}
    .vcb-src a:hover,.vcb-ans a:hover{text-decoration:underline}
    .vcb-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;width:100%;
      animation:vcbMsgIn .3s ease both}
    .vcb-chip{background:rgba(52,211,153,.09);border:1px solid rgba(52,211,153,.4);color:#b8f5dc;
      border-radius:999px;padding:10px 15px;font-size:13.5px;cursor:pointer;text-align:left;
      line-height:1.35;font-family:inherit;max-width:100%}
    .vcb-chip:hover{background:rgba(52,211,153,.18)}

    .vcb-form{position:relative;z-index:2;display:flex;gap:8px;padding:12px;
      border-top:1px solid rgba(52,211,153,.16);background:rgba(2,2,6,.65)}
    .vcb-mic{width:42px;height:42px;flex-shrink:0;border-radius:12px;cursor:pointer;
      border:1.5px solid rgba(52,211,153,.45);background:rgba(52,211,153,.08);
      display:flex;align-items:center;justify-content:center;transition:all .2s}
    .vcb-mic:hover{background:rgba(52,211,153,.18)}
    .vcb-mic svg{width:19px;height:19px;stroke:#34d399}
    .vcb-mic.listening{background:linear-gradient(135deg,#b8f5dc,#2bbd85);
      animation:vcbMicPulse 1.1s ease-in-out infinite}
    .vcb-mic.listening svg{stroke:#04231a}
    @keyframes vcbMicPulse{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.55)}50%{box-shadow:0 0 0 9px rgba(52,211,153,0)}}
    .vcb-voice{background:none;border:none;cursor:pointer;font-size:16px;line-height:1;
      opacity:.85;margin-right:10px;padding:2px}
    .vcb-voice:hover{opacity:1}
    .vcb-input{flex:1;border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);
      color:#f2eefe;border-radius:12px;padding:10px 13px;font-size:14px;outline:none;transition:border-color .15s}
    .vcb-input::placeholder{color:#9aa0ab}
    .vcb-input:focus{border-color:#34d399}
    .vcb-send{background:linear-gradient(135deg,#b8f5dc,#2bbd85);color:#04231a;border:none;border-radius:12px;
      padding:0 17px;font-size:14px;font-weight:700;cursor:pointer;transition:filter .15s;
      box-shadow:0 2px 10px rgba(52,211,153,.3)}
    .vcb-send:hover{filter:brightness(1.06)}
    .vcb-send:disabled{opacity:.5;cursor:default}

    /* ——— bottom menu: Guide (ask) ↔ Chats (24h history) ——— */
    .vcb-nav{position:relative;z-index:4;display:flex;flex-shrink:0;
      border-top:1px solid rgba(52,211,153,.18);background:rgba(2,2,6,.9)}
    .vcb-nav button{position:relative;flex:1;background:none;border:none;cursor:pointer;
      color:#7f8794;font-size:11px;font-weight:600;letter-spacing:.3px;
      padding:7px 4px calc(6px + env(safe-area-inset-bottom));
      display:flex;flex-direction:column;align-items:center;gap:3px;transition:color .18s;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-nav button .ic{font-size:17px;line-height:1;transition:transform .18s}
    .vcb-nav button:hover{color:#c9cdd6}
    .vcb-nav button.on{color:#f3d795}
    .vcb-nav button.on .ic{transform:translateY(-1px);filter:drop-shadow(0 0 7px rgba(243,215,149,.55))}
    .vcb-nav button.on::before{content:"";position:absolute;top:0;left:50%;transform:translateX(-50%);
      width:26px;height:2px;border-radius:0 0 3px 3px;background:linear-gradient(90deg,#f7e3ae,#d9a94f)}
    .vcb-nav .nb-dot{position:absolute;top:6px;right:calc(50% - 20px);width:6px;height:6px;border-radius:50%;
      background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.8);display:none}
    .vcb-nav .nb-dot.show{display:block}

    /* ——— Chats view (the seeker's own 24h history, on this phone only) ——— */
    .vcb-chats{display:none}
    .vcb-panel[data-view="chats"] .vcb-stage,
    .vcb-panel[data-view="chats"] .vcb-msgs,
    .vcb-panel[data-view="chats"] .vcb-form{display:none !important}
    .vcb-panel[data-view="chats"] .vcb-chats{position:relative;z-index:2;flex:1;
      display:flex;flex-direction:column;min-height:0}
    .vcb-chats-top{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;
      padding:9px 14px 8px;border-bottom:1px solid rgba(255,255,255,.06)}
    .vcb-chats-top h4{margin:0;font-size:13.5px;font-weight:700;color:#f3d795;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-chats-top .sub{font-size:10.5px;color:#7f8794;margin-top:1px}
    .vcb-chats-clear{background:none;border:none;color:#8b93a0;font-size:12px;cursor:pointer;padding:4px}
    .vcb-chats-clear:hover{color:#ffcf8a}
    .vcb-chats-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding:12px 12px 16px;
      display:flex;flex-direction:column;gap:9px;min-height:0}
    .vcb-cgap{align-self:center;font-size:10.5px;color:#6f7683;letter-spacing:.5px;
      margin:6px 0 2px;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-cbubble{max-width:82%;padding:9px 12px;border-radius:15px;font-size:13.5px;line-height:1.5;
      white-space:pre-wrap;word-wrap:break-word;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-cbubble.u{align-self:flex-end;color:#f7e9c9;background:rgba(217,169,79,.15);
      border:1px solid rgba(217,169,79,.32);border-bottom-right-radius:5px;cursor:pointer}
    .vcb-cbubble.u:hover{background:rgba(217,169,79,.24)}
    .vcb-cbubble.b{align-self:flex-start;color:#e9dfc6;background:rgba(52,211,153,.08);
      border:1px solid rgba(52,211,153,.16);border-bottom-left-radius:5px}
    .vcb-ctime{align-self:inherit;font-size:9.5px;color:#666d78;margin:-4px 3px 2px}
    .vcb-chats-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
      text-align:center;color:#8b93a0;padding:24px;gap:8px}
    .vcb-chats-empty .em-ic{font-size:30px;opacity:.5}
    .vcb-chats-empty p{margin:0;font-size:13px;line-height:1.5;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-chats-empty .go{margin-top:6px;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.4);
      color:#b8f5dc;border-radius:999px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer}

    .vcb-typing{align-self:flex-start;display:flex;gap:5px;padding:12px 16px;
      background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.09);
      border-radius:16px;border-bottom-left-radius:5px}
    .vcb-typing i{width:7px;height:7px;border-radius:50%;background:#34d399;opacity:.5;
      animation:vcbBounce 1.2s ease-in-out infinite}
    .vcb-typing i:nth-child(2){animation-delay:.15s}
    .vcb-typing i:nth-child(3){animation-delay:.3s}
    @keyframes vcbBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px);opacity:1}}

    /* ——— voice-first stage ——— */
    .vcb-panel[data-mode="voice"] .vcb-msgs,.vcb-panel[data-mode="voice"] .vcb-form{display:none}
    .vcb-panel[data-mode="text"] .vcb-stage{display:none}
    .vcb-stage{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;
      align-items:center;padding:12px 14px 14px;min-height:0}
    .vcb-cap{flex:1;width:100%;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:9px;
      align-items:center;padding:2px 2px 8px;min-height:0;position:relative}
    .vcb-cap>*{box-sizing:border-box}
    /* bottom-anchor via auto margin, NOT justify-content:flex-end — flex-end
       makes overflowing content above the top unreachable by scrolling */
    .vcb-cap>:first-child{margin-top:auto}
    .vcb-cap::-webkit-scrollbar{width:6px}
    .vcb-cap::-webkit-scrollbar-thumb{background:rgba(52,211,153,.25);border-radius:3px}
    .vcb-you{color:#b9b0e6;font-size:13px;text-align:center;max-width:95%;animation:vcbMsgIn .3s ease both}
    .vcb-ans{color:#f4f0ff;font-size:14.5px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;
      background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);border-radius:14px;
      padding:12px 14px;width:100%;animation:vcbMsgIn .3s ease both}
    .vcb-live{color:#b8f5dc;font-size:14.5px;text-align:center;min-height:20px;animation:vcbMsgIn .3s ease both}
    .vcb-orbbig{position:relative;width:96px;height:96px;border-radius:50%;border:none;cursor:pointer;
      flex-shrink:0;margin:8px 0 8px;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(circle at 34% 28%,#20202a 0%,#0d0d13 45%,#000 100%);
      box-shadow:0 0 0 2px rgba(52,211,153,.55),0 0 26px rgba(52,211,153,.3);transition:transform .2s}
    .vcb-orbbig:hover{transform:scale(1.05)}
    .vcb-mic-big{width:44px;height:44px;filter:drop-shadow(0 0 10px rgba(52,211,153,.5))}
    .vcb-orbbig::after{content:"";position:absolute;inset:-9px;border-radius:50%;border:2.5px solid transparent}
    .vcb-panel[data-vstate="listening"] .vcb-orbbig{animation:vcbMicPulse 1.1s ease-in-out infinite}
    .vcb-panel[data-vstate="thinking"] .vcb-orbbig::after{border-top-color:#34d399;border-right-color:rgba(52,211,153,.35);
      animation:vcbSpinFast 1s linear infinite}
    @keyframes vcbSpinFast{to{transform:rotate(360deg)}}
    .vcb-panel[data-vstate="speaking"] .vcb-orbbig{animation:vcbRippleGlow 1.5s ease-out infinite}
    @keyframes vcbRippleGlow{0%{box-shadow:0 0 0 2px rgba(52,211,153,.55),0 0 0 0 rgba(52,211,153,.4)}
      100%{box-shadow:0 0 0 2px rgba(52,211,153,.55),0 0 0 30px rgba(52,211,153,0)}}
    .vcb-status{color:#c9ccd6;font-size:13px;line-height:1.5;min-height:20px;text-align:center}
    .vcb-status b{color:#b8f5dc;font-weight:700}
    .vcb-stagebar{display:flex;gap:14px;align-items:center;margin-top:8px}
    .vcb-spacer{flex:1}
    .vcb-lang{background:rgba(255,255,255,.07);border:1px solid rgba(52,211,153,.45);color:#b8f5dc;
      border-radius:999px;padding:5px 13px;font-size:12px;font-weight:700;cursor:pointer;transition:background .15s}
    .vcb-lang:hover{background:rgba(52,211,153,.15)}
    .vcb-kbd{background:none;border:none;color:#9aa0ab;font-size:12.5px;cursor:pointer}
    .vcb-kbd:hover{color:#c9ccd6}

    /* ——— the blessing splash ——— */
    .vcb-splash{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:14px;pointer-events:none;
      background:radial-gradient(120% 90% at 50% 42%,#2a2560 0%,#1c1745 46%,#120e30 100%);
      transition:opacity .55s ease}
    .vcb-splash.fade{opacity:0}
    .vcb-splash-inner{display:flex;flex-direction:column;align-items:center;gap:14px;
      transition:transform .75s cubic-bezier(.5,0,.2,1),opacity .75s ease}
    .vcb-splash.dock .vcb-splash-inner{transform:translateY(-190px) scale(.42);opacity:0}
    .vcb-splash.dock{background:transparent}
    .vcb-splash-halo{position:absolute;width:280px;height:280px;border-radius:50%;
      background:radial-gradient(circle,rgba(52,211,153,.34) 0%,rgba(52,211,153,.08) 45%,transparent 70%);
      animation:vcbHalo 2s ease-out both}
    @keyframes vcbHalo{from{transform:scale(.35);opacity:0}45%{opacity:1}to{transform:scale(1.15);opacity:.85}}
    .vcb-splash-hi{display:flex;gap:.35em;font-size:37px;font-weight:800;z-index:1;
      font-family:Georgia,'Noto Serif Devanagari',serif}
    .vcb-splash-hi span{display:inline-block;opacity:0;
      background:linear-gradient(180deg,#b8f5dc 0%,#34d399 55%,#17996a 100%);
      -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
      text-shadow:0 0 26px rgba(52,211,153,.45);
      animation:vcbRise .7s cubic-bezier(.22,1,.36,1) both}
    @keyframes vcbRise{from{opacity:0;transform:translateY(24px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
    .vcb-splash-en{z-index:1;color:rgba(255,236,182,.85);font-size:12.5px;letter-spacing:.42em;
      font-weight:600;opacity:0;animation:vcbRise .7s .62s ease both;padding-left:.42em}
    .vcb-splash-line{z-index:1;width:64px;height:1px;opacity:0;
      background:linear-gradient(90deg,transparent,#34d399,transparent);
      animation:vcbRise .7s .78s ease both}
    .vcb-spark{position:absolute;bottom:-8px;border-radius:50%;pointer-events:none;
      background:radial-gradient(circle,#b8f5dc 0%,rgba(52,211,153,.85) 45%,transparent 75%);
      animation:vcbFloat linear both}
    @keyframes vcbFloat{
      0%{transform:translateY(0) scale(1);opacity:0}
      12%{opacity:.9}
      100%{transform:translateY(-560px) scale(.25);opacity:0}}

    @media (prefers-reduced-motion: reduce){
      .vcb-panel.open,.vcb-m,.vcb-splash-hi span,.vcb-splash-en,.vcb-splash-halo,.vcb-splash-line,.vcb-spark{animation:none !important;opacity:1}
      .vcb-btn::after,.vcb-bless span{animation:none}
      .vcb-spark,.vcb-shoot{display:none}
      .vcb-neb,.vcb-starfield,.vcb-twinkle,.vcb-galaxy,.vcb-orbit,.vcb-sun,.vcb-moon,.vcb-btn,.vcb-nudge.show{animation:none !important}
      .mg-mandala,.mg-spark,.mg-tw,.mg-fig,.mg-halo,.mg-heart,.mg-glow,.mg-aura,.mg-lrip,.mg-orbit,.mg-trays,.mg-mouth{animation:none !important}
    }

    /* ——— phones: the panel becomes a full-screen app ———
       (kept last so these win over the base rules above) */
    @media (max-width:640px){
      .vcb-panel{top:0;left:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;
        border-radius:0;transform-origin:center bottom}
      .vcb-head{padding-top:calc(12px + env(safe-area-inset-top))}
      .vcb-form{padding-bottom:calc(12px + env(safe-area-inset-bottom))}
      .vcb-input{font-size:16px} /* 16px+ stops iOS zooming into the field */
      .vcb-m{font-size:15px}
      .vcb-btn{bottom:calc(18px + env(safe-area-inset-bottom))}
      .vcb-nudge{bottom:calc(30px + env(safe-area-inset-bottom))}
      /* finger-sized touch targets (≥44px) for the stage controls */
      .vcb-kbd{font-size:15px;padding:12px 16px;min-height:44px}
      .vcb-lang{font-size:15px;padding:12px 18px;min-height:44px}
      .vcb-chip{min-height:42px;font-size:14px}
      /* once an answer is on screen, reading wins: compact mic, no solar
         clutter behind the text, the answer area runs down to the controls */
      .vcb-ans{font-size:16px}
      .vcb-you{font-size:14px}
      .vcb-panel[data-has-ans] .vcb-orbbig{width:56px;height:56px;margin:4px 0}
      .vcb-panel[data-has-ans] .vcb-mic-big{width:26px;height:26px}
      .vcb-panel[data-has-ans] .vcb-solar{display:none}
      .vcb-panel[data-has-ans] .vcb-spacer{flex:0 0 0px}
    }
    /* page behind the open panel must not scroll on phones */
    .vcb-lock,.vcb-lock body{overflow:hidden;overscroll-behavior:none;background:#070b08}

    /* ——— first-open: ask the seeker's name (kept only on this device) ——— */
    .vcb-namecard{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:13px;padding:30px 26px;text-align:center;
      background:rgba(3,3,8,.86);backdrop-filter:blur(7px)}
    .vcb-namecard h4{color:#eae6fb;font-size:18px;font-weight:700;line-height:1.4}
    .vcb-namecard p{color:#9d96c4;font-size:13px;line-height:1.5;max-width:300px}
    .vcb-namecard input{width:min(280px,84%);border:1.5px solid rgba(52,211,153,.45);
      background:rgba(255,255,255,.07);color:#f2eefe;border-radius:12px;padding:13px 14px;
      font-size:16px;text-align:center;outline:none}
    .vcb-namecard input:focus{border-color:#34d399}
    .vcb-namego{border:none;border-radius:12px;padding:12px 26px;font-size:15px;font-weight:700;
      cursor:pointer;color:#04140c;background:linear-gradient(135deg,#5eead4,#34d399)}
    .vcb-nameskip{background:none;border:none;color:#9aa0ab;font-size:13px;cursor:pointer;padding:8px}

    /* ═══ देवालय GOLD — the chosen theme (design/option-A-devotional-gold.html).
       Pure re-skin layered over the base rules above: every feature and all
       layout/behavior rules stay untouched; only colors, light and ornament. ═══ */
    .vcb-panel{background:
      radial-gradient(130% 50% at 50% -6%,rgba(217,169,79,.16) 0%,transparent 58%),
      radial-gradient(100% 42% at 50% 110%,rgba(217,169,79,.20) 0%,transparent 55%),
      linear-gradient(180deg,#0a110b 0%,#070b08 50%,#0a0d07 100%);
      box-shadow:0 22px 70px rgba(5,8,4,.7),0 0 0 1px rgba(227,183,102,.26)}
    .vcb-neb.n1{background:radial-gradient(ellipse at 40% 45%,rgba(217,169,79,.09) 0%,rgba(255,255,255,.03) 45%,transparent 72%)}
    .vcb-neb.n2{background:radial-gradient(ellipse at 55% 50%,rgba(217,169,79,.08) 0%,rgba(154,220,180,.05) 40%,transparent 70%)}
    .vcb-starfield{filter:sepia(.45) hue-rotate(-18deg) brightness(1.02)}
    .vcb-shoot{background:linear-gradient(90deg,transparent,rgba(255,244,214,.85),rgba(217,169,79,.9),transparent)}
    .vcb-solar{display:none}
    .vcb-mandala{position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);opacity:.15;pointer-events:none;
      animation:vcbGalaxy 900s linear infinite}
    .vcb-temple{position:absolute;left:0;right:0;bottom:0;width:100%;pointer-events:none;opacity:.9}
    .vcb-panel[data-mode="text"] .vcb-temple,.vcb-panel[data-has-ans] .vcb-mandala{display:none}
    .vcb-title{font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif;font-size:17px;letter-spacing:.4px;
      background:linear-gradient(180deg,#f7e3ae 20%,#d9a94f 85%);-webkit-background-clip:text;background-clip:text;color:transparent}
    .vcb-sub{color:#a89b7d}
    .vcb-credit{color:#f3d795;border-color:rgba(227,183,102,.5);background:linear-gradient(160deg,rgba(217,169,79,.16),rgba(217,169,79,.05))}
    .vcb-credit.low{color:#ffcf8a;border-color:rgba(255,184,77,.65);background:rgba(255,184,77,.12)}
    .vcb-ava{background:radial-gradient(circle at 34% 28%,#232d1d 0%,#0d130c 70%);
      box-shadow:0 0 0 1px rgba(227,183,102,.55),0 0 0 4px rgba(227,183,102,.10),0 0 20px rgba(217,169,79,.35)}
    .vcb-ava img{filter:sepia(1) saturate(2.1) hue-rotate(-10deg) brightness(1.16) drop-shadow(0 0 6px rgba(243,215,149,.5))}
    .vcb-bless span{background:linear-gradient(100deg,#a97c2c 0%,#f7e3ae 28%,#d9a94f 52%,#f7e3ae 74%,#a97c2c 100%);
      -webkit-background-clip:text;background-clip:text;color:transparent;
      text-shadow:none;font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif;letter-spacing:1px}
    .vcb-bless::before{content:"✦";color:#d9a94f;font-size:10px;margin-right:12px;opacity:.85;vertical-align:2px}
    .vcb-bless::after{content:"✦";color:#d9a94f;font-size:10px;margin-left:12px;opacity:.85;vertical-align:2px}
    .vcb-orbbig{background:radial-gradient(circle at 33% 26%,#2b3722 0%,#121a10 52%,#080d08 100%);
      box-shadow:0 0 0 2.5px rgba(243,215,149,.8),0 0 40px rgba(217,169,79,.42),inset 0 0 28px rgba(217,169,79,.14)}
    .vcb-panel[data-vstate="thinking"] .vcb-orbbig::after{border-top-color:#f3d795;border-right-color:rgba(217,169,79,.4)}
    @keyframes vcbMicPulse{0%,100%{box-shadow:0 0 0 2.5px rgba(243,215,149,.8),0 0 30px rgba(217,169,79,.35)}
      50%{box-shadow:0 0 0 3px rgba(243,215,149,.95),0 0 60px rgba(217,169,79,.6)}}
    @keyframes vcbRippleGlow{0%{box-shadow:0 0 0 2.5px rgba(243,215,149,.8),0 0 0 0 rgba(217,169,79,.4)}
      100%{box-shadow:0 0 0 2.5px rgba(243,215,149,.8),0 0 0 30px rgba(217,169,79,0)}}
    .vcb-mic-big{filter:drop-shadow(0 0 10px rgba(243,215,149,.6))}
    .vcb-status{color:#ddd1ab;font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif}
    .vcb-status b{color:#f3d795}
    .vcb-lang{border-color:rgba(227,183,102,.5);color:#f3d795;
      background:linear-gradient(160deg,rgba(217,169,79,.13),rgba(217,169,79,.04));
      font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif}
    .vcb-kbd{color:#a89b7d}
    .vcb-you{color:#cfc3a0}
    .vcb-live{color:#f0e3bd}
    .vcb-ans{position:relative;background:rgba(20,30,21,.74);border:none;border-radius:18px;
      box-shadow:inset 0 0 0 1px rgba(227,183,102,.20),0 12px 30px rgba(0,0,0,.38);
      font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif;font-size:15px;line-height:1.75;color:#f5edda}
    .vcb-ans::before{content:"";position:absolute;left:-1px;top:-1px;width:20px;height:20px;pointer-events:none;
      border-left:1.5px solid #d9a94f;border-top:1.5px solid #d9a94f;border-top-left-radius:8px;opacity:.75}
    .vcb-ans::after{content:"";position:absolute;right:-1px;bottom:-1px;width:20px;height:20px;pointer-events:none;
      border-right:1.5px solid #d9a94f;border-bottom:1.5px solid #d9a94f;border-bottom-right-radius:17px;opacity:.75}
    .vcb-m.bot{background:rgba(20,30,21,.74);box-shadow:inset 0 0 0 1px rgba(227,183,102,.18);color:#f5edda;
      font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif;line-height:1.7}
    .vcb-m.you{background:linear-gradient(150deg,#245741,#1c4633);color:#eafaf0}
    .vcb-src{border-top:1px dashed rgba(227,183,102,.32);color:#a89b7d;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-src a,.vcb-ans a{color:#e8c987}
    .vcb-chip{border-color:rgba(154,220,180,.42);color:#9adcb4;background:rgba(154,220,180,.07);
      box-shadow:0 3px 10px rgba(0,0,0,.25)}
    .vcb-chip:hover{background:rgba(154,220,180,.15)}
    .vcb-input{border-color:rgba(227,183,102,.32);background:rgba(15,24,16,.9);color:#f5edda}
    .vcb-input:focus{border-color:#d9a94f}
    .vcb-input::placeholder{color:#a89b7d}
    .vcb-send{background:linear-gradient(140deg,#f7e3ae,#d9a94f 70%);color:#1d1503;
      box-shadow:0 5px 16px rgba(217,169,79,.35),inset 0 1px 0 rgba(255,255,255,.5)}
    .vcb-mic{box-shadow:0 0 0 1.5px rgba(227,183,102,.55),0 0 12px rgba(217,169,79,.25)}
    .vcb-btn{box-shadow:0 6px 24px rgba(5,8,4,.55),0 0 0 1.5px rgba(227,183,102,.6),0 0 22px rgba(217,169,79,.35)}
    .vcb-nudge{background:linear-gradient(135deg,#f7e3ae,#d9a94f);color:#231a04;font-weight:700}
    .vcb-nudge::after{background:#d9a94f}
    .vcb-splash{background:
      radial-gradient(120% 90% at 50% 42%,rgba(217,169,79,.15) 0%,transparent 55%),
      radial-gradient(100% 45% at 50% 112%,rgba(217,169,79,.20) 0%,transparent 55%),
      linear-gradient(180deg,#0b120c 0%,#070b08 50%,#0a0e08 100%)}
    .vcb-splash-halo{background:radial-gradient(circle,rgba(217,169,79,.30) 0%,rgba(217,169,79,.08) 45%,transparent 70%)}
    .vcb-splash-line{background:linear-gradient(90deg,transparent,#d9a94f,transparent);position:relative}
    .vcb-splash-line::before,.vcb-splash-line::after{content:"";position:absolute;top:-2.5px;width:6px;height:6px;
      transform:rotate(45deg);background:#d9a94f;opacity:.9}
    .vcb-splash-line::before{left:-14px}
    .vcb-splash-line::after{right:-14px}
    .vcb-splash-en{color:#cbbd97}
    .vcb-splash-hi span{background:linear-gradient(100deg,#a97c2c 0%,#f7e3ae 30%,#d9a94f 55%,#f7e3ae 76%,#a97c2c 100%);
      -webkit-background-clip:text;background-clip:text;color:transparent}
    .vcb-spark{background:radial-gradient(circle,#f7e3ae 0%,rgba(217,169,79,.85) 45%,transparent 75%)}
    .vcb-namecard{background:rgba(5,7,4,.88)}
    .vcb-namecard h4{color:#f3d795;font-family:Georgia,'Kohinoor Devanagari','Devanagari MT',serif}
    .vcb-namecard p{color:#a89b7d}
    .vcb-namecard input{border-color:rgba(227,183,102,.5);color:#f5edda;background:rgba(217,169,79,.07)}
    .vcb-namecard input:focus{border-color:#d9a94f}
    .vcb-namego{background:linear-gradient(140deg,#f7e3ae,#d9a94f 70%);color:#1d1503}
    .vcb-ava{cursor:pointer}
    .vcb-delacc{border:1.5px solid rgba(255,157,118,.55);background:rgba(160,74,51,.12);color:#ff9d76;
      border-radius:12px;padding:11px 20px;font-size:13.5px;cursor:pointer}
    .vcb-delacc:hover{background:rgba(160,74,51,.22)}

    /* ——— Phase 2: quote, video cards, feedback, streak ——— */
    .vcb-quote{position:relative;margin-top:10px;border-radius:13px;padding:11px 13px 9px 36px;
      font-style:italic;color:#f2e5bf;font-size:14px;line-height:1.65;
      background:linear-gradient(150deg,rgba(217,169,79,.12),rgba(217,169,79,.03));
      box-shadow:inset 0 0 0 1px rgba(227,183,102,.35)}
    .vcb-quote::before{content:"❝";position:absolute;left:11px;top:4px;font-size:24px;color:#d9a94f;
      font-style:normal;font-family:Georgia,serif}
    .vcb-quote span{display:block;font-style:normal;font-size:10.5px;color:#a89b7d;margin-top:6px;letter-spacing:.4px}
    .vcb-quote span a{color:#e8c987;text-decoration:none}
    .vcb-lbl{color:#d9a94f;font-size:10.5px;letter-spacing:1.6px;font-weight:600;
      display:flex;align-items:center;gap:8px;margin-top:11px;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-lbl::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(227,183,102,.4),transparent)}
    /* Sources used to be video cards with a thumbnail. With the recordings gone
       they were three tall rows carrying an empty box and a book emoji — most of
       an phone screen for three links (owner, 2026-07-19). Now they are pills:
       gold = something to read, green = something to ask. */
    .vcb-srcs{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
    .vcb-srcs a,.vcb-srcs span.vcb-src1{display:inline-flex;align-items:center;gap:5px;
      max-width:100%;padding:5px 11px;border-radius:999px;text-decoration:none;
      font-size:12px;line-height:1.3;color:#f0dbb0;
      background:rgba(217,169,79,.10);border:1px solid rgba(217,169,79,.32);
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-srcs a:hover{background:rgba(217,169,79,.19)}
    .vcb-srcs b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
    .vcb-fb{display:flex;justify-content:space-around;border-top:1px solid rgba(227,183,102,.18);
      padding-top:9px;margin-top:11px}
    .vcb-fbb{display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;
      cursor:pointer;color:#a89b7d;font-size:10px;letter-spacing:.3px;padding:2px 8px;
      font-family:-apple-system,'Segoe UI',Roboto,sans-serif}
    .vcb-fbb i{font-style:normal;font-size:15px}
    .vcb-fbb em{font-style:normal}
    .vcb-fbb.on{color:#f3d795}
    .vcb-fbb:disabled{opacity:.45;cursor:default}
    .vcb-fbb.on:disabled{opacity:1}
    .vcb-streak{align-self:center;display:flex;align-items:center;gap:7px;border-radius:999px;
      padding:7px 14px;font-size:12px;color:#f3d795;background:rgba(217,169,79,.09);
      box-shadow:inset 0 0 0 1px rgba(227,183,102,.4);animation:vcbMsgIn .3s ease both}

    /* ——— notifications: header bell + one-time gentle ask ——— */
    .vcb-bell{background:none;border:none;cursor:pointer;font-size:16px;line-height:1;
      opacity:.38;padding:6px;transition:opacity .2s}
    .vcb-bell.on{opacity:1;filter:drop-shadow(0 0 8px rgba(243,215,149,.7))}
    .vcb-bellask{display:flex;flex-direction:column;gap:10px}
    .vcb-bellask p{margin:0;font-size:14px}
    /* the admin's in-bot notice — a card with a soft gold edge to set it apart */
    .vcb-notice{box-shadow:inset 3px 0 0 0 #d9a94f,inset 0 0 0 1px rgba(227,183,102,.28)}
    .vcb-bellrow{display:flex;gap:10px}
    .vcb-bellrow button{border:none;border-radius:11px;padding:10px 16px;font-size:13.5px;cursor:pointer;
      font-family:inherit}
    .vcb-bellyes{background:linear-gradient(140deg,#f7e3ae,#d9a94f 70%);color:#1d1503;font-weight:700}
    .vcb-bellno{background:none;color:#a89b7d;box-shadow:inset 0 0 0 1px rgba(227,183,102,.3)}
    .vcb-fixbox{display:flex;flex-direction:column;gap:9px;margin-top:11px;padding:12px;
      border-radius:13px;background:rgba(227,183,102,.06);box-shadow:inset 0 0 0 1px rgba(227,183,102,.22)}
    .vcb-fixbox p{margin:0;font-size:13px;line-height:1.6;color:#d8cdb3}
    .vcb-fixbox textarea{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;
      border:1px solid rgba(227,183,102,.3);border-radius:10px;background:rgba(0,0,0,.25);
      color:#f3ecd9;font-family:inherit;font-size:14px;padding:9px 11px;outline:none}

    /* ——— the guide: a meditating figure replacing the mic orb, animated by
       the voice state (idle=rest · listening · thinking=reflect · speaking) ——— */
    .vcb-orbbig{background:transparent!important;box-shadow:none!important;
      width:214px;height:208px;border-radius:0;overflow:visible;perspective:660px;
      -webkit-tap-highlight-color:transparent;outline:none;-webkit-user-select:none;user-select:none}
    .vcb-orbbig:focus,.vcb-orbbig:focus-visible{outline:none}
    .vcb-orbbig::after{display:none!important}
    .vcb-panel[data-vstate="listening"] .vcb-orbbig,
    .vcb-panel[data-vstate="thinking"] .vcb-orbbig,
    .vcb-panel[data-vstate="speaking"] .vcb-orbbig{animation:none!important;box-shadow:none!important}
    /* the conversation is saved in the Chats tab, so the stage keeps the guide BIG
       even while its answer shows — only a light trim so the answer has room */
    .vcb-panel[data-has-ans] .vcb-orbbig{width:196px!important;height:190px!important;margin:2px 0!important}
    .mg-svg{width:100%;height:100%;display:block;overflow:visible;pointer-events:none}
    /* the 3D tilt lives on an HTML wrapper — SVG elements ignore CSS 3D transforms */
    .mg-3d{display:block;width:100%;height:100%;transform-style:preserve-3d;will-change:transform;
      transform:rotateX(var(--mgtx,0deg)) rotateY(var(--mgty,0deg));transition:transform .28s ease}
    .mg-a{transform-box:fill-box;transform-origin:center}
    .mg-vb{transform-box:view-box}
    .mg-aura{opacity:.16;transition:opacity .6s ease}
    .mg-mandala{transform-box:view-box;transform-origin:130px 122px;opacity:.12;animation:mgSpin 34s linear infinite}
    .mg-spark{opacity:0;animation:mgFloat 3.4s ease-in-out infinite}
    .mg-tw{animation:mgTw 3s ease-in-out infinite}
    .mg-teye{transform:scaleY(.05);transition:transform .5s cubic-bezier(.2,.9,.3,1.4)}
    .mg-glow{opacity:0;transition:opacity .5s ease}
    .mg-mouth{transform:scaleY(.32);transition:transform .3s ease}
    .mg-halo,.mg-heart,.mg-lrip,.mg-orbit,.mg-trays{opacity:0}
    .mg-orbit{transform-box:view-box;transform-origin:130px 92px;transition:opacity .5s}
    .vcb-panel[data-vstate="idle"] .mg-fig,.vcb-panel[data-vstate="error"] .mg-fig{animation:mgBreathe 4.4s ease-in-out infinite}
    .vcb-panel[data-vstate="idle"] .mg-halo,.vcb-panel[data-vstate="error"] .mg-halo{opacity:.5;animation:mgHalo 2.6s ease-in-out infinite}
    .vcb-panel[data-vstate="idle"] .mg-heart,.vcb-panel[data-vstate="error"] .mg-heart{animation:mgHeart 4.4s ease-in-out infinite}
    .vcb-panel[data-vstate="listening"] .mg-teye,.vcb-panel[data-vstate="thinking"] .mg-teye,.vcb-panel[data-vstate="speaking"] .mg-teye{transform:scaleY(1)}
    .vcb-panel[data-vstate="listening"] .mg-glow{opacity:.8}
    .vcb-panel[data-vstate="thinking"] .mg-glow{opacity:.6;animation:mgGlow 1.7s ease-in-out infinite}
    .vcb-panel[data-vstate="speaking"] .mg-glow{opacity:.85;animation:mgGlow .7s ease-in-out infinite}
    .vcb-panel[data-vstate="listening"] .mg-aura,.vcb-panel[data-vstate="thinking"] .mg-aura{opacity:.46}
    .vcb-panel[data-vstate="speaking"] .mg-aura{opacity:.5;animation:mgAura .8s ease-in-out infinite}
    .vcb-panel[data-vstate="listening"] .mg-mandala,.vcb-panel[data-vstate="thinking"] .mg-mandala,.vcb-panel[data-vstate="speaking"] .mg-mandala{opacity:.28}
    .vcb-panel[data-vstate="listening"] .mg-lrip{animation:mgRip 2.1s ease-out infinite}
    .vcb-panel[data-vstate="listening"] .mg-lrip.r2{animation-delay:1.05s}
    .vcb-panel[data-vstate="thinking"] .mg-orbit{opacity:1;animation:mgSpin 3.6s linear infinite}
    .vcb-panel[data-vstate="speaking"] .mg-trays{animation:mgRay .7s ease-in-out infinite}
    .vcb-panel[data-vstate="speaking"] .mg-mouth{animation:mgTalk .34s ease-in-out infinite}
    .vcb-panel[data-vstate="speaking"] .mg-fig{animation:mgBob .5s ease-in-out infinite}
    .vcb-panel[data-vstate="listening"] .mg-spark,.vcb-panel[data-vstate="speaking"] .mg-spark{animation-duration:2.4s}
    @keyframes mgBreathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
    @keyframes mgBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
    @keyframes mgAura{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.68;transform:scale(1.05)}}
    @keyframes mgSpin{to{transform:rotate(360deg)}}
    @keyframes mgHalo{0%,100%{opacity:.22;transform:scale(1)}50%{opacity:.55;transform:scale(1.05)}}
    @keyframes mgHeart{0%,100%{opacity:.2}50%{opacity:.55}}
    @keyframes mgGlow{0%,100%{opacity:.5}50%{opacity:.95}}
    @keyframes mgTalk{0%,100%{transform:scaleY(.28)}50%{transform:scaleY(1.05)}}
    @keyframes mgRip{0%{transform:scale(.5);opacity:.5}100%{transform:scale(1.35);opacity:0}}
    @keyframes mgRay{0%,100%{opacity:.35;transform:scale(.9)}50%{opacity:.85;transform:scale(1.14)}}
    @keyframes mgFloat{0%{opacity:0;transform:translateY(8px)}25%{opacity:.85}80%{opacity:.4}100%{opacity:0;transform:translateY(-30px)}}
    @keyframes mgTw{0%,100%{opacity:.15}50%{opacity:.8}}
    .vcb-panel.lite .mg-mandala,.vcb-panel.lite .mg-spark,.vcb-panel.lite .mg-tw,
    .vcb-panel.lite .mg-orbit,.vcb-panel.lite .mg-lrip,.vcb-panel.lite .mg-trays{animation:none!important}
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "vcb-btn";
  btn.setAttribute("aria-label", "Open chat");
  btn.innerHTML = `<img class="vcb-logo" src="${API}/logo.png?v=3" alt="Ashaeiynn"/>`;

  // gentle invitation pill that slides out beside the orb
  const nudge = document.createElement("div");
  nudge.className = "vcb-nudge";
  nudge.textContent = "🙏 Ask Your Guide";
  nudge.setAttribute("role", "button");

  const panel = document.createElement("div");
  panel.className = EMBED ? "vcb-panel vcb-embed" : "vcb-panel";
  if (EMBED) document.body.classList.add("vcb-embedded"); // hides the launcher/nudge
  panel.innerHTML = `
    <div class="vcb-cosmos">
      <div class="vcb-galaxy">
        <div class="vcb-starfield s1"></div><div class="vcb-starfield s2"></div>
      </div>
      <div class="vcb-neb n1"></div><div class="vcb-neb n2"></div><div class="vcb-neb n3"></div>
      <div class="vcb-solar"></div>
      <svg class="vcb-mandala" width="340" height="340" viewBox="0 0 360 360" aria-hidden="true">
        <g fill="none" stroke="#e3b766">
          <circle cx="180" cy="180" r="170" stroke-width=".7" opacity=".5"/>
          <circle cx="180" cy="180" r="140" stroke-width=".6" stroke-dasharray="2 7" opacity=".7"/>
          <circle cx="180" cy="180" r="112" stroke-width=".6" opacity=".5"/>
          <g opacity=".65">
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(30 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(60 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(90 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(120 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(150 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(180 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(210 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(240 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(270 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(300 180 180)"/>
            <path d="M180 12 q14 26 0 52 q-14 -26 0 -52" stroke-width=".7" transform="rotate(330 180 180)"/>
          </g>
        </g>
      </svg>
      <svg class="vcb-temple" viewBox="0 0 375 190" height="150" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 190 L0 150 L30 150 L30 122 L52 122 L60 92 L68 122 L90 122 L90 150 L126 150 L126 106 L148 106 L158 62 L164 76 L170 40 L176 76 L182 62 L192 106 L214 106 L214 150 L252 150 L252 126 L270 126 L277 98 L284 126 L302 126 L302 150 L340 150 L340 160 L375 160 L375 190 Z"
          fill="#020403" opacity=".92"/>
        <circle cx="170" cy="33" r="3.4" fill="#f3d795" opacity=".95"/>
        <circle cx="60" cy="86" r="2.2" fill="#e3b766" opacity=".8"/>
        <circle cx="277" cy="92" r="2.2" fill="#e3b766" opacity=".8"/>
        <g opacity=".9">
          <ellipse cx="120" cy="176" rx="3" ry="4.5" fill="#ffb84d"/>
          <ellipse cx="240" cy="180" rx="3" ry="4.5" fill="#ffb84d"/>
          <ellipse cx="330" cy="172" rx="2.6" ry="4" fill="#ffb84d"/>
          <ellipse cx="44" cy="180" rx="2.6" ry="4" fill="#ffb84d"/>
        </g>
      </svg>
      <span class="vcb-shoot"></span><span class="vcb-shoot sh2"></span>
    </div>
    <div class="vcb-head">
      <div class="vcb-head-left">
        <div class="vcb-ava"><img src="${API}/logo.png?v=3" alt=""/></div>
        <div><div class="vcb-title">${TITLE}</div><div class="vcb-sub">Ashaeiynn · answers from the teachings</div></div>
      </div>
      <div class="vcb-head-right">
        <div class="vcb-head-btns"><button class="vcb-bell" aria-label="Reminders" title="Reminders on special occasions">🔔</button><button class="vcb-voice" aria-label="Voice replies" title="Voice replies">🔇</button></div>
        <span class="vcb-credit" title="आज के बचे प्रश्न · questions left today" hidden>🪙 <b>0</b></span>
      </div>
    </div>
    <div class="vcb-bless"><span>${SPLASH}</span></div>
    <div class="vcb-openin" hidden><span></span><button type="button" aria-label="Dismiss">✕</button></div>
    <div class="vcb-stage">
      <div class="vcb-cap"></div>
      <button class="vcb-orbbig" type="button" aria-label="Ask by voice">
        <span class="mg-3d">
        <svg class="mg-svg" viewBox="0 0 260 250" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <radialGradient id="e-aura" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#d9a94f" stop-opacity=".5"/><stop offset="100%" stop-color="#d9a94f" stop-opacity="0"/></radialGradient>
            <radialGradient id="e-glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#9dffdf" stop-opacity="1"/><stop offset="55%" stop-color="#34d399" stop-opacity=".55"/><stop offset="100%" stop-color="#34d399" stop-opacity="0"/></radialGradient>
            <radialGradient id="e-heart" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#f3d795" stop-opacity=".8"/><stop offset="100%" stop-color="#f3d795" stop-opacity="0"/></radialGradient>
          </defs>
          <circle class="mg-tw" cx="206" cy="40" r="1.4" fill="#f3d795" style="animation-delay:.2s"/>
          <circle class="mg-tw" cx="48" cy="58" r="1.1" fill="#b8f5dc" style="animation-delay:1.1s"/>
          <circle class="mg-tw" cx="40" cy="176" r="1.2" fill="#f3d795" style="animation-delay:1.9s"/>
          <circle class="mg-tw" cx="222" cy="168" r="1.1" fill="#b8f5dc" style="animation-delay:.7s"/>
          <circle class="mg-mandala mg-vb" cx="130" cy="122" r="96" fill="none" stroke="#d9a94f" stroke-width="1" stroke-dasharray="2 9"/>
          <circle class="mg-a mg-aura" cx="130" cy="122" r="88" fill="url(#e-aura)"/>
          <circle class="mg-a mg-halo" cx="130" cy="122" r="76" fill="none" stroke="#d9a94f" stroke-opacity=".4"/>
          <circle class="mg-a mg-lrip" cx="130" cy="122" r="60" fill="none" stroke="#34d399" stroke-opacity=".6"/>
          <circle class="mg-a mg-lrip r2" cx="130" cy="122" r="60" fill="none" stroke="#7ce0be" stroke-opacity=".5"/>
          <g class="mg-orbit mg-vb"><circle cx="130" cy="46" r="2.6" fill="#f3d795"/><circle cx="170" cy="114" r="2.6" fill="#34d399"/><circle cx="90" cy="114" r="2.6" fill="#b8f5dc"/></g>
          <circle class="mg-a mg-heart" cx="130" cy="150" r="20" fill="url(#e-heart)"/>
          <g class="mg-a mg-fig">
            <ellipse cx="130" cy="182" rx="62" ry="17" fill="#151008" stroke="#d9a94f" stroke-opacity=".5"/>
            <path d="M94,172 Q130,190 166,172" fill="none" stroke="#d9a94f" stroke-opacity=".45"/>
            <path d="M97,174 Q130,114 163,174 Z" fill="#1b150b" stroke="#d9a94f" stroke-opacity=".55"/>
            <circle cx="130" cy="92" r="25" fill="#1d160c" stroke="#d9a94f" stroke-opacity=".8"/>
            <path d="M108,78 Q130,62 152,78" fill="none" stroke="#d9a94f" stroke-opacity=".6"/>
            <circle cx="130" cy="66" r="5" fill="#241b0d" stroke="#d9a94f" stroke-opacity=".6"/>
            <path d="M116,98 q6,5 12,0" fill="none" stroke="#f3d795" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M132,98 q6,5 12,0" fill="none" stroke="#f3d795" stroke-width="1.6" stroke-linecap="round"/>
            <path class="mg-a mg-mouth" d="M123,108 q7,4 14,0" fill="none" stroke="#c98a4e" stroke-width="1.6" stroke-linecap="round"/>
            <g class="mg-a mg-trays" stroke="#9dffdf" stroke-width="1.3" stroke-linecap="round" opacity=".7">
              <line x1="130" y1="70" x2="130" y2="62"/><line x1="130" y1="86" x2="130" y2="94"/><line x1="122" y1="78" x2="114" y2="78"/><line x1="138" y1="78" x2="146" y2="78"/>
              <line x1="124" y1="72" x2="118" y2="66"/><line x1="136" y1="72" x2="142" y2="66"/><line x1="124" y1="84" x2="118" y2="90"/><line x1="136" y1="84" x2="142" y2="90"/>
            </g>
            <circle class="mg-a mg-glow" cx="130" cy="78" r="16" fill="url(#e-glow)"/>
            <g class="mg-a mg-teye">
              <path d="M119,78 Q130,70 141,78 Q130,86 119,78 Z" fill="#0c1a14" stroke="#f3d795" stroke-width="1.4"/>
              <circle cx="130" cy="78" r="3.4" fill="#34d399"/><circle cx="128.6" cy="76.6" r="1.1" fill="#eafff6"/>
            </g>
          </g>
          <circle class="mg-a mg-spark" cx="92" cy="180" r="1.7" fill="#f3d795" style="animation-delay:0s"/>
          <circle class="mg-a mg-spark" cx="168" cy="180" r="1.5" fill="#e8c877" style="animation-delay:1.2s"/>
          <circle class="mg-a mg-spark" cx="104" cy="186" r="1.4" fill="#b8f5dc" style="animation-delay:2.1s"/>
          <circle class="mg-a mg-spark" cx="156" cy="186" r="1.6" fill="#f3d795" style="animation-delay:.6s"/>
          <circle class="mg-a mg-spark" cx="130" cy="190" r="1.5" fill="#e8c877" style="animation-delay:1.7s"/>
        </svg>
        </span>
      </button>
      <div class="vcb-spacer"></div>
      <div class="vcb-status"></div>
      <div class="vcb-stagebar">
        <button class="vcb-lang" type="button">भाषा: हिंदी</button>
        <button class="vcb-kbd" type="button">⌨️ type instead</button>
      </div>
    </div>
    <div class="vcb-msgs"></div>
    <form class="vcb-form">
      <button class="vcb-mic" type="button" aria-label="Speak your question" title="Speak your question">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/>
        </svg>
      </button>
      <input class="vcb-input" type="text" placeholder="Type your question…" maxlength="2000" autocomplete="off"/>
      <button class="vcb-send" type="submit">Send</button>
    </form>
    <div class="vcb-chats">
      <div class="vcb-chats-top">
        <div>
          <h4>आपकी बातचीत · Your chats</h4>
          <div class="sub">इसी फ़ोन पर 24 घंटे तक सुरक्षित 🙏</div>
        </div>
        <button class="vcb-chats-clear" type="button">मिटाएँ</button>
      </div>
      <div class="vcb-chats-scroll"></div>
    </div>
    <nav class="vcb-nav">
      <button type="button" data-nav="guide" class="on"><span class="ic">🎙️</span>Guide</button>
      <button type="button" data-nav="chats"><span class="ic">💬</span>Chats<span class="nb-dot"></span></button>
    </nav>`;

  document.body.append(btn, nudge, panel);

  // invitation timing: appear after 3s, retire after 15s or when the chat opens
  const hideNudge = () => nudge.classList.remove("show");
  setTimeout(() => {
    if (!panel.classList.contains("open")) nudge.classList.add("show");
    setTimeout(hideNudge, 15000);
  }, 3000);
  nudge.addEventListener("click", () => {
    hideNudge();
    toggle(true);
  });

  // build the solar system: sun + eight planets on their own orbits and speeds
  const solar = panel.querySelector(".vcb-solar");
  solar.innerHTML = '<div class="vcb-sun"></div>';
  const PLANETS = [
    { name: "mercury", r: 30, size: 3.5, dur: 26, bg: "#c9b8a8" },
    { name: "venus", r: 44, size: 5.5, dur: 40, bg: "#eac57e" },
    { name: "earth", r: 60, size: 6.5, dur: 55, bg: "radial-gradient(circle at 35% 35%,#8fd0ff 0%,#3f8fe0 55%,#1d5fae 100%)", moon: true },
    { name: "mars", r: 77, size: 5, dur: 74, bg: "#e2694a" },
    { name: "jupiter", r: 103, size: 13, dur: 105, bg: "radial-gradient(circle at 35% 30%,#e8c49a 0%,#cf9a5e 50%,#a8713c 100%)" },
    { name: "saturn", r: 132, size: 11, dur: 135, bg: "radial-gradient(circle at 35% 30%,#f2e0b0 0%,#e0be7e 60%,#b8934f 100%)" },
    { name: "uranus", r: 162, size: 7.5, dur: 170, bg: "#a4dbe2" },
    { name: "neptune", r: 194, size: 7.5, dur: 205, bg: "#6b83ee" },
  ];
  PLANETS.forEach((p, i) => {
    const orbit = document.createElement("div");
    orbit.className = "vcb-orbit";
    orbit.style.cssText = `width:${p.r * 2}px;height:${p.r * 2}px;` +
      `animation-duration:${p.dur}s;animation-delay:-${(p.dur * (i * 0.37 % 1)).toFixed(1)}s`;
    const planet = document.createElement("div");
    planet.className = `vcb-planet ${p.name}`;
    planet.style.cssText = `width:${p.size}px;height:${p.size}px;background:${p.bg};` +
      `box-shadow:0 0 ${Math.max(4, p.size)}px rgba(255,255,255,.28)`;
    if (p.moon) planet.innerHTML = '<span class="vcb-moon"></span>';
    orbit.appendChild(planet);
    solar.appendChild(orbit);
  });

  // scatter twinkling stars over the cosmos, each with its own rhythm
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isApple) panel.classList.add("lite");

  // Feedback on every tap, in ONE place rather than button by button.
  // Capture phase, so it fires even if a handler stops the event.
  //
  // DELIBERATE EXCEPTION: the tap that OPENS the microphone stays silent. A tone
  // at that instant would either be recorded as part of the seeker's question or
  // disturb iOS's audio session just as the recorder starts — the failure that
  // silenced the mic earlier today. Stopping the mic, and every other control,
  // gives feedback normally.
  panel.addEventListener(
    "click",
    (e) => {
      const hit = e.target.closest("button, .vcb-chip, .vcb-srcs a");
      if (!hit) return;
      // The light always blooms — it makes no sound and touches no audio
      // session, so even the tap that opens the microphone can have it. That
      // tap had no feedback at all until now.
      bloom(e, hit);
      if (hit.classList.contains("vcb-orbbig") && !listening) return; // opening the mic: no sound
      if (hit.classList.contains("vcb-mic") && !listening) return;
      tap();
    },
    true,
  );

  const cosmos = panel.querySelector(".vcb-cosmos");
  for (let i = 0; i < (isApple ? 6 : 16); i++) {
    const t = document.createElement("i");
    t.className = "vcb-twinkle";
    const size = 1 + Math.random() * 1.6;
    t.style.cssText =
      `left:${3 + Math.random() * 94}%;top:${3 + Math.random() * 94}%;` +
      `width:${size}px;height:${size}px;` +
      `animation-duration:${2.8 + Math.random() * 4.5}s;animation-delay:${Math.random() * 5}s`;
    cosmos.appendChild(t);
  }

  const msgs = panel.querySelector(".vcb-msgs");
  const form = panel.querySelector(".vcb-form");
  const input = panel.querySelector(".vcb-input");
  const send = panel.querySelector(".vcb-send");
  const bless = panel.querySelector(".vcb-bless");

  // Show the "open in Chrome" line only where it actually helps: inside an
  // in-app browser, not already installed, and not already waved away.
  const openIn = panel.querySelector(".vcb-openin");
  if (openIn) {
    const DISMISS_KEY = "ashaiOpenInDismissed";
    let waved = false;
    try {
      waved = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* private mode — just show it */
    }
    if (isInAppBrowser && !isInstalled() && !waved) {
      const onApple = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      openIn.querySelector("span").textContent = onApple
        ? "Open this in Safari to install the app on your phone."
        : "Open this in Chrome to install the app on your phone.";
      openIn.hidden = false;
      openIn.querySelector("button").addEventListener("click", () => {
        openIn.hidden = true;
        try {
          localStorage.setItem(DISMISS_KEY, "1");
        } catch {
          /* nothing to remember it with — fine */
        }
      });
    }
  }
  const micBtn = panel.querySelector(".vcb-mic");
  const voiceBtn = panel.querySelector(".vcb-voice");

  // ——— voice engine: speech-in (mic) and speech-out (spoken answers) ———
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recLang = script?.dataset.voiceLang || "hi-IN";
  let voiceReplies = true; // voice-first: answers are spoken by default
  let listening = false;
  let rec = null;

  const stage = panel.querySelector(".vcb-stage");
  const cap = panel.querySelector(".vcb-cap");
  const orb = panel.querySelector(".vcb-orbbig");
  const statusEl = panel.querySelector(".vcb-status");
  const langBtn = panel.querySelector(".vcb-lang");
  const kbdBtn = panel.querySelector(".vcb-kbd");
  const creditEl = panel.querySelector(".vcb-credit");

  // ——— UI language: the भाषा/Language toggle switches the whole interface, not
  // just speech recognition (owner, 2026-07-20). The bot's ANSWERS still follow
  // the language of the question; this is only the chrome. ———
  let uiLang = (() => {
    try {
      const saved = localStorage.getItem("ashaiUiLang");
      if (saved === "hi" || saved === "en") return saved;
    } catch {
      /* private mode */
    }
    return recLang.startsWith("hi") ? "hi" : "en";
  })();
  // keep speech recognition in step with the chosen UI language
  recLang = uiLang === "en" ? "en-IN" : "hi-IN";
  const T = {
    hi: {
      lang: "भाषा: हिंदी",
      placeholder: "अपना सवाल लिखिए…",
      typeInstead: "⌨️ लिखकर पूछें",
      send: "भेजें",
      navGuide: "गाइड",
      navChats: "बातचीत",
      chatsTitle: "आपकी बातचीत",
      chatsSub: "इसी फ़ोन पर 24 घंटे तक सुरक्षित 🙏",
      clear: "मिटाएँ",
      chatsEmpty: "अभी कोई बातचीत नहीं।<br>guide से कुछ भी पूछिए — आपकी बातें यहाँ 24 घंटे तक रहेंगी।",
      startAsking: "पूछना शुरू करें",
      reAsk: "फिर से पूछें",
      today: "आज",
      yesterday: "कल",
      read: "📖 पढ़िए",
      watch: "📿 देखिए",
      askMore: "🙏 आप यह भी पूछ सकते हैं",
      thoughtTitle: "🙏 आज का विचार",
      thoughtTap: "👆 tap करें — इस विचार पर guide से बात कीजिए",
      idle: 'गाइड को छूकर <b>बोलिए</b><br>Tap the guide and <b>speak</b> your question',
      listening: '🎙️ <b>सुन रहे हैं… बोलिए</b> · listening — tap to finish',
      speaking: '🔊 <b>उत्तर</b> · tap to stop',
      speakNow: "🎙️ बोलिए… रुकते ही भेज दिया जाएगा (auto-sends when you pause)",
      listeningPh: "🎙️ बोलिए… (listening)",
      clearConfirm: "इस फ़ोन से अपनी सारी बातचीत मिटा दें?",
      thinking: "🔎 उत्तर खोज रहे हैं… finding your answer…",
      micError: "Mic नहीं चला — फिर से दबाइए · mic didn't start, tap again",
      closeMsg: "आप जब चाहें लौट आइए — the door is always open.",
      corrPrompt: "🙏 अगर यह उत्तर सही नहीं था और आप जानते हैं कि Bhaiya इसे कैसे समझाते हैं, तो सही उत्तर नीचे लिखिए। बस उत्तर लिखिए, बाक़ी हम समझ लेंगे। हमारी team देखकर आगे बढ़ाएगी।",
      corrPh: "सही उत्तर यहाँ लिखिए… (सिर्फ़ उत्तर)",
      corrSend: "भेजिए 🙏",
      corrSkip: "रहने दीजिए",
      bless: "जय सिया राम",
    },
    en: {
      lang: "Language: English",
      placeholder: "Type your question…",
      typeInstead: "⌨️ type instead",
      send: "Send",
      navGuide: "Guide",
      navChats: "Chats",
      chatsTitle: "Your chats",
      chatsSub: "Kept on this phone for 24 hours 🙏",
      clear: "Clear",
      chatsEmpty: "No conversations yet.<br>Ask the guide anything — your chats stay here for 24 hours.",
      startAsking: "Start asking",
      reAsk: "Ask again",
      today: "Today",
      yesterday: "Yesterday",
      read: "📖 Read",
      watch: "📿 Watch",
      askMore: "🙏 You can also ask",
      thoughtTitle: "🙏 Thought of the day",
      thoughtTap: "👆 Tap to talk about this with the guide",
      idle: 'Tap the guide and <b>speak</b> your question',
      listening: '🎙️ <b>Listening… speak</b> — tap to finish',
      speaking: '🔊 <b>Answer</b> · tap to stop',
      speakNow: "🎙️ Speak… it sends when you pause",
      listeningPh: "🎙️ Listening…",
      clearConfirm: "Clear all your conversation from this phone?",
      thinking: "🔎 Finding your answer…",
      micError: "Mic didn't start — tap again",
      closeMsg: "Come back whenever you like — the door is always open.",
      corrPrompt: "🙏 If this answer wasn't right and you know how Bhaiya explains it, write the correct answer below. Just the answer — our team will review it.",
      corrPh: "Write the correct answer here…",
      corrSend: "Send 🙏",
      corrSkip: "Not now",
      bless: "Jai Siya Ram",
    },
  };
  const t = (k) => (T[uiLang] && T[uiLang][k]) ?? T.hi[k] ?? k;
  // Push the current language onto every static UI element. Called at start and
  // whenever the language is toggled; dynamic views (Chats, sources, chips) read
  // t() directly when they render.
  function applyLang() {
    panel.dataset.uilang = uiLang;
    langBtn.textContent = t("lang");
    input.placeholder = t("placeholder");
    kbdBtn.textContent = t("typeInstead");
    const sendBtn = panel.querySelector(".vcb-send");
    if (sendBtn) sendBtn.textContent = t("send");
    panel.querySelectorAll(".vcb-nav button[data-nav]").forEach((b) => {
      const ic = b.dataset.nav === "guide" ? "🎙️" : "💬";
      b.innerHTML = `<span class="ic">${ic}</span>${t(b.dataset.nav === "guide" ? "navGuide" : "navChats")}${b.dataset.nav === "chats" ? '<span class="nb-dot"></span>' : ""}`;
    });
    const ct = panel.querySelector(".vcb-chats-top h4");
    if (ct) ct.textContent = t("chatsTitle");
    const cs = panel.querySelector(".vcb-chats-top .sub");
    if (cs) cs.textContent = t("chatsSub");
    const cc = panel.querySelector(".vcb-chats-clear");
    if (cc) cc.textContent = t("clear");
    if (!SPLASH_CUSTOM) {
      const bl = panel.querySelector(".vcb-bless span");
      if (bl) bl.textContent = t("bless");
    }
    // re-render the two live views so a mid-session toggle updates them
    if (typeof renderChats === "function" && panel.dataset.view === "chats") renderChats();
    if (typeof setVState === "function" && panel.dataset.vstate) setVState(panel.dataset.vstate);
  }

  // ——— Chats tab: the seeker's own conversation, kept 24h on this phone ———
  const chatsScroll = panel.querySelector(".vcb-chats-scroll");
  const navBtns = [...panel.querySelectorAll(".vcb-nav button[data-nav]")];
  const whenLabel = (ms) => {
    const d = new Date(ms);
    const today = new Date().toDateString() === d.toDateString();
    const tm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${today ? t("today") : t("yesterday")} · ${tm}`;
  };
  function renderChats() {
    if (!chatsScroll) return;
    pruneChatlog();
    const log = journey.chatlog;
    if (!log.length) {
      chatsScroll.innerHTML =
        '<div class="vcb-chats-empty"><div class="em-ic">💬</div>' +
        `<p>${t("chatsEmpty")}</p>` +
        `<button class="go" type="button">${t("startAsking")}</button></div>`;
      chatsScroll.querySelector(".go")?.addEventListener("click", () => showView("guide"));
      return;
    }
    chatsScroll.innerHTML = "";
    let lastAt = 0;
    for (const m of log) {
      if (m.at - lastAt > 30 * 60 * 1000) {
        // a fresh time header whenever more than half an hour has passed
        const g = document.createElement("div");
        g.className = "vcb-cgap";
        g.textContent = whenLabel(m.at);
        chatsScroll.appendChild(g);
      }
      lastAt = m.at;
      const b = document.createElement("div");
      b.className = "vcb-cbubble " + (m.r === "u" ? "u" : "b");
      b.textContent = m.t;
      if (m.r === "u") {
        b.title = t("reAsk");
        b.addEventListener("click", () => {
          showView("guide");
          askChip(m.t, "chats");
        });
      }
      chatsScroll.appendChild(b);
    }
    chatsScroll.scrollTop = chatsScroll.scrollHeight;
  }
  function showView(v) {
    panel.dataset.view = v;
    navBtns.forEach((b) => b.classList.toggle("on", b.dataset.nav === v));
    if (v === "chats") renderChats();
  }
  navBtns.forEach((b) => b.addEventListener("click", () => showView(b.dataset.nav)));
  panel.dataset.view = "guide";
  panel.querySelector(".vcb-chats-clear")?.addEventListener("click", () => {
    if (!journey.chatlog.length || !confirm(t("clearConfirm"))) return;
    journey.chatlog = [];
    saveJourney();
    renderChats();
  });

  // Credit system paused (owner's call — will implement later). While off the
  // 🪙 coin never shows and no balance is fetched. Flip to true to re-enable.
  const CREDITS_ON = true;
  // the 🪙 coin: show the seeker's questions-left, gold normally, amber when low
  function renderCredits(n) {
    if (!creditEl) return;
    if (!CREDITS_ON || typeof n !== "number" || !journey.uid) { creditEl.hidden = true; return; }
    journey.credits = n;
    saveJourney();
    creditEl.hidden = false;
    creditEl.querySelector("b").textContent = n.toLocaleString("en-IN");
    creditEl.classList.toggle("low", n <= 10);
  }
  // refresh from the server (e.g. on open, after an admin top-up between sessions)
  function refreshCredits() {
    if (!CREDITS_ON || !journey.uid) return;
    fetch(`${API}/api/credits?uid=${encodeURIComponent(journey.uid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.credits === "number") renderCredits(d.credits); })
      .catch(() => {});
  }

  const hasDevanagari = (t) => /[ऀ-ॿ]/.test(t);
  let naturalVoice = false; // does the server offer a human voice? (probed at load)
  fetch(`${API}/health`).then((r) => r.json()).then((h) => (naturalVoice = !!h.naturalVoice)).catch(() => {});
  let currentAudio = null;

  // ——— keep the phone screen awake while the bot is answering or speaking ———
  // A locked screen suspends the page and cuts the reply off mid-way. We hold a
  // Screen Wake Lock whenever a request is in flight OR the voice is playing,
  // and release it the moment both are done. No-op where the API is unsupported.
  let wakeLock = null, reqInFlight = false, speakingNow = false;
  async function updateWake() {
    const busy = reqInFlight || speakingNow;
    try {
      if (busy && !wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener?.("release", () => { wakeLock = null; });
      } else if (!busy && wakeLock) {
        const wl = wakeLock;
        wakeLock = null;
        wl.release().catch(() => {});
      }
    } catch {
      wakeLock = null;
    }
  }
  // the OS drops the lock when the tab hides — re-take it when we're back and still busy
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") updateWake(); });
  // ONE reusable player for all spoken answers: iOS grants sound permission
  // per-element at tap time — a fresh `new Audio()` created later is muted in
  // home-screen apps. This element gets blessed on the first tap and reused.
  let ttsAudio = null;

  const cleanForSpeech = (text) =>
    text
      .split("\n")
      .filter((l) => !/^\s*(source|watch)\s*:/i.test(l)) // sources are shown, not spoken
      .join("\n")
      .replace(/https?:\S+/g, "")
      .replace(/[*_#\`~]+/g, "") // never read formatting symbols aloud
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .trim();

  // Apple's Hindi voice reads a standalone "गुरु" as "गुरुवार" (Thursday) —
  // reported on a seeker's iPhone, 2026-07-19. Respelling it with the long ū
  // breaks that expansion. This applies ONLY to the device voice on Apple
  // devices: the words on screen, the words sent to the server voice, and the
  // log are all untouched, and Android is unaffected.
  const APPLE_SPEECH_FIXES = [
    // only a standalone गुरु — never गुरुदेव, गुरुकुल, or गुरुवार itself
    [/गुरु(?![ऀ-ॿ])/gu, "गुरू"],
  ];
  const forDeviceVoice = (t) =>
    isApple ? APPLE_SPEECH_FIXES.reduce((acc, [re, to]) => acc.replace(re, to), t) : t;

  // Choose the most natural free voice the device offers. Chrome's "Google …"
  // network voices and Apple's downloadable Enhanced/Premium voices sound far
  // better than the compact defaults, so rank them first.
  function pickVoice(lang) {
    const prefix = lang.toLowerCase().startsWith("hi") ? "hi" : "en-in";
    const norm = (l) => l.replace("_", "-").toLowerCase();
    let cands = speechSynthesis.getVoices().filter((v) => norm(v.lang).startsWith(prefix));
    if (!cands.length && prefix === "en-in")
      cands = speechSynthesis.getVoices().filter((v) => norm(v.lang).startsWith("en"));
    const score = (v) => {
      const n = v.name.toLowerCase();
      return (
        // prefer a MALE voice when the device offers one (Madhur/Hemant/Arjun
        // are the common Hindi male neural voices; \bmale\b won't match "female")
        (/madhur|hemant|arjun|prabhat|neel|ravi|\bmale\b/i.test(n) ? 9 : 0) +
        (n.includes("google") ? 8 : 0) +
        (n.includes("natural") ? 6 : 0) +
        (n.includes("premium") ? 6 : 0) +
        (n.includes("enhanced") ? 4 : 0) +
        (v.localService === false ? 3 : 0) +
        (n.includes("siri") ? 2 : 0)
      );
    };
    return cands.sort((a, b) => score(b) - score(a))[0] || null;
  }

  // iPhone only lets a page speak if speech was started from a real tap. The
  // guide always speaks LATER — after the answer, and after the server voice has
  // been tried — so by then the tap is long gone and iOS silently refuses. That
  // is why the fallback voice went quiet on iOS while the server voice was down
  // (owner, 2026-07-19). Firing one silent utterance during the tap itself
  // unlocks speech for the rest of the visit. Harmless everywhere else.
  // A short buzz when the seeker taps the mic — the tap has no other feedback on
  // a phone, so it is easy to be unsure whether the guide is listening.
  // Android only: Apple does not support the Vibration API, so this is a no-op
  // on iPhone and iPad (nothing breaks, it simply is not felt).
  const buzz = (ms = 18) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* unsupported or blocked — never let a nicety throw */
    }
  };

  // Apple gives a web page no vibration at all, so an iPhone got no feedback
  // from a tap. A very short tone stands in for it. Synthesised, not a file:
  // nothing extra to download, and it starts instantly.
  //
  // ONE audio context for the whole visit — created on the first tap and kept.
  // Making a new one per tap would churn iOS's audio session, and churning that
  // session next to the microphone is exactly what silenced the mic earlier
  // today (2026-07-19).
  let actx = null;
  const clickSound = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state === "suspended") actx.resume();
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, t);
      // a soft bell-ish tick, not a beep: quick in, quick out
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      osc.connect(gain).connect(actx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch {
      /* no audio available — the tap still works, that is what matters */
    }
  };

  // One feel per platform: Android buzzes, iPhone ticks.
  const tap = () => (isApple ? clickSound() : buzz());

  // …and everyone sees it. iPhone gives a web page no vibration, and no sound at
  // all when the ring switch is off — so touch has to be answered with light
  // (owner, 2026-07-19).
  function bloom(e, el) {
    try {
      const box = panel.getBoundingClientRect();
      const x = (e.clientX || box.left + box.width / 2) - box.left;
      const y = (e.clientY || box.top + box.height / 2) - box.top;
      // Take the control's own colour — but only if it is actually light. Some
      // buttons carry no text colour and compute to black, and black light on a
      // dark panel is invisible (caught in testing). Fall back to the theme:
      // green for the chips, gold for everything else.
      const own = (getComputedStyle(el).color.match(/\d+/g) || []).map(Number).slice(0, 3);
      const bright = own.length === 3 && own[0] + own[1] + own[2] > 210;
      const [r, g, b] = bright
        ? own
        : el.classList.contains("vcb-chip")
          ? [52, 211, 153]
          : [247, 227, 174];
      const dot = document.createElement("i");
      dot.className = "vcb-tapglow";
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      // the ring takes the colour; a whisper of fill keeps it from looking hollow
      dot.style.color = `rgba(${r},${g},${b},.75)`;
      dot.style.background = `radial-gradient(circle, rgba(${r},${g},${b},.18) 0%, rgba(${r},${g},${b},0) 65%)`;
      panel.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove());
      setTimeout(() => dot.remove(), 900); // belt and braces — never leave one behind
    } catch {
      /* decoration only — a tap must never fail because of it */
    }
  }

  let voicePrimed = false;
  let voiceMissingTold = false; // only mention a missing device voice once per visit
  function primeVoice() {
    if (voicePrimed || !("speechSynthesis" in window)) return;
    voicePrimed = true;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      speechSynthesis.speak(u);
      speechSynthesis.getVoices(); // also nudges the voice list to load
    } catch {
      /* not supported here — browserSpeak will simply do nothing */
    }
  }
  // the list arrives asynchronously on most browsers; keep it warm
  try {
    if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
  } catch {
    /* best effort */
  }

  // Speak sentence by sentence: natural breathing pauses, and it sidesteps the
  // Chrome bug that silently cuts single long utterances at ~15 seconds.
  function browserSpeak(clean, done) {
    if (!("speechSynthesis" in window)) return done();
    speechSynthesis.cancel();
    const lang = hasDevanagari(clean) ? "hi-IN" : "en-IN";
    const voice = pickVoice(lang);
    // A phone with no Hindi voice installed simply says NOTHING — no error, no
    // clue for the seeker, who is left staring at a silent screen (owner's
    // Android, 2026-07-19). Say what is wrong instead of leaving them guessing.
    if (!voice && lang === "hi-IN" && speechSynthesis.getVoices().length && !voiceMissingTold) {
      voiceMissingTold = true;
      try {
        console.warn("no Hindi voice on this device — install one in the phone's text-to-speech settings");
        if (panel.dataset.mode === "voice")
          showLive("🔈 इस फ़ोन में हिंदी आवाज़ नहीं है — phone की Settings › Text-to-speech में Hindi जोड़िए। तब तक उत्तर पढ़ लीजिए 🙏");
      } catch {
        /* notice is best-effort */
      }
    }
    // Speaking each SENTENCE as its own utterance made the guide pause far too
    // long after every full stop (owner, 2026-07-20): a separate utterance costs
    // the device's speech-engine restart latency PLUS our breath. Instead, GROUP
    // sentences into ~160-char pieces so the engine flows through several
    // sentences in one breath — its own natural pause at each "।" gives the
    // gentle new-sentence feel, without the long gap. Still chunked, only so a
    // single utterance never hits Chrome's ~15s cut.
    const parts = forDeviceVoice(clean)
      .split(/(?<=[।॥.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const chunks = [];
    let buf = "";
    for (let s of parts) {
      while (s.length > 200) {
        // a lone over-long sentence (no full stop) — break it on a comma so it
        // still can't trip the 15s cut
        const cut = s.lastIndexOf(",", 200);
        const at = cut > 60 ? cut + 1 : 200;
        chunks.push((buf ? buf + " " : "") + s.slice(0, at).trim());
        buf = "";
        s = s.slice(at).trim();
      }
      if (buf && buf.length + s.length + 1 > 160) {
        chunks.push(buf);
        buf = s;
      } else {
        buf = buf ? buf + " " + s : s;
      }
    }
    if (buf) chunks.push(buf);
    if (!chunks.length) return done();
    let i = 0;
    let cancelled = false;
    const next = () => {
      if (cancelled) return;
      if (i >= chunks.length) return done();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 0.97;
      u.pitch = 1.02;
      // just enough to breathe, not to stall — the real sentence pauses happen
      // inside the utterance, spoken by the engine itself
      u.onend = () => setTimeout(next, 30);
      u.onerror = () => {
        cancelled = true;
        done();
      };
      speechSynthesis.speak(u);
    };
    next();
  }

  async function speak(text, onDone) {
    let doneCalled = false;
    const done = () => {
      if (!doneCalled) {
        doneCalled = true;
        speakingNow = false;
        updateWake(); // answer finished speaking — let the screen sleep again
        onDone && onDone();
      }
    };
    if (!voiceReplies) return done();
    const clean = cleanForSpeech(text);
    if (!clean) return done();
    speakingNow = true;
    updateWake(); // hold the screen awake for the whole spoken answer

    // Human voice from the server when available, browser voice otherwise.
    // Mic conversations always get the natural voice; typed chats use the free
    // device voice — UNLESS the device has no suitable voice (many phones lack
    // Hindi), in which case silence is worse than spending server-voice quota.
    const speechLang = hasDevanagari(clean) ? "hi-IN" : "en-IN";
    if (naturalVoice && (panel.dataset.mode === "voice" || !pickVoice(speechLang))) {
      try {
        // Progressive chunks: a tiny first piece so speech starts fast, then
        // growing pieces — each generates (in parallel) while the previous plays,
        // so the voice flows without gaps.
        // Chunk sizes double (1, 2, 4… sentences): generation runs at roughly the
        // speed of the audio itself, so each chunk must be ready while ALL the
        // previous ones are still playing — doubling keeps that inequality true.
        const sentences = clean.split(/(?<=[।॥.!?])\s+/).filter(Boolean);
        const chunks = [];
        if (sentences.length === 0) chunks.push(clean);
        else {
          chunks.push(sentences.shift());
          for (let take = 2; sentences.length; take *= 2) {
            chunks.push(sentences.splice(0, take).join(" "));
          }
        }
        const fetches = chunks.map((t) =>
          fetch(`${API}/api/tts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: t }),
          })
            .then((r) => (r.ok ? r.blob() : null))
            .catch(() => null),
        );
        const firstBlob = await fetches[0];
        if (firstBlob) {
          const playBlob = (blob) =>
            new Promise((resolve, reject) => {
              const audio = ttsAudio || (ttsAudio = new Audio());
              const url = URL.createObjectURL(blob);
              audio.src = url;
              currentAudio = audio;
              audio.onended = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              audio.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
              };
              audio.play().catch(reject);
            });
          try {
            await playBlob(firstBlob);
            for (let i = 1; i < fetches.length; i++) {
              if (!currentAudio) return; // user tapped stop mid-answer
              const blob = await fetches[i];
              // chunk failed (voice quota) — finish ALL remaining text in browser voice
              if (!blob) return browserSpeak(chunks.slice(i).join(" "), done);
              await playBlob(blob);
            }
            return done();
          } catch {
            if (!currentAudio) return; // stopped, not an error
            return browserSpeak(clean, done);
          }
        }
      } catch {
        /* fall through to browser voice */
      }
    }
    browserSpeak(clean, done);
  }
  const stopSpeaking = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    speakingNow = false;
    updateWake();
  };

  function setVoiceReplies(on) {
    voiceReplies = on;
    voiceBtn.textContent = on ? "🔊" : "🔇";
    if (!on) stopSpeaking();
  }
  voiceBtn.addEventListener("click", () => setVoiceReplies(!voiceReplies));
  setVoiceReplies(true);

  // Mobile browsers only allow sound after a user touch — play a moment of
  // silence on the first tap anywhere in the panel so replies can speak later.
  panel.addEventListener(
    "click",
    () => {
      try {
        // bless the ONE reusable player with this tap — iOS lets it speak later
        ttsAudio = ttsAudio || new Audio();
        ttsAudio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
        ttsAudio.play().catch(() => {});
        if ("speechSynthesis" in window) {
          speechSynthesis.getVoices(); // warm the voice list
          const u = new SpeechSynthesisUtterance(" ");
          u.volume = 0;
          speechSynthesis.speak(u); // bless the browser voice too
        }
      } catch { /* best effort */ }
    },
    { once: true, capture: true },
  );

  // ——— shared: ask the backend one question ———
  // When a tap on a chip triggers the ask, this labels it (followup/thought)
  // so the nightly study can learn which suggestions seekers actually accept.
  // Consumed once by askServer — it wins over the mode label (voice/text).
  let chipVia = "";
  async function askServer(text, via) {
    const askedVia = chipVia || via || "text";
    chipVia = "";
    reqInFlight = true;
    updateWake(); // hold the screen while the answer is being generated
    let resp, data;
    try {
      resp = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // via+lang let the server answer in the mic's language even when the
        // recognizer writes Hindi speech down in Latin letters. profile = the
        // context card from this device's diary (used once, never stored).
        body: JSON.stringify({
          message: text,
          history,
          via: askedVia,
          lang: recLang,
          profile: {
            uid: journey.uid || "",
            name: journey.name || "",
            summary: journey.summary || "",
            style: journey.commStyle || "",
            topics: journey.asked.slice(-8).map((a) => a.q),
            seen: journey.seen,
            sadhana: journey.sadhana || undefined,
            leftover:
              sessionAsks === 0 && journey.asked.length
                ? { q: journey.asked[journey.asked.length - 1].q, when: agoLabel(journey.asked[journey.asked.length - 1].at) }
                : undefined,
          },
        }),
      });
      data = await resp.json();
    } catch {
      reqInFlight = false;
      updateWake();
      throw new Error("Sorry, I couldn't reach the server. Please try again.");
    }
    reqInFlight = false;
    updateWake();
    if (!resp.ok) throw new Error(data.error || "Sorry, something went wrong. Please try again.");
    if (typeof data.credits === "number") renderCredits(data.credits); // keep the 🪙 coin fresh
    sessionAsks++;
    history.push({ role: "user", content: text }, { role: "assistant", content: data.answer });
    if (history.length > 12) history.splice(0, history.length - 12);
    journey.convo = history.slice(-12);
    logChat("user", text);
    logChat("bot", data.answer);
    if (data.followups?.length) journey.lastFollowups = data.followups.slice(0, 3);
    if (data.checkin) journey.checkin = data.checkin;
    if (data.sadhana) {
      // the guide noticed the seeker declared (or stopped) a regular practice
      journey.sadhana = data.sadhana === "-" ? null : { name: data.sadhana, since: new Date().toISOString().slice(0, 10) };
    }
    // a notification-opener isn't something the seeker asked — keep it out of
    // their topics diary (the conversation that follows is recorded normally)
    if (askedVia !== "notification") recordAsk(text);
    if (data.sources?.length) recordSeen(data.sources.map((s) => s.title));
    if (data.suggest) recordSeen([data.suggest.title]);
    return data;
  }

  // ——— voice-first stage: state machine (idle → listening → thinking → speaking) ———
  const stateKey = { idle: "idle", listening: "listening", thinking: "thinking", speaking: "speaking", error: "micError" };
  function setVState(s) {
    panel.dataset.vstate = s;
    statusEl.innerHTML = stateKey[s] ? t(stateKey[s]) : "";
  }
  function capAdd(el) {
    cap.appendChild(el);
    while (cap.children.length > 6) cap.firstChild.remove();
    cap.scrollTop = cap.scrollHeight;
  }
  let liveEl = null;
  function showLive(text) {
    if (!liveEl) {
      liveEl = document.createElement("div");
      liveEl.className = "vcb-live";
      capAdd(liveEl);
    }
    liveEl.textContent = text || "…";
    cap.scrollTop = cap.scrollHeight;
  }

  async function voiceAsk(text) {
    liveEl = null;
    setVState("thinking");
    const you = document.createElement("div");
    you.className = "vcb-you";
    you.textContent = `🗣️ ${text}`;
    capAdd(you);
    try {
      const data = await askServer(text, "voice");
      const ans = document.createElement("div");
      ans.className = "vcb-ans";
      ans.textContent = data.answer;
      enrichAnswer(ans, data, text);
      capAdd(ans);
      if (data.followups?.length) capAdd(chipsEl(data.followups, ASK_MORE()));
      maybeOfferBell();
      panel.dataset.hasAns = "1";
      // long answers: read from the beginning, not scrolled to the end
      cap.scrollTop += ans.getBoundingClientRect().top - cap.getBoundingClientRect().top - 4;
      setVState("speaking");
      speak(data.answer, () => setVState("idle"));
    } catch (err) {
      const e = document.createElement("div");
      e.className = "vcb-ans";
      e.textContent = err.message;
      capAdd(e);
      panel.dataset.hasAns = "1";
      setVState("idle");
    }
  }

  // ——— recorder fallback: record a short clip → /api/stt transcribes it ———
  // iOS home-screen apps can't use SpeechRecognition (it starts but hears
  // nothing — a WebKit limitation), so there we record audio and the server
  // listens. Also kicks in anywhere recognition keeps coming back empty.
  const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const useRecorder = () =>
    canRecord && ((IOS && navigator.standalone === true) || journey.sttFallback === true || !SR);

  let mediaRec = null, recChunks = [], recStream = null, recTimer = null;
  let recAudioCtx = null, recLevelInt = null;

  // Listen to the mic's loudness: once the seeker has spoken and then stayed
  // quiet for ~2s, send automatically — same feel as Android's recognizer.
  function watchForPause(stream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      recAudioCtx = new AC();
      recAudioCtx.resume?.();
      const analyser = recAudioCtx.createAnalyser();
      analyser.fftSize = 1024;
      recAudioCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let spoke = false, quietSince = 0;
      recLevelInt = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > 0.025) {
          spoke = true;
          quietSince = 0;
        } else if (spoke) {
          const now = Date.now();
          if (!quietSince) quietSince = now;
          else if (now - quietSince > 2000) stopRecording();
        }
      }, 120);
    } catch { /* level watching is best-effort — tap-again and the 12s cap remain */ }
  }
  function stopLevelWatch() {
    clearInterval(recLevelInt);
    recLevelInt = null;
    try { recAudioCtx?.close(); } catch { /* already closed */ }
    recAudioCtx = null;
  }
  // each failure explains itself — the status line tells the seeker (and us)
  // exactly which door is closed instead of a generic "mic didn't start"
  function micTrouble(target, err, phase) {
    listening = false;
    const name = err?.name || "";
    let hint;
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
      hint = "🎙️ Mic की अनुमति बंद है — iPhone Settings → Ask Your Guide → Microphone को ON कीजिए, फिर app दोबारा खोलिए";
    else if (name === "NotFoundError" || name === "NotReadableError")
      hint = "🎙️ Mic उपलब्ध नहीं — कोई दूसरी app mic use कर रही हो सकती है";
    else hint = `⚠️ Mic ${phase} में रुका (${name || "unknown"}) — एक बार फिर tap कीजिए`;
    if (target === "stage") {
      setVState("error");
      showLive(hint);
    } else {
      input.placeholder = "Mic not available — please type…";
    }
  }
  async function startRecording(target) {
    stopSpeaking();
    stopLevelWatch();
    try {
      recStream?.getTracks?.().forEach((t) => t.stop()); // never hold two mics
    } catch { /* none open */ }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return micTrouble(target, err, "permission");
    }
    const mime = MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    try {
      mediaRec = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
    } catch (err) {
      recStream.getTracks().forEach((t) => t.stop());
      return micTrouble(target, err, "recorder");
    }
    recChunks = [];
    mediaRec.ondataavailable = (e) => {
      if (e.data && e.data.size) recChunks.push(e.data);
    };
    mediaRec.onstop = async () => {
      clearTimeout(recTimer);
      stopLevelWatch();
      recStream.getTracks().forEach((t) => t.stop());
      listening = false;
      micBtn.classList.remove("listening");
      const blob = new Blob(recChunks, { type: mediaRec.mimeType || mime || "audio/mp4" });
      if (blob.size < 1200) {
        if (target === "stage") {
          if (liveEl) { liveEl.remove(); liveEl = null; }
          setVState("idle");
        }
        return;
      }
      if (target === "stage") {
        setVState("thinking");
        showLive("…");
      }
      try {
        const text = await sttServer(blob);
        if (liveEl) { liveEl.remove(); liveEl = null; }
        if (target === "stage") {
          if (text) voiceAsk(text);
          else setVState("idle");
        } else {
          input.value = text;
          input.placeholder = "Type your question…";
          if (text) form.requestSubmit();
        }
      } catch (err) {
        if (liveEl) { liveEl.remove(); liveEl = null; }
        // A seeker should never read "server 503 · groq key missing" mid-prayer
        // (that reached a real phone, 2026-07-19). Keep the technical reason in
        // the console where it can still be diagnosed.
        try {
          console.warn("stt failed:", err?.status || "", err?.error || "", err?.detail || "");
        } catch {}
        if (target === "stage") {
          setVState("error");
          showLive(
            err?.status === 429
              ? "⚠️ बहुत सारे सवाल एक साथ — 1-2 मिनट रुककर फिर बोलिए"
              : /429|quota/i.test(err?.detail || "")
                ? "⚠️ आज का free voice-कोटा पूरा हो गया — अभी ⌨️ type कीजिए, आवाज़ दोपहर बाद अपने-आप लौट आएगी 🙏"
                : /not-configured|key missing/i.test(`${err?.error || ""} ${err?.detail || ""}`)
                  ? "⚠️ आवाज़ सुनने की सेवा अभी उपलब्ध नहीं है — अभी ⌨️ type कीजिए 🙏"
                  : "⚠️ आवाज़ record हुई पर समझी नहीं जा सकी — एक बार फिर बोलिए",
          );
        } else {
          input.placeholder = "Couldn't transcribe — try again or type…";
        }
      }
    };
    mediaRec.start();
    watchForPause(recStream);
    listening = true;
    if (target === "stage") {
      setVState("listening");
      showLive(t("speakNow"));
    } else {
      micBtn.classList.add("listening");
      input.placeholder = t("listeningPh");
    }
    recTimer = setTimeout(stopRecording, 12000);
  }
  function stopRecording() {
    clearTimeout(recTimer);
    try {
      if (mediaRec && mediaRec.state === "recording") mediaRec.stop();
    } catch { /* already stopped */ }
  }
  function cancelRecording() {
    recChunks = [];
    stopRecording();
  }
  async function sttServer(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const r = await fetch(`${API}/api/stt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // the iOS home-screen app announces itself — the server gives it the
      // dedicated Whisper ear (Groq); every other caller keeps the Gemini ear
      body: JSON.stringify({ audio: btoa(bin), mime: blob.type, lang: recLang, src: IOS && navigator.standalone === true ? "ios-app" : "web" }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const e = new Error("stt " + r.status);
      e.status = r.status;
      e.detail = d.detail || "";
      throw e;
    }
    return String((await r.json()).text || "").trim();
  }

  function startListening(target) {
    if (needSignup()) return;
    if (useRecorder()) {
      startRecording(target);
      return;
    }
    if (!rec) return;
    stopSpeaking();
    try {
      rec._target = target; // "stage" or "input"
      rec._final = "";
      rec.lang = recLang;
      rec.start();
      listening = true;
      if (target === "stage") {
        setVState("listening");
        showLive("");
      } else {
        micBtn.classList.add("listening");
        input.placeholder = t("listeningPh");
      }
    } catch {
      listening = false;
      if (target === "stage") setVState("error");
    }
  }

  if (!SR && !canRecord) {
    // no way to hear at all (very old browser): classic text chat only
    micBtn.style.display = "none";
    kbdBtn.style.display = "none";
    stage.dataset.unsupported = "1";
  }
  if (SR) {
    rec = new SR();
    rec.interimResults = true;
    rec.continuous = false;

    // Recognition mishears brand words — spoken "गुरुदेव" comes back as
    // "गुरुवार" (Thursday). Fix before showing or sending. Add pairs as found.
    const MISHEARD = [
      [/गुरुवार/g, "गुरुदेव"],
      [/\bguru\s?[vw]aa?r\b/gi, "Gurudev"],
      [/[अआ]शा\s?[ईइय]{1,2}न/g, "Ashaeiynn"],
      [/\basha\s?[eiy]{1,3}nn?\b/gi, "Ashaeiynn"],
      [/पाठ\s+शाला/g, "पाठशाला"],
      [/\bpath\s+shala\b/gi, "Pathshala"],
      [/\bpar[ie]{0,2}ksh[ie]+t\b/gi, "Parikshit"],
    ];
    const fixHearing = (t) => MISHEARD.reduce((s, [re, ok]) => s.replace(re, ok), t);

    rec.onresult = (e) => {
      let interim = "";
      let fin = rec._final || "";
      for (const res of e.results) (res.isFinal ? (fin += fixHearing(res[0].transcript)) : (interim += fixHearing(res[0].transcript)));
      rec._final = fin;
      const textNow = (fin + interim).trim();
      if (rec._target === "stage") showLive(textNow ? `🎙️ ${textNow}` : "");
      else input.value = textNow;
    };
    let sttEmpty = 0; // consecutive voice attempts that heard nothing
    rec.onend = () => {
      listening = false;
      micBtn.classList.remove("listening");
      input.placeholder = "Type your question…";
      const fin = (rec._final || "").trim();
      if (rec._target === "stage") {
        if (fin) {
          sttEmpty = 0;
          voiceAsk(fin);
        } else {
          if (liveEl) {
            liveEl.remove();
            liveEl = null;
          }
          setVState("idle");
          // recognition keeps hearing nothing (typical on iOS): switch this
          // device to the record-and-transcribe ear permanently
          if (IOS && canRecord && ++sttEmpty >= 2) {
            journey.sttFallback = true;
            saveJourney();
          }
        }
      } else if (input.value.trim()) {
        form.requestSubmit();
      }
    };
    rec.onerror = () => {
      listening = false;
      micBtn.classList.remove("listening");
      if (rec._target === "stage") {
        if (liveEl) {
          liveEl.remove();
          liveEl = null;
        }
        setVState("error");
        if (IOS && canRecord && ++sttEmpty >= 2) {
          journey.sttFallback = true;
          saveJourney();
        }
      } else if (!input.value.trim()) {
        input.placeholder = "Mic not available — please type…";
      }
    };
  }

  // the big eye: idle→listen · listening→finish · speaking→stop
  {
    orb.addEventListener("click", () => {
      // NO primeVoice() here. Speaking — even a silent utterance — flips iOS's
      // audio session to playback, and the very next thing this handler does is
      // start the microphone. That broke voice input on iPhone (owner,
      // 2026-07-19, Android unaffected). Priming happens when the panel opens
      // and on Send, both of which are taps that never touch the mic.
      const s = panel.dataset.vstate;
      if (listening) {
        if (mediaRec && mediaRec.state === "recording") stopRecording();
        else rec?.stop();
        primeVoice(); // mic is finished — safe now, and still inside the tap
      } else if (s === "speaking") {
        stopSpeaking();
        setVState("idle");
      } else if (s !== "thinking") startListening("stage");
    });

    // A living, 3D feel: the guide leans in space toward your finger/cursor and
    // eases back when you let go. Pure CSS-3D on the figure — no library, and the
    // tap-to-speak click is untouched (this only sets a tilt as the pointer moves).
    {
      const MAX = 15;
      const lean = (e) => {
        const r = orb.getBoundingClientRect();
        if (!r.width) return;
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        orb.style.setProperty("--mgty", (px * MAX).toFixed(1) + "deg");
        orb.style.setProperty("--mgtx", (-py * MAX).toFixed(1) + "deg");
      };
      const level = () => {
        orb.style.setProperty("--mgty", "0deg");
        orb.style.setProperty("--mgtx", "0deg");
      };
      orb.addEventListener("pointermove", lean);
      orb.addEventListener("pointerleave", level);
      orb.addEventListener("pointercancel", level);
      orb.addEventListener("pointerup", level);
    }

    // language switch: Hindi ↔ English recognition
    langBtn.addEventListener("click", () => {
      recLang = recLang.startsWith("hi") ? "en-IN" : "hi-IN";
      uiLang = recLang.startsWith("hi") ? "hi" : "en";
      applyLang(); // switch the WHOLE interface, not just speech recognition
      try {
        localStorage.setItem("ashaiUiLang", uiLang);
      } catch {
        /* private mode — the choice just won't persist */
      }
      if (listening) {
        if (mediaRec && mediaRec.state === "recording") cancelRecording();
        else rec?.stop();
      }
    });
  }

  // ——— mode switching: voice stage ⇄ classic typing ———
  function setMode(m) {
    panel.dataset.mode = m;
    if (m === "text") {
      stopSpeaking();
      if (listening) { rec?.stop(); cancelRecording(); }
      if (!greeted) {
        greeted = true;
        const nm = journey.name ? `, ${journey.name}${uiLang === "hi" ? " जी" : ""}` : "";
        const lastQ = cameBack ? journey.asked[journey.asked.length - 1].q.slice(0, 80) : "";
        addMessage(
          "bot",
          cameBack
            ? uiLang === "hi"
              ? `${todGreet()}${nm} 🙏 वापसी पर स्वागत! पिछली बार आपने पूछा था: “${lastQ}” — आगे जो मन में हो, पूछिए।`
              : `Welcome back${nm} 🙏 Last time you asked: “${lastQ}” — ask me anything more.`
            : uiLang === "hi"
              ? `जय सिया राम${nm} 🙏 भगवान की शिक्षाओं के बारे में जो पूछना हो, पूछिए।`
              : `Jai Siya Ram${nm} 🙏 Ask me anything about the teachings — I'll find the answer for you.`,
        );
        if (cameBack) presentCheckin((q) => addMessage("bot", q));
        if (cameBack && journey.lastFollowups?.length) msgs.appendChild(chipsEl(journey.lastFollowups, ASK_MORE()));
      }
      input.focus();
    } else {
      setVState("idle");
    }
  }
  kbdBtn.addEventListener("click", () => { primeVoice(); setMode("text"); });
  micBtn.addEventListener("click", () => {
    // the mic in the typing bar returns to the voice stage and starts listening
    setMode("voice");
    startListening("stage");
  });
  applyLang(); // paint the whole UI in the chosen language before anything shows
  panel.dataset.mode = SR || canRecord ? "voice" : "text";

  // ——— opening blessing: splash rises, then docks into the golden strip ———
  let splashTimers = [];
  function playSplash() {
    panel.querySelector(".vcb-splash")?.remove();
    splashTimers.forEach(clearTimeout);
    splashTimers = [];
    bless.classList.remove("show");

    const s = document.createElement("div");
    s.className = "vcb-splash";
    // Default blessing follows the UI language: Devanagari headline + Latin sub in
    // Hindi, flipped to Latin headline + Devanagari sub in English. A custom
    // data-splash is shown exactly as the site set it, in both languages.
    const splashMain = !SPLASH_CUSTOM && uiLang === "en" ? "Jai Siya Ram" : SPLASH;
    const splashSub = SPLASH_CUSTOM ? SPLASH_SUB : uiLang === "en" ? "जय सिया राम" : SPLASH_SUB;
    const words = splashMain
      .split(/\s+/)
      .map((w, i) => `<span style="animation-delay:${0.12 + i * 0.22}s">${w}</span>`)
      .join("");
    s.innerHTML = `
      <div class="vcb-splash-halo"></div>
      <div class="vcb-splash-inner">
        <div class="vcb-splash-hi">${words}</div>
        <div class="vcb-splash-line"></div>
        <div class="vcb-splash-en">${splashSub}</div>
      </div>`;

    // floating diya sparks
    for (let i = 0; i < 12; i++) {
      const p = document.createElement("i");
      p.className = "vcb-spark";
      const size = 3 + Math.random() * 5;
      p.style.cssText = `left:${6 + Math.random() * 88}%;width:${size}px;height:${size}px;` +
        `animation-duration:${2.2 + Math.random() * 2.4}s;animation-delay:${Math.random() * 1.6}s`;
      s.appendChild(p);
    }

    panel.appendChild(s);
    splashTimers.push(
      setTimeout(() => {
        s.classList.add("dock"); // text floats up toward the strip
        bless.classList.add("show"); // …and the golden strip receives it
        splashTimers.push(setTimeout(() => s.remove(), 800));
      }, 2100),
    );
  }

  // ——— guide touches: time-of-day greeting + tappable follow-up questions ———
  const todGreet = () => {
    const h = new Date().getHours();
    return h < 12 ? "सुप्रभात" : h < 17 ? "नमस्ते" : "शुभ संध्या";
  };
  // channel/page links have no timestamp — show just the title then
  const srcLabel = (s) => (s.timestamp ? `${s.title} (${s.timestamp})` : s.title);
  // ——— account sheet: tap the guide's avatar — no extra chrome anywhere ———
  panel.querySelector(".vcb-ava")?.addEventListener("click", () => {
    if (!journey.uid || panel.querySelector(".vcb-namecard")) return;
    const card = document.createElement("div");
    card.className = "vcb-namecard";
    const h = document.createElement("h4");
    h.textContent = `🙏 ${journey.name || "Seeker"} जी`;
    const p = document.createElement("p");
    p.textContent = "You are signed in with Ashaeiynn Guide.";
    const del = document.createElement("button");
    del.className = "vcb-delacc";
    del.textContent = "Delete my account";
    const back = document.createElement("button");
    back.className = "vcb-nameskip";
    back.textContent = "Close";
    let armed = false;
    del.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        p.textContent =
          "This removes your details from Ashaeiynn and your journey from this phone. It cannot be undone.";
        del.textContent = "Yes, delete everything";
        back.textContent = "Keep my account";
        return;
      }
      del.disabled = true;
      del.textContent = "Removing…";
      try {
        await fetch(`${API}/api/account/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: journey.uid }),
        });
      } catch {
        /* server best-effort — local wipe proceeds */
      }
      try {
        await pushUnsubscribe();
      } catch {
        /* fine */
      }
      try {
        localStorage.removeItem(J_KEY);
      } catch {
        /* fine */
      }
      for (const k of Object.keys(journey)) delete journey[k];
      journey.asked = [];
      journey.seen = [];
      journey.convo = [];
      h.textContent = "🙏 Account deleted";
      p.textContent = t("closeMsg");
      del.remove();
      back.textContent = "Close";
    });
    back.addEventListener("click", () => card.remove());
    card.append(h, p, del, back);
    panel.appendChild(card);
  });

  // sign-up comes before the first question — the gate every ask passes through
  function needSignup() {
    if (journey.uid) return false;
    maybeAskName();
    return true;
  }
  // Anonymous one-way note: "a suggested video/article was actually opened" —
  // the nightly study uses it to learn which recommendations land. No uid.
  function recoOpened(title) {
    const body = JSON.stringify({ opened: true, title: String(title || "").slice(0, 120) });
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon(`${API}/api/feedback`, body))
        fetch(`${API}/api/feedback`, { method: "POST", body, keepalive: true }).catch(() => {});
    } catch { /* best-effort */ }
  }
  function askChip(q, via) {
    if (needSignup()) return;
    chipVia = via || "followup";
    if (panel.dataset.mode === "text") {
      input.value = q;
      form.requestSubmit();
    } else {
      voiceAsk(q);
    }
  }
  // On a return visit, the guide asks the caring question it saved last time
  // ("जाप का अभ्यास शुरू किया? कैसा रहा?"). It also goes into the conversation
  // memory as the guide's own words, so the seeker's reply is understood.
  function presentCheckin(displayAsBot) {
    const q = (journey.checkin || "").trim();
    if (!q) return;
    journey.checkin = "";
    history.push({ role: "assistant", content: q });
    journey.convo = history.slice(-12);
    logChat("bot", q);
    saveJourney();
    displayAsBot(q);
  }

  // The "watch these videos" block used to sit under every answer. With the
  // recordings withdrawn from the library there is often nothing to watch, so
  // the seeker's next step is a question, not a video — give those chips a
  // heading of their own so they read as an invitation, not stray buttons.
  const ASK_MORE = () => t("askMore");

  function chipsEl(followups, heading) {
    const wrap = document.createElement("div");
    wrap.className = "vcb-chips";
    if (heading) {
      const h = document.createElement("div");
      h.className = "vcb-lbl";
      h.style.width = "100%";
      h.style.justifyContent = "center";
      h.textContent = heading;
      wrap.appendChild(h);
    }
    followups.slice(0, 3).forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "vcb-chip";
      b.textContent = q;
      b.addEventListener("click", () => {
        wrap.remove();
        askChip(q);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function addMessage(role, text, extras, questionText) {
    const el = document.createElement("div");
    el.className = `vcb-m ${role}`;
    el.textContent = text;
    if (extras) enrichAnswer(el, extras, questionText || "");
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ——— rich answer extras: शब्दशः quote · video cards · 🌱 · feedback ———
  function ytThumb(url) {
    const m = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(url || "");
    return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
  }
  function enrichAnswer(el, data, questionText) {
    if (data.quote) {
      const q = document.createElement("div");
      q.className = "vcb-quote";
      q.append(data.quote.text);
      const cite = document.createElement("span");
      const citeText = `— Bhaiya के शब्द, शब्दशः · ${data.quote.timestamp}`;
      if (data.quote.url) {
        const a = document.createElement("a");
        a.href = data.quote.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = citeText;
        cite.appendChild(a);
      } else {
        cite.textContent = citeText;
      }
      q.appendChild(cite);
      el.appendChild(q);
    }
    if (data.sources?.length) {
      const lbl = document.createElement("div");
      lbl.className = "vcb-lbl";
      // videos were deleted from the library — do not tell a seeker to "watch"
      // an article. Label by what the links actually are.
      const anyVideo = data.sources.some((s2) => s2.url && /youtu|vimeo/i.test(s2.url));
      lbl.textContent = anyVideo ? t("watch") : t("read");
      el.appendChild(lbl);
      const wrap = document.createElement("div");
      wrap.className = "vcb-srcs";
      // Titles carry a lot of furniture — "Article: ", "| Asha Pathshala",
      // "- Ashaeiynn Official" — which would make every pill overflow.
      const shortTitle = (t) =>
        String(t)
          .replace(/^\s*(article|website)\s*:\s*/i, "")
          .replace(/\s*[|\-–—:]\s*(asha\s*pathshala|ashaeiynn(\s*official)?)\s*$/i, "")
          .trim();
      data.sources.slice(0, 3).forEach((s) => {
        const pill = document.createElement(s.url ? "a" : "span");
        if (!s.url) pill.className = "vcb-src1";
        if (s.url) {
          pill.href = s.url;
          pill.target = "_blank";
          pill.rel = "noopener";
        }
        const icon = document.createElement("i");
        icon.style.fontStyle = "normal";
        icon.textContent = s.url && /youtu|vimeo/i.test(s.url) ? "▶" : "📖";
        const name = document.createElement("b");
        const full = shortTitle(s.title);
        name.textContent = full;
        pill.title = s.title; // the whole title on hover, nothing lost
        pill.append(icon, name);
        wrap.appendChild(pill);
      });
      el.appendChild(wrap);
    }
    if (data.suggest) {
      const sug = document.createElement("div");
      sug.className = "vcb-src";
      sug.append("🌱 आगे देखिए: ");
      if (data.suggest.url) {
        const a = document.createElement("a");
        a.href = data.suggest.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = data.suggest.timestamp && data.suggest.timestamp !== "0:00" ? `${data.suggest.title} (${data.suggest.timestamp})` : data.suggest.title;
        a.addEventListener("click", () => recoOpened(data.suggest.title));
        sug.appendChild(a);
      } else {
        sug.append(data.suggest.timestamp && data.suggest.timestamp !== "0:00" ? `${data.suggest.title} (${data.suggest.timestamp})` : data.suggest.title);
      }
      el.appendChild(sug);
    }
    if (data.answer && questionText) {
      const fb = document.createElement("div");
      fb.className = "vcb-fb";
      const mk = (icon, label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "vcb-fbb";
        const i = document.createElement("i");
        i.textContent = icon;
        const t = document.createElement("em");
        t.textContent = label;
        b.append(i, t);
        return b;
      };
      const listen = mk("🔊", "सुनिए");
      listen.addEventListener("click", () => {
        stopSpeaking();
        speak(data.answer, () => {});
      });
      const up = mk("👍", "सहायक");
      const down = mk("👎", "नहीं");
      const vote = (helpful, btn) => {
        up.disabled = down.disabled = true;
        btn.classList.add("on");
        return fetch(`${API}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: questionText, helpful, uid: journey.uid || "" }),
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      };
      up.addEventListener("click", () => vote(true, up));
      down.addEventListener("click", () => {
        // a member's 👎 is an explicit "this was wrong" — the server replies
        // with invite:true for members, opening the "teach the right answer" box
        vote(false, down).then((d) => { if (d?.invite) offerCorrection(el, questionText, data.answer); });
      });
      fb.append(listen, up, down);
      if (navigator.share) {
        const share = mk("↗", "share");
        share.addEventListener("click", () => {
          navigator
            .share({
              title: "Ask Your Guide — Ashaeiynn",
              text: `🙏 ${questionText}\n\n${data.answer.slice(0, 400)}…\n`,
              url: API,
            })
            .catch(() => {});
        });
        fb.appendChild(share);
      }
      el.appendChild(fb);
    }
    // the bot (server-gated to members) invited a correction — show the box
    if (data.correctionInvite && questionText) offerCorrection(el, questionText, data.answer);
  }

  // The "teach the right answer" box — shown only when the server invites it
  // (members only). What the member types is sent as a PENDING suggestion; it
  // never changes what the bot teaches until the admin approves it.
  function offerCorrection(el, questionText, answer) {
    if (el.querySelector(".vcb-fixbox")) return; // already offered on this answer
    const box = document.createElement("div");
    box.className = "vcb-fixbox";
    const p = document.createElement("p");
    p.textContent = t("corrPrompt");
    const ta = document.createElement("textarea");
    ta.placeholder = t("corrPh");
    ta.maxLength = 3000;
    const row = document.createElement("div");
    row.className = "vcb-bellrow";
    const send = document.createElement("button");
    send.className = "vcb-bellyes";
    send.textContent = t("corrSend");
    const skip = document.createElement("button");
    skip.className = "vcb-bellno";
    skip.textContent = t("corrSkip");
    send.addEventListener("click", () => {
      const suggestion = ta.value.trim();
      if (!suggestion) { ta.focus(); return; }
      send.disabled = true;
      fetch(`${API}/api/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: questionText, answer: answer || "", suggestion, uid: journey.uid || "" }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          box.innerHTML = "";
          const done = document.createElement("p");
          done.textContent = d?.ok
            ? "🙏 धन्यवाद — आपका सुझाव team तक पहुँच गया। स्वीकृति के बाद guide इसे सीख लेगा।"
            : "अभी भेजा नहीं जा सका — थोड़ी देर बाद फिर कोशिश कीजिए।";
          box.appendChild(done);
        })
        .catch(() => { send.disabled = false; });
    });
    skip.addEventListener("click", () => box.remove());
    row.append(send, skip);
    box.append(p, ta, row);
    el.appendChild(box);
  }

  // ——— notifications: the guide's doorbell (rare whispers, never noise) ———
  const bellBtn = panel.querySelector(".vcb-bell");
  const pushCapable = () => {
    try {
      return (
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window &&
        new URL(API).origin === location.origin
      );
    } catch {
      return false;
    }
  };
  function urlB64(u) {
    const pad = "=".repeat((4 - (u.length % 4)) % 4);
    const raw = atob((u + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  function syncBell() {
    if (!bellBtn) return;
    if (!pushCapable()) {
      bellBtn.style.display = "none";
      return;
    }
    bellBtn.classList.toggle("on", !!journey.push && Notification.permission === "granted");
  }
  async function pushSubscribe() {
    const kr = await fetch(`${API}/api/push/key`).then((r) => r.json()).catch(() => null);
    if (!kr?.ready || !kr.key) return false;
    const reg = await navigator.serviceWorker.register("/sw.js");
    if ((await Notification.requestPermission()) !== "granted") return false;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(kr.key) });
    await fetch(`${API}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // lang: auto-messages arrive in the seeker's own language
      body: JSON.stringify({ subscription: sub.toJSON(), lang: recLang && recLang.startsWith("en") ? "en" : "hi", uid: journey.uid || "" }),
    }).catch(() => {});
    journey.push = 1;
    journey.pushLinked = journey.uid || ""; // which identity this phone's doorbell belongs to
    saveJourney();
    syncBell();
    return true;
  }
  async function pushUnsubscribe() {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        fetch(`${API}/api/push/unsubscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch {
      /* best effort */
    }
    journey.push = 0;
    saveJourney();
    syncBell();
  }
  bellBtn?.addEventListener("click", () => {
    if (journey.push && Notification.permission === "granted") {
      pushUnsubscribe();
      return;
    }
    if (needSignup()) return; // identity first, doorbell second
    pushSubscribe().catch(() => {});
  });
  syncBell();

  // The offer returns on EVERY open until notifications are on. States:
  // granted-but-unlinked → silently re-link, no card; default → ask card;
  // denied → card whose Yes explains the phone's Settings path (the OS never
  // re-shows its prompt once denied — no app can force that).
  let bellOfferedThisOpen = false;
  function maybeOfferBell() {
    if (EMBED) return; // inside the app, the app owns phone notifications
    if (!pushCapable() || bellOfferedThisOpen) return;
    if (!journey.uid) return; // sign-up comes first; the offer follows identity
    if (journey.push && Notification.permission === "granted") {
      // subscribed under an older (or no) identity? re-link it silently
      if (journey.pushLinked !== journey.uid) pushSubscribe().catch(() => {});
      return;
    }
    if (Notification.permission === "granted") {
      pushSubscribe().catch(() => {}); // permission exists — just reconnect quietly
      return;
    }
    if (panel.querySelector(".vcb-namecard")) return; // let the name moment breathe first
    bellOfferedThisOpen = true;
    const card = document.createElement("div");
    card.className = "vcb-ans vcb-bellask";
    const p = document.createElement("p");
    p.textContent =
      "🔔 Would you like gentle reminders from your guide? Sunday's new teaching and Purnima/Navratri alerts — that's all, never daily noise.";
    const row = document.createElement("div");
    row.className = "vcb-bellrow";
    const yes = document.createElement("button");
    yes.className = "vcb-bellyes";
    yes.textContent = "Allow reminders 🙏";
    const no = document.createElement("button");
    no.className = "vcb-bellno";
    no.textContent = "Not now";
    yes.addEventListener("click", () => {
      yes.disabled = true;
      pushSubscribe()
        .then((ok) => {
          if (ok) return card.remove();
          if (Notification.permission === "denied") {
            p.textContent =
              "🔕 Notifications are blocked for this app on your phone. Open Settings → Notifications → Ask Your Guide, allow them, then tap the 🔔 at the top.";
            row.remove();
          } else {
            card.remove();
          }
        })
        .catch(() => card.remove());
    });
    no.addEventListener("click", () => card.remove());
    row.append(yes, no);
    card.append(p, row);
    if (panel.dataset.mode === "text") {
      msgs.appendChild(card);
      msgs.scrollTop = msgs.scrollHeight;
    } else {
      capAdd(card);
    }
  }

  let greeted = false;
  function toggle(open) {
    panel.classList.toggle("open", open);
    document.documentElement.classList.toggle("vcb-lock", open && matchMedia("(max-width:640px)").matches);
    if (!open) {
      stopSpeaking();
      if (listening) { rec?.stop(); cancelRecording(); }
    }
    if (open) {
      hideNudge();
      playSplash();
      maybeAskName();
      thoughtShownThisOpen = false;
      fetchThought();
      bellOfferedThisOpen = false;
      maybeOfferBell();
      notifWelcome();
      noticeShownThisOpen = false;
      showAnnouncement();
      if (typeof journey.credits === "number") renderCredits(journey.credits); // instant from cache
      refreshCredits(); // then the live figure from the server
      if (panel.dataset.mode === "text") input.focus();
      else {
        setVState("idle");
        // the guide honors the seeker's own practice — a quiet day-count strip
        if (journey.sadhana?.since && !panel.querySelector(".vcb-streak")) {
          const days = Math.max(1, Math.floor((Date.now() - new Date(journey.sadhana.since).getTime()) / 864e5) + 1);
          const st = document.createElement("div");
          st.className = "vcb-streak";
          st.textContent = `📿 आपकी साधना — दिन ${days}`;
          capAdd(st);
        }
        if (cameBack && !welcomedBack) {
          welcomedBack = true;
          const w = document.createElement("div");
          w.className = "vcb-you";
          w.textContent = `🙏 ${todGreet()}${journey.name ? `, ${journey.name} जी` : ""} — वापसी पर स्वागत! पिछली बार: “${journey.asked[journey.asked.length - 1].q.slice(0, 60)}”`;
          capAdd(w);
          presentCheckin((q) => {
            const d = document.createElement("div");
            d.className = "vcb-ans";
            d.textContent = q;
            capAdd(d);
          });
          if (journey.lastFollowups?.length) capAdd(chipsEl(journey.lastFollowups, ASK_MORE()));
          fetchNextStep();
        }
      }
    }
  }
  let welcomedBack = false;

  // ——— opened from a notification: the guide starts THAT conversation ———
  // sw.js appends ?n_t/n_b when a guide-targeted notification is tapped.
  const notifCtx = (() => {
    try {
      const sp = new URLSearchParams(location.search);
      const t = (sp.get("n_t") || "").trim();
      const b = (sp.get("n_b") || "").trim();
      if (!t && !b) return null;
      history_cleanup: {
        const clean = location.pathname + location.hash;
        window.history.replaceState(null, "", clean); // refresh won't re-trigger
      }
      return { t, b };
    } catch {
      return null;
    }
  })();
  // Open a living conversation ABOUT a message (a tapped push, or an in-bot
  // notice the seeker chose to "go for"). Same doorstep treatment either way.
  async function converseAbout(msg) {
    msg = String(msg || "").slice(0, 300);
    if (!msg) return;
    if (panel.dataset.mode !== "text") setVState("thinking");
    try {
      const data = await askServer(msg, "notification");
      if (panel.dataset.mode === "text") {
        addMessage("bot", data.answer, data, msg);
        if (data.followups?.length) {
          msgs.appendChild(chipsEl(data.followups, ASK_MORE()));
          msgs.scrollTop = msgs.scrollHeight;
        }
      } else {
        const ans = document.createElement("div");
        ans.className = "vcb-ans";
        ans.textContent = data.answer;
        enrichAnswer(ans, data, msg);
        capAdd(ans);
        if (data.followups?.length) capAdd(chipsEl(data.followups, ASK_MORE()));
        panel.dataset.hasAns = "1";
        cap.scrollTop += ans.getBoundingClientRect().top - cap.getBoundingClientRect().top - 4;
        setVState("speaking");
        speak(data.answer, () => setVState("idle"));
      }
    } catch {
      if (panel.dataset.mode !== "text") setVState("idle");
    }
  }
  let notifOpened = false;
  async function notifWelcome() {
    if (!notifCtx || notifOpened) return;
    notifOpened = true;
    await converseAbout(`${notifCtx.t}${notifCtx.b ? " — " + notifCtx.b : ""}`);
  }

  // ——— the in-bot notice: an admin message shown when the seeker opens the
  // guide. They "go for it" (a conversation opens about it) or dismiss; shown
  // once per device. This is how admin notices reach app users (no phone push).
  let noticeShownThisOpen = false;
  async function showAnnouncement() {
    if (noticeShownThisOpen || notifCtx) return; // a tapped push already brought a message
    noticeShownThisOpen = true;
    let a = null;
    try {
      const r = await fetch(`${API}/api/announcement`);
      a = (await r.json())?.announcement;
    } catch {
      return; // offline — nothing to show
    }
    if (!a || !a.id || journey.seenAnnounce.includes(a.id)) return;
    const markSeen = () => {
      if (!journey.seenAnnounce.includes(a.id)) journey.seenAnnounce.push(a.id);
      if (journey.seenAnnounce.length > 40) journey.seenAnnounce.splice(0, journey.seenAnnounce.length - 40);
      saveJourney();
    };
    const card = document.createElement("div");
    card.className = "vcb-ans vcb-bellask vcb-notice";
    const p = document.createElement("p");
    p.textContent = `📣 ${a.title ? a.title + " — " : ""}${a.text}`;
    const row = document.createElement("div");
    row.className = "vcb-bellrow";
    const go = document.createElement("button");
    go.className = "vcb-bellyes";
    go.textContent = uiLang === "en" ? "Open 🙏" : "देखिए 🙏";
    const later = document.createElement("button");
    later.className = "vcb-bellno";
    later.textContent = uiLang === "en" ? "Not now" : "बाद में";
    go.addEventListener("click", () => {
      markSeen();
      card.remove();
      if (a.link) window.open(a.link, "_blank", "noopener");
      converseAbout(`${a.title ? a.title + ". " : ""}${a.text}`);
    });
    later.addEventListener("click", () => {
      markSeen();
      card.remove();
    });
    row.append(go, later);
    card.append(p, row);
    if (panel.dataset.mode === "text") {
      msgs.appendChild(card);
      msgs.scrollTop = msgs.scrollHeight;
    } else {
      capAdd(card);
    }
  }

  // Sign-up before first use (owner's rule): the registry lets Ashaeiynn know
  // members from visitors. The guide addresses the seeker by their nickname.
  function maybeAskName() {
    if (journey.uid || panel.querySelector(".vcb-namecard")) return;
    const card = document.createElement("div");
    card.className = "vcb-namecard";
    const h = document.createElement("h4");
    h.textContent = "🙏 जय सिया राम — Welcome to Ashaeiynn Guide";
    const p = document.createElement("p");
    p.textContent = "A one-time introduction before your journey begins. Your details stay with Ashaeiynn only.";
    const name = document.createElement("input");
    name.placeholder = "Full name";
    name.maxLength = 80;
    name.value = "";
    const nick = document.createElement("input");
    nick.placeholder = "Nickname — what should the guide call you?";
    nick.maxLength = 40;
    nick.value = journey.name || "";
    const wa = document.createElement("input");
    wa.placeholder = "WhatsApp number";
    wa.maxLength = 20;
    wa.inputMode = "tel";
    const em = document.createElement("input");
    em.placeholder = "Email ID";
    em.maxLength = 120;
    em.inputMode = "email";
    const err = document.createElement("p");
    err.style.cssText = "color:#ff9d76;font-size:12.5px;min-height:16px;margin:0";
    const go = document.createElement("button");
    go.className = "vcb-namego";
    go.textContent = "Begin the journey 🙏";
    const submit = async () => {
      err.textContent = "";
      go.disabled = true;
      go.textContent = "One moment…";
      try {
        const r = await fetch(`${API}/api/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.value, nick: nick.value, whatsapp: wa.value, email: em.value }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not sign up — try again.");
        journey.uid = d.uid;
        journey.name = d.nick;
        saveJourney();
        if (typeof d.credits === "number") renderCredits(d.credits); // welcome balance
        card.remove();
        // now that they have an identity, offer the doorbell straight away —
        // no waiting for a reopen (it then returns every open until allowed)
        maybeOfferBell();
      } catch (e2) {
        err.textContent = e2.message;
        go.disabled = false;
        go.textContent = "Begin the journey 🙏";
      }
    };
    go.addEventListener("click", submit);
    em.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    card.append(h, p, name, nick, wa, em, err, go);
    panel.appendChild(card);
  }

  // आज का विचार — the daily प्रसाद: one thought from the teachings, shown
  // once per day when the app opens (same thought for every seeker that day)
  // आज का विचार — shown on every open; TAPPING it starts a conversation on it
  let thoughtShownThisOpen = false;
  function fetchThought() {
    if (thoughtShownThisOpen) return;
    fetch(`${API}/api/thought`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (!t?.text || thoughtShownThisOpen) return;
        thoughtShownThisOpen = true;
        const box = document.createElement("div");
        box.className = "vcb-ans";
        box.style.cursor = "pointer";
        box.setAttribute("role", "button");
        const head = document.createElement("div");
        head.style.cssText = "color:#e8c987;font-weight:700;margin-bottom:6px;font-size:13px";
        head.textContent = t("thoughtTitle");
        box.appendChild(head);
        box.appendChild(document.createTextNode(t.text));
        const src = document.createElement("div");
        src.className = "vcb-src";
        src.textContent = t("thoughtTap");
        box.appendChild(src);
        box.addEventListener("click", () => {
          askChip(`आज का विचार: "${t.text.slice(0, 140)}" — इसे और गहराई से समझाइए`, "thought");
        });
        if (panel.dataset.mode === "text") {
          msgs.appendChild(box);
          msgs.scrollTop = msgs.scrollHeight;
        } else {
          capAdd(box);
        }
      })
      .catch(() => {});
  }

  // returning seeker: fetch one fresh pick matched to their whole journey
  function fetchNextStep() {
    fetch(`${API}/api/next-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: journey.summary || "",
        topics: journey.asked.slice(-5).map((a) => a.q),
        seen: journey.seen,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.suggest) return;
        recordSeen([d.suggest.title]);
        const box = document.createElement("div");
        box.className = "vcb-ans";
        box.append("🌱 आपकी यात्रा के लिए एक सुझाव: ");
        if (d.suggest.url) {
          const a = document.createElement("a");
          a.href = d.suggest.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = `${d.suggest.title} (${d.suggest.timestamp})`;
          a.addEventListener("click", () => recoOpened(d.suggest.title));
          box.appendChild(a);
        } else {
          box.append(`${d.suggest.title} (${d.suggest.timestamp})`);
        }
        capAdd(box);
      })
      .catch(() => {});
  }
  btn.addEventListener("click", () => {
    // Unlock speech HERE — a tap that opens the guide, never one that records.
    // iOS only permits speech that began in a user gesture, and this is the one
    // gesture every visit starts with.
    primeVoice();
    toggle(!panel.classList.contains("open"));
  });
  // the × close button was removed (not needed inside the app / full-screen guide)
  panel.querySelector(".vcb-close")?.addEventListener("click", () => toggle(false));

  // Opened as an installed home-screen app, or on the bot's own page from a
  // phone → open the guide immediately, app-style. Embedded on other websites
  // (e.g. WordPress) nothing changes: visitors still tap the orb first.
  const ownPage = (() => {
    try { return new URL(script.src).origin === location.origin; } catch { return false; }
  })();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // App-embed always opens straight into the guide (the app's button is the tap);
  // so do installed apps and the bot's own page on a phone.
  if (EMBED || standalone || (ownPage && matchMedia("(max-width:640px)").matches)) toggle(true);

  form.addEventListener("submit", async (e) => {
    primeVoice(); // same gate applies when the seeker types instead
    e.preventDefault();
    if (needSignup()) return;
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    addMessage("user", text);

    const typing = document.createElement("div");
    typing.className = "vcb-typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;
    send.disabled = true;

    try {
      const data = await askServer(text);
      typing.remove();
      addMessage("bot", data.answer, data, text);
      if (data.followups?.length) {
        msgs.appendChild(chipsEl(data.followups, ASK_MORE()));
        msgs.scrollTop = msgs.scrollHeight;
      }
      maybeOfferBell();
      speak(data.answer);
    } catch (err) {
      typing.remove();
      addMessage("bot", err.message);
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
})();
