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
  const TITLE = script?.dataset.title || "Ask Your Guide";
  const COLOR = script?.dataset.color || "#0b0b0f";
  const SPLASH = script?.dataset.splash || "जय सिया राम";
  const SPLASH_SUB = script?.dataset.splashSub || "JAI SIYA RAM";

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
  // returning after 3+ hours (not just a page reload in the same sitting)?
  const cameBack =
    journey.asked.length > 0 &&
    journey.lastSeen &&
    Date.now() - new Date(journey.lastSeen).getTime() > 3 * 3600 * 1000;
  history.push(...journey.convo.slice(-6)); // follow-ups survive app restarts
  function saveJourney() {
    journey.lastSeen = new Date().toISOString();
    try {
      localStorage.setItem(J_KEY, JSON.stringify(journey));
    } catch {
      /* private mode — the guide still answers, just without memory */
    }
  }
  function recordAsk(q) {
    journey.asked.push({ q: q.slice(0, 120), at: new Date().toISOString() });
    if (journey.asked.length > 30) journey.asked.splice(0, journey.asked.length - 30);
    saveJourney();
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
    .vcb-ava{width:36px;height:36px;border-radius:50%;flex-shrink:0;font-size:17px;
      display:flex;align-items:center;justify-content:center;color:#b8f5dc;
      background:radial-gradient(circle at 35% 30%,#1c1c26,#0a0a10);
      box-shadow:0 0 0 1.5px rgba(52,211,153,.55),0 0 14px rgba(52,211,153,.25)}
    .vcb-title{font-weight:700;font-size:15px;line-height:1.2;color:#fff}
    .vcb-sub{font-size:11.5px;color:rgba(255,236,182,.75);font-weight:400;margin-top:1px}
    .vcb-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.85}
    .vcb-close:hover{opacity:1}

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
    .vcb-src a{color:#34d399;text-decoration:none;font-weight:500}
    .vcb-src a:hover{text-decoration:underline}

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
      padding:12px 14px;width:100%;animation:vcbMsgIn .3s ease both;backdrop-filter:blur(3px)}
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
    .vcb-lock,.vcb-lock body{overflow:hidden;overscroll-behavior:none}
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
  panel.className = "vcb-panel";
  panel.innerHTML = `
    <div class="vcb-cosmos">
      <div class="vcb-galaxy">
        <div class="vcb-starfield s1"></div><div class="vcb-starfield s2"></div>
      </div>
      <div class="vcb-neb n1"></div><div class="vcb-neb n2"></div><div class="vcb-neb n3"></div>
      <div class="vcb-solar"></div>
      <span class="vcb-shoot"></span><span class="vcb-shoot sh2"></span>
    </div>
    <div class="vcb-head">
      <div class="vcb-head-left">
        <div class="vcb-ava"><img src="${API}/logo.png?v=3" alt=""/></div>
        <div><div class="vcb-title">${TITLE}</div><div class="vcb-sub">Ashaeiynn · answers from the teachings</div></div>
      </div>
      <div><button class="vcb-voice" aria-label="Voice replies" title="Voice replies">🔇</button><button class="vcb-close" aria-label="Close">×</button></div>
    </div>
    <div class="vcb-bless"><span>${SPLASH}</span></div>
    <div class="vcb-stage">
      <div class="vcb-cap"></div>
      <button class="vcb-orbbig" type="button" aria-label="Ask by voice">
        <svg class="vcb-mic-big" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="vcbMicGold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#b8f5dc"/><stop offset="55%" stop-color="#34d399"/><stop offset="100%" stop-color="#17996a"/>
          </linearGradient></defs>
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" stroke="url(#vcbMicGold)" stroke-width="1.8" fill="rgba(52,211,153,.12)"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="url(#vcbMicGold)" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="12" y1="18" x2="12" y2="22" stroke="url(#vcbMicGold)" stroke-width="1.8" stroke-linecap="round"/>
          <line x1="8.5" y1="22" x2="15.5" y2="22" stroke="url(#vcbMicGold)" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
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
    </form>`;

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
  const cosmos = panel.querySelector(".vcb-cosmos");
  for (let i = 0; i < 16; i++) {
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

  const hasDevanagari = (t) => /[ऀ-ॿ]/.test(t);
  let naturalVoice = false; // does the server offer a human voice? (probed at load)
  fetch(`${API}/health`).then((r) => r.json()).then((h) => (naturalVoice = !!h.naturalVoice)).catch(() => {});
  let currentAudio = null;

  const cleanForSpeech = (text) =>
    text
      .split("\n")
      .filter((l) => !/^\s*(source|watch)\s*:/i.test(l)) // sources are shown, not spoken
      .join("\n")
      .replace(/https?:\S+/g, "")
      .replace(/[*_#\`~]+/g, "") // never read formatting symbols aloud
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .trim();

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

  // Speak sentence by sentence: natural breathing pauses, and it sidesteps the
  // Chrome bug that silently cuts single long utterances at ~15 seconds.
  function browserSpeak(clean, done) {
    if (!("speechSynthesis" in window)) return done();
    speechSynthesis.cancel();
    const lang = hasDevanagari(clean) ? "hi-IN" : "en-IN";
    const voice = pickVoice(lang);
    const sentences = clean
      .split(/(?<=[।॥.!?])\s+/)
      .flatMap((s) => (s.length > 240 ? s.split(/(?<=,)\s+/) : [s]))
      .map((s) => s.trim())
      .filter(Boolean);
    if (!sentences.length) return done();
    let i = 0;
    let cancelled = false;
    const next = () => {
      if (cancelled) return;
      if (i >= sentences.length) return done();
      const u = new SpeechSynthesisUtterance(sentences[i++]);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 0.97;
      u.pitch = 1.02;
      u.onend = () => setTimeout(next, 150); // a small breath between sentences
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
        onDone && onDone();
      }
    };
    if (!voiceReplies) return done();
    const clean = cleanForSpeech(text);
    if (!clean) return done();

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
              const audio = new Audio(URL.createObjectURL(blob));
              currentAudio = audio;
              audio.onended = resolve;
              audio.onerror = reject;
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
        const a = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=");
        a.play().catch(() => {});
        if ("speechSynthesis" in window) speechSynthesis.getVoices(); // warm the voice list
      } catch { /* best effort */ }
    },
    { once: true, capture: true },
  );

  // ——— shared: ask the backend one question ———
  async function askServer(text, via) {
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
          via: via || "text",
          lang: recLang,
          profile: { topics: journey.asked.slice(-8).map((a) => a.q), seen: journey.seen },
        }),
      });
      data = await resp.json();
    } catch {
      throw new Error("Sorry, I couldn't reach the server. Please try again.");
    }
    if (!resp.ok) throw new Error(data.error || "Sorry, something went wrong. Please try again.");
    history.push({ role: "user", content: text }, { role: "assistant", content: data.answer });
    if (history.length > 12) history.splice(0, history.length - 12);
    journey.convo = history.slice(-12);
    recordAsk(text);
    if (data.sources?.length) recordSeen(data.sources.map((s) => s.title));
    if (data.suggest) recordSeen([data.suggest.title]);
    return data;
  }

  // ——— voice-first stage: state machine (idle → listening → thinking → speaking) ———
  const STATUS = {
    idle: 'माइक को दबाइए और <b>बोलिए</b> — हिंदी या English<br>Tap the mic and <b>speak</b> your question',
    listening: '🎙️ <b>सुन रहे हैं… बोलिए</b> · listening — tap to finish',
    thinking: '🔎 उत्तर खोज रहे हैं… finding your answer…',
    speaking: '🔊 <b>उत्तर</b> · tap to stop',
    error: 'Mic नहीं चला — फिर से दबाइए · mic didn\'t start, tap again',
  };
  function setVState(s) {
    panel.dataset.vstate = s;
    statusEl.innerHTML = STATUS[s] || "";
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
      if (data.sources?.length) {
        const src = document.createElement("div");
        src.className = "vcb-src";
        src.append("Watch: ");
        data.sources.forEach((s, i) => {
          if (i > 0) src.append(" · ");
          if (s.url) {
            const a = document.createElement("a");
            a.href = s.url;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = `${s.title} (${s.timestamp})`;
            src.appendChild(a);
          } else {
            src.append(`${s.title} (${s.timestamp})`);
          }
        });
        ans.appendChild(src);
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
          a.textContent = `${data.suggest.title} (${data.suggest.timestamp})`;
          sug.appendChild(a);
        } else {
          sug.append(`${data.suggest.title} (${data.suggest.timestamp})`);
        }
        ans.appendChild(sug);
      }
      capAdd(ans);
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

  function startListening(target) {
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
        input.placeholder = "🎙️ बोलिए… (listening)";
      }
    } catch {
      listening = false;
      if (target === "stage") setVState("error");
    }
  }

  if (!SR) {
    // no speech recognition (e.g. Firefox): fall back to classic text chat
    micBtn.style.display = "none";
    kbdBtn.style.display = "none";
    stage.dataset.unsupported = "1";
  } else {
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
    rec.onend = () => {
      listening = false;
      micBtn.classList.remove("listening");
      input.placeholder = "Type your question…";
      const fin = (rec._final || "").trim();
      if (rec._target === "stage") {
        if (fin) voiceAsk(fin);
        else {
          if (liveEl) {
            liveEl.remove();
            liveEl = null;
          }
          setVState("idle");
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
      } else if (!input.value.trim()) {
        input.placeholder = "Mic not available — please type…";
      }
    };

    // the big eye: idle→listen · listening→finish · speaking→stop
    orb.addEventListener("click", () => {
      const s = panel.dataset.vstate;
      if (listening) rec.stop();
      else if (s === "speaking") {
        stopSpeaking();
        setVState("idle");
      } else if (s !== "thinking") startListening("stage");
    });

    // language switch: Hindi ↔ English recognition
    langBtn.addEventListener("click", () => {
      recLang = recLang.startsWith("hi") ? "en-IN" : "hi-IN";
      langBtn.textContent = recLang.startsWith("hi") ? "भाषा: हिंदी" : "Language: English";
      if (listening) rec.stop();
    });
  }

  // ——— mode switching: voice stage ⇄ classic typing ———
  function setMode(m) {
    panel.dataset.mode = m;
    if (m === "text") {
      stopSpeaking();
      if (listening) rec?.stop();
      if (!greeted) {
        greeted = true;
        addMessage(
          "bot",
          cameBack
            ? `Jai Siya Ram 🙏 वापसी पर स्वागत! पिछली बार आपने पूछा था: “${journey.asked[journey.asked.length - 1].q.slice(0, 80)}” — आगे जो मन में हो, पूछिए।`
            : "Jai Siya Ram 🙏 Ask me anything about the teachings — I'll find the answer from our videos.",
        );
      }
      input.focus();
    } else {
      setVState("idle");
    }
  }
  kbdBtn.addEventListener("click", () => setMode("text"));
  micBtn.addEventListener("click", () => {
    // the mic in the typing bar returns to the voice stage and starts listening
    setMode("voice");
    startListening("stage");
  });
  panel.dataset.mode = SR ? "voice" : "text";

  // ——— opening blessing: splash rises, then docks into the golden strip ———
  let splashTimers = [];
  function playSplash() {
    panel.querySelector(".vcb-splash")?.remove();
    splashTimers.forEach(clearTimeout);
    splashTimers = [];
    bless.classList.remove("show");

    const s = document.createElement("div");
    s.className = "vcb-splash";
    const words = SPLASH.split(/\s+/)
      .map((w, i) => `<span style="animation-delay:${0.12 + i * 0.22}s">${w}</span>`)
      .join("");
    s.innerHTML = `
      <div class="vcb-splash-halo"></div>
      <div class="vcb-splash-inner">
        <div class="vcb-splash-hi">${words}</div>
        <div class="vcb-splash-line"></div>
        <div class="vcb-splash-en">${SPLASH_SUB}</div>
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

  function addMessage(role, text, sources, suggest) {
    const el = document.createElement("div");
    el.className = `vcb-m ${role}`;
    el.textContent = text;
    if (sources?.length) {
      const src = document.createElement("div");
      src.className = "vcb-src";
      src.append("Watch: ");
      sources.forEach((s, i) => {
        if (i > 0) src.append(" · ");
        if (s.url) {
          const a = document.createElement("a");
          a.href = s.url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = `${s.title} (${s.timestamp})`;
          src.appendChild(a);
        } else {
          src.append(`${s.title} (${s.timestamp})`);
        }
      });
      el.appendChild(src);
    }
    if (suggest) {
      const sug = document.createElement("div");
      sug.className = "vcb-src";
      sug.append("🌱 आगे देखिए: ");
      if (suggest.url) {
        const a = document.createElement("a");
        a.href = suggest.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = `${suggest.title} (${suggest.timestamp})`;
        sug.appendChild(a);
      } else {
        sug.append(`${suggest.title} (${suggest.timestamp})`);
      }
      el.appendChild(sug);
    }
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  let greeted = false;
  function toggle(open) {
    panel.classList.toggle("open", open);
    document.documentElement.classList.toggle("vcb-lock", open && matchMedia("(max-width:640px)").matches);
    if (!open) {
      stopSpeaking();
      if (listening) rec?.stop();
    }
    if (open) {
      hideNudge();
      playSplash();
      if (panel.dataset.mode === "text") input.focus();
      else {
        setVState("idle");
        if (cameBack && !welcomedBack) {
          welcomedBack = true;
          const w = document.createElement("div");
          w.className = "vcb-you";
          w.textContent = `🙏 वापसी पर स्वागत — पिछली बार: “${journey.asked[journey.asked.length - 1].q.slice(0, 60)}”`;
          capAdd(w);
        }
      }
    }
  }
  let welcomedBack = false;
  btn.addEventListener("click", () => toggle(!panel.classList.contains("open")));
  panel.querySelector(".vcb-close").addEventListener("click", () => toggle(false));

  // Opened as an installed home-screen app, or on the bot's own page from a
  // phone → open the guide immediately, app-style. Embedded on other websites
  // (e.g. WordPress) nothing changes: visitors still tap the orb first.
  const ownPage = (() => {
    try { return new URL(script.src).origin === location.origin; } catch { return false; }
  })();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone || (ownPage && matchMedia("(max-width:640px)").matches)) toggle(true);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
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
      addMessage("bot", data.answer, data.sources, data.suggest);
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
