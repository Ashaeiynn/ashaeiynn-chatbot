// Embeddable chat widget. Add to any site (WordPress, app webview, anything) with:
//   <script src="https://YOUR-CHATBOT-DOMAIN/widget.js" defer></script>
// Optional attributes:
//   data-api="https://YOUR-CHATBOT-DOMAIN"  (defaults to where the script came from)
//   data-title="Ask Your Guide"
//   data-color="#4f46e5"
//   data-splash="जय सिया राम"          (the blessing shown when the chat opens)
//   data-splash-sub="JAI SIYA RAM"
(() => {
  const script = document.currentScript;
  const API = (script?.dataset.api || new URL(script.src).origin).replace(/\/$/, "");
  const TITLE = script?.dataset.title || "Ask Your Guide";
  const COLOR = script?.dataset.color || "#4f46e5";
  const SPLASH = script?.dataset.splash || "जय सिया राम";
  const SPLASH_SUB = script?.dataset.splashSub || "JAI SIYA RAM";

  const history = [];

  const style = document.createElement("style");
  style.textContent = `
    .vcb-btn{position:fixed;bottom:20px;right:20px;width:62px;height:62px;border-radius:50%;
      background:radial-gradient(circle at 34% 28%,#3b2f80 0%,#241b56 45%,#120d33 100%);
      border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
      z-index:999998;transition:transform .2s ease;
      box-shadow:0 0 0 1.5px rgba(247,201,72,.6),0 0 22px rgba(247,201,72,.35),0 8px 24px rgba(0,0,0,.5);
      animation:vcbBreathe 3.6s ease-in-out infinite}
    .vcb-btn:hover{transform:scale(1.1)}
    @keyframes vcbBreathe{0%,100%{box-shadow:0 0 0 1.5px rgba(247,201,72,.55),0 0 16px rgba(247,201,72,.28),0 8px 24px rgba(0,0,0,.5)}
      50%{box-shadow:0 0 0 2px rgba(247,201,72,.85),0 0 34px rgba(247,201,72,.5),0 8px 24px rgba(0,0,0,.5)}}
    .vcb-btn::after{content:"";position:absolute;inset:-5px;border-radius:50%;
      border:2px solid #f7c948;opacity:0;animation:vcbPing 3.6s ease-out infinite}
    @keyframes vcbPing{0%{transform:scale(.9);opacity:.5}70%{transform:scale(1.4);opacity:0}100%{opacity:0}}
    .vcb-eye{width:34px;height:34px;filter:drop-shadow(0 0 8px rgba(247,201,72,.55))}
    .vcb-nudge{position:fixed;bottom:32px;right:94px;z-index:999997;cursor:pointer;
      background:linear-gradient(135deg,#ffe9a8,#f2b93c);color:#241a04;
      border:none;border-radius:999px;padding:10px 16px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      font-size:13.5px;font-weight:700;white-space:nowrap;
      box-shadow:0 6px 22px rgba(0,0,0,.4),0 0 24px rgba(247,201,72,.45);
      opacity:0;transform:translateX(12px);pointer-events:none;
      transition:opacity .5s ease,transform .5s ease}
    .vcb-nudge.show{opacity:1;transform:translateX(0);pointer-events:auto;animation:vcbNudgeFloat 3s ease-in-out infinite}
    @keyframes vcbNudgeFloat{0%,100%{transform:translateX(0) translateY(0)}50%{transform:translateX(0) translateY(-4px)}}
    .vcb-nudge::after{content:"";position:absolute;right:-4px;top:50%;width:10px;height:10px;
      background:#f2b93c;transform:translateY(-50%) rotate(45deg)}

    .vcb-panel{position:fixed;bottom:92px;right:20px;width:min(380px,calc(100vw - 32px));
      height:min(580px,calc(100vh - 124px));border-radius:22px;z-index:999999;
      background:radial-gradient(135% 100% at 50% 28%,#0b0b14 0%,#040407 55%,#000 100%);
      box-shadow:0 22px 70px rgba(8,5,30,.65),0 0 0 1px rgba(247,201,72,.14);
      display:none;flex-direction:column;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      transform-origin:bottom right}
    .vcb-panel.open{display:flex;animation:vcbPanelIn .4s cubic-bezier(.18,.89,.32,1.15)}
    @keyframes vcbPanelIn{from{opacity:0;transform:scale(.86) translateY(16px)}to{opacity:1;transform:scale(1) translateY(0)}}

    /* ——— animated universe (slow motion) ——— */
    .vcb-cosmos{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
    .vcb-neb{position:absolute;border-radius:50%;filter:blur(26px);will-change:transform}
    .vcb-neb.n1{width:340px;height:300px;left:-90px;top:6%;
      background:radial-gradient(ellipse at 40% 45%,rgba(124,58,237,.16) 0%,rgba(79,70,229,.08) 45%,transparent 72%);
      animation:vcbNeb1 90s ease-in-out infinite alternate}
    .vcb-neb.n2{width:300px;height:280px;right:-80px;bottom:8%;
      background:radial-gradient(ellipse at 55% 50%,rgba(247,201,72,.07) 0%,rgba(217,120,50,.05) 40%,transparent 70%);
      animation:vcbNeb2 110s ease-in-out infinite alternate}
    .vcb-neb.n3{width:240px;height:220px;left:24%;bottom:-70px;
      background:radial-gradient(ellipse at 50% 50%,rgba(56,130,246,.08) 0%,transparent 68%);
      animation:vcbNeb1 130s ease-in-out infinite alternate-reverse}
    @keyframes vcbNeb1{from{transform:translate(0,0) rotate(0deg) scale(1)}to{transform:translate(46px,30px) rotate(28deg) scale(1.18)}}
    @keyframes vcbNeb2{from{transform:translate(0,0) rotate(0deg) scale(1.1)}to{transform:translate(-38px,-26px) rotate(-24deg) scale(.95)}}
    .vcb-galaxy{position:absolute;inset:-42%;animation:vcbGalaxy 780s linear infinite;will-change:transform}
    @keyframes vcbGalaxy{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .vcb-starfield{position:absolute;inset:-240px 0 0 0;background-repeat:repeat;will-change:background-position}
    .vcb-starfield.s1{background-size:240px 240px;opacity:.7;animation:vcbDrift1 210s linear infinite;
      background-image:radial-gradient(1.1px 1.1px at 22px 34px,rgba(255,255,255,.55) 50%,transparent 51%),
        radial-gradient(1px 1px at 118px 90px,rgba(255,255,255,.4) 50%,transparent 51%),
        radial-gradient(1.3px 1.3px at 197px 156px,rgba(247,201,72,.5) 50%,transparent 51%),
        radial-gradient(1px 1px at 68px 198px,rgba(255,255,255,.35) 50%,transparent 51%),
        radial-gradient(1.2px 1.2px at 160px 44px,rgba(190,200,255,.45) 50%,transparent 51%)}
    .vcb-starfield.s2{background-size:320px 320px;opacity:.45;animation:vcbDrift2 340s linear infinite;
      background-image:radial-gradient(1px 1px at 44px 120px,rgba(255,255,255,.4) 50%,transparent 51%),
        radial-gradient(.9px .9px at 210px 60px,rgba(255,255,255,.32) 50%,transparent 51%),
        radial-gradient(1.1px 1.1px at 280px 230px,rgba(247,201,72,.38) 50%,transparent 51%),
        radial-gradient(.9px .9px at 120px 280px,rgba(190,200,255,.3) 50%,transparent 51%)}
    @keyframes vcbDrift1{from{background-position:0 0}to{background-position:-240px 240px}}
    @keyframes vcbDrift2{from{background-position:0 0}to{background-position:320px 320px}}
    .vcb-twinkle{position:absolute;border-radius:50%;background:#fff;will-change:opacity,transform;
      animation:vcbTwinkle ease-in-out infinite}
    @keyframes vcbTwinkle{0%,100%{opacity:.12;transform:scale(.8)}50%{opacity:.85;transform:scale(1.25)}}
    .vcb-shoot{position:absolute;top:12%;left:-30%;width:110px;height:1.5px;border-radius:2px;
      background:linear-gradient(90deg,transparent,rgba(255,255,255,.85),rgba(247,201,72,.9),transparent);
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
      background:linear-gradient(135deg,rgba(79,70,229,.55),rgba(124,58,237,.4));
      backdrop-filter:blur(6px);border-bottom:1px solid rgba(247,201,72,.22)}
    .vcb-head-left{display:flex;align-items:center;gap:11px}
    .vcb-ava{width:36px;height:36px;border-radius:50%;flex-shrink:0;font-size:17px;
      display:flex;align-items:center;justify-content:center;color:#ffe9a8;
      background:radial-gradient(circle at 35% 30%,#3a2f7d,#241b56);
      box-shadow:0 0 0 1.5px rgba(247,201,72,.55),0 0 14px rgba(247,201,72,.25)}
    .vcb-title{font-weight:700;font-size:15px;line-height:1.2;color:#fff}
    .vcb-sub{font-size:11.5px;color:rgba(255,236,182,.75);font-weight:400;margin-top:1px}
    .vcb-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.85}
    .vcb-close:hover{opacity:1}

    /* the docked blessing strip */
    .vcb-bless{position:relative;z-index:2;text-align:center;padding:6px 0 7px;
      font-family:Georgia,'Noto Serif Devanagari',serif;font-size:15px;font-weight:700;
      letter-spacing:.06em;border-bottom:1px solid rgba(247,201,72,.14);
      background:linear-gradient(90deg,transparent,rgba(247,201,72,.07),transparent);
      opacity:0;transition:opacity .6s ease}
    .vcb-bless.show{opacity:1}
    .vcb-bless span{background:linear-gradient(100deg,#b8860b 0%,#ffe9a8 28%,#f7c948 50%,#ffe9a8 72%,#b8860b 100%);
      background-size:220% 100%;-webkit-background-clip:text;background-clip:text;
      -webkit-text-fill-color:transparent;animation:vcbShimmer 4.5s linear infinite}
    @keyframes vcbShimmer{from{background-position:220% 0}to{background-position:-220% 0}}

    .vcb-msgs{position:relative;z-index:1;flex:1;overflow-y:auto;padding:16px 14px;
      display:flex;flex-direction:column;gap:10px}
    .vcb-msgs::-webkit-scrollbar{width:6px}
    .vcb-msgs::-webkit-scrollbar-thumb{background:rgba(247,201,72,.25);border-radius:3px}
    .vcb-m{max-width:86%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.55;
      white-space:pre-wrap;word-wrap:break-word;animation:vcbMsgIn .3s ease both}
    @keyframes vcbMsgIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}
    .vcb-m.user{align-self:flex-end;color:#241a04;font-weight:500;
      background:linear-gradient(135deg,#ffe9a8,#f2b93c);
      border-bottom-right-radius:5px;box-shadow:0 3px 12px rgba(247,201,72,.25)}
    .vcb-m.bot{align-self:flex-start;color:#eeeafc;
      background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.09);
      border-bottom-left-radius:5px;backdrop-filter:blur(3px)}
    .vcb-src{font-size:12px;margin-top:8px;padding-top:8px;border-top:1px dashed rgba(247,201,72,.3);color:#9d96c4}
    .vcb-src a{color:#f7c948;text-decoration:none;font-weight:500}
    .vcb-src a:hover{text-decoration:underline}

    .vcb-form{position:relative;z-index:2;display:flex;gap:8px;padding:12px;
      border-top:1px solid rgba(247,201,72,.16);background:rgba(2,2,6,.65)}
    .vcb-input{flex:1;border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);
      color:#f2eefe;border-radius:12px;padding:10px 13px;font-size:14px;outline:none;transition:border-color .15s}
    .vcb-input::placeholder{color:#8d86b5}
    .vcb-input:focus{border-color:#f7c948}
    .vcb-send{background:linear-gradient(135deg,#ffe9a8,#f2b93c);color:#241a04;border:none;border-radius:12px;
      padding:0 17px;font-size:14px;font-weight:700;cursor:pointer;transition:filter .15s;
      box-shadow:0 2px 10px rgba(247,201,72,.3)}
    .vcb-send:hover{filter:brightness(1.06)}
    .vcb-send:disabled{opacity:.5;cursor:default}

    .vcb-typing{align-self:flex-start;display:flex;gap:5px;padding:12px 16px;
      background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.09);
      border-radius:16px;border-bottom-left-radius:5px}
    .vcb-typing i{width:7px;height:7px;border-radius:50%;background:#f7c948;opacity:.5;
      animation:vcbBounce 1.2s ease-in-out infinite}
    .vcb-typing i:nth-child(2){animation-delay:.15s}
    .vcb-typing i:nth-child(3){animation-delay:.3s}
    @keyframes vcbBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px);opacity:1}}

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
      background:radial-gradient(circle,rgba(247,201,72,.34) 0%,rgba(247,201,72,.08) 45%,transparent 70%);
      animation:vcbHalo 2s ease-out both}
    @keyframes vcbHalo{from{transform:scale(.35);opacity:0}45%{opacity:1}to{transform:scale(1.15);opacity:.85}}
    .vcb-splash-hi{display:flex;gap:.35em;font-size:37px;font-weight:800;z-index:1;
      font-family:Georgia,'Noto Serif Devanagari',serif}
    .vcb-splash-hi span{display:inline-block;opacity:0;
      background:linear-gradient(180deg,#ffe9a8 0%,#f7c948 55%,#d99a1e 100%);
      -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
      text-shadow:0 0 26px rgba(247,201,72,.45);
      animation:vcbRise .7s cubic-bezier(.22,1,.36,1) both}
    @keyframes vcbRise{from{opacity:0;transform:translateY(24px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
    .vcb-splash-en{z-index:1;color:rgba(255,236,182,.85);font-size:12.5px;letter-spacing:.42em;
      font-weight:600;opacity:0;animation:vcbRise .7s .62s ease both;padding-left:.42em}
    .vcb-splash-line{z-index:1;width:64px;height:1px;opacity:0;
      background:linear-gradient(90deg,transparent,#f7c948,transparent);
      animation:vcbRise .7s .78s ease both}
    .vcb-spark{position:absolute;bottom:-8px;border-radius:50%;pointer-events:none;
      background:radial-gradient(circle,#ffe9a8 0%,rgba(247,201,72,.85) 45%,transparent 75%);
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
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "vcb-btn";
  btn.setAttribute("aria-label", "Open chat");
  btn.innerHTML = `
    <svg class="vcb-eye" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vcbGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffe9a8"/><stop offset="55%" stop-color="#f7c948"/><stop offset="100%" stop-color="#d99a1e"/>
        </linearGradient>
      </defs>
      <path d="M4 20 Q17 9 30 20 Q17 31 4 20 Z" stroke="url(#vcbGold)" stroke-width="1.8" fill="rgba(247,201,72,.08)"/>
      <circle cx="17" cy="20" r="5" fill="url(#vcbGold)"/>
      <circle cx="17" cy="20" r="2" fill="#1c1745"/>
      <circle cx="15.4" cy="18.4" r="0.9" fill="#fff6d8"/>
      <path d="M17 7 L17 2.5" stroke="url(#vcbGold)" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M10.5 9.5 L8 6" stroke="url(#vcbGold)" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M23.5 9.5 L26 6" stroke="url(#vcbGold)" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;

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
        <div class="vcb-ava">🙏</div>
        <div><div class="vcb-title">${TITLE}</div><div class="vcb-sub">Ashaeiynn · answers from the teachings</div></div>
      </div>
      <button class="vcb-close" aria-label="Close">×</button>
    </div>
    <div class="vcb-bless"><span>${SPLASH}</span></div>
    <div class="vcb-msgs"></div>
    <form class="vcb-form">
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

  function addMessage(role, text, sources) {
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
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  let greeted = false;
  function toggle(open) {
    panel.classList.toggle("open", open);
    if (open) {
      hideNudge();
      playSplash();
      if (!greeted) {
        greeted = true;
        addMessage("bot", "Jai Siya Ram 🙏 Ask me anything about the teachings — I'll find the answer from our videos.");
      }
      input.focus();
    }
  }
  btn.addEventListener("click", () => toggle(!panel.classList.contains("open")));
  panel.querySelector(".vcb-close").addEventListener("click", () => toggle(false));

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
      const resp = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await resp.json();
      typing.remove();
      if (!resp.ok) {
        addMessage("bot", data.error || "Sorry, something went wrong. Please try again.");
      } else {
        addMessage("bot", data.answer, data.sources);
        history.push({ role: "user", content: text }, { role: "assistant", content: data.answer });
        if (history.length > 12) history.splice(0, history.length - 12);
      }
    } catch {
      typing.remove();
      addMessage("bot", "Sorry, I couldn't reach the server. Please try again.");
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
})();
