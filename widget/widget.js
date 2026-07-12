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
  const GOLD = "#f7c948";

  const history = [];

  const style = document.createElement("style");
  style.textContent = `
    .vcb-btn{position:fixed;bottom:20px;right:20px;width:58px;height:58px;border-radius:50%;
      background:linear-gradient(135deg,${COLOR},#7c3aed);border:none;cursor:pointer;
      box-shadow:0 6px 18px rgba(79,70,229,.45);display:flex;align-items:center;justify-content:center;
      z-index:999998;transition:transform .2s ease}
    .vcb-btn:hover{transform:scale(1.08)}
    .vcb-btn::after{content:"";position:absolute;inset:-4px;border-radius:50%;
      border:2px solid ${COLOR};opacity:0;animation:vcbPing 3.2s ease-out infinite}
    @keyframes vcbPing{0%{transform:scale(.9);opacity:.55}70%{transform:scale(1.35);opacity:0}100%{opacity:0}}

    .vcb-panel{position:fixed;bottom:92px;right:20px;width:min(380px,calc(100vw - 32px));
      height:min(560px,calc(100vh - 124px));background:#fff;border-radius:20px;z-index:999999;
      box-shadow:0 18px 60px rgba(30,27,75,.35);display:none;flex-direction:column;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      transform-origin:bottom right}
    .vcb-panel.open{display:flex;animation:vcbPanelIn .38s cubic-bezier(.18,.89,.32,1.15)}
    @keyframes vcbPanelIn{from{opacity:0;transform:scale(.86) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}

    .vcb-head{background:linear-gradient(135deg,${COLOR} 0%,#7c3aed 100%);color:#fff;
      padding:14px 18px;display:flex;justify-content:space-between;align-items:center}
    .vcb-head-left{display:flex;align-items:center;gap:11px}
    .vcb-ava{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.18);
      display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
    .vcb-title{font-weight:700;font-size:15px;line-height:1.2}
    .vcb-sub{font-size:11.5px;opacity:.85;font-weight:400;margin-top:1px}
    .vcb-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.9}
    .vcb-close:hover{opacity:1}

    .vcb-msgs{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px;
      background:linear-gradient(180deg,#f6f5ff 0%,#faf9fd 100%)}
    .vcb-m{max-width:86%;padding:11px 14px;border-radius:16px;font-size:14px;line-height:1.5;
      white-space:pre-wrap;word-wrap:break-word;animation:vcbMsgIn .28s ease both}
    @keyframes vcbMsgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .vcb-m.user{align-self:flex-end;background:linear-gradient(135deg,${COLOR},#6d28d9);color:#fff;
      border-bottom-right-radius:5px;box-shadow:0 2px 8px rgba(79,70,229,.25)}
    .vcb-m.bot{align-self:flex-start;background:#fff;color:#232336;border:1px solid #e9e8f5;
      border-bottom-left-radius:5px;box-shadow:0 1px 4px rgba(30,27,75,.06)}
    .vcb-src{font-size:12px;margin-top:8px;padding-top:8px;border-top:1px dashed #e2e0f0;color:#777}
    .vcb-src a{color:${COLOR};text-decoration:none;font-weight:500}
    .vcb-src a:hover{text-decoration:underline}

    .vcb-form{display:flex;gap:8px;padding:12px;border-top:1px solid #eceaf6;background:#fff}
    .vcb-input{flex:1;border:1.5px solid #dedbee;border-radius:12px;padding:10px 13px;font-size:14px;
      outline:none;transition:border-color .15s}
    .vcb-input:focus{border-color:${COLOR}}
    .vcb-send{background:linear-gradient(135deg,${COLOR},#6d28d9);color:#fff;border:none;border-radius:12px;
      padding:0 17px;font-size:14px;font-weight:600;cursor:pointer;transition:filter .15s}
    .vcb-send:hover{filter:brightness(1.1)}
    .vcb-send:disabled{opacity:.5;cursor:default}

    .vcb-typing{align-self:flex-start;display:flex;gap:5px;padding:12px 16px;background:#fff;
      border:1px solid #e9e8f5;border-radius:16px;border-bottom-left-radius:5px}
    .vcb-typing i{width:7px;height:7px;border-radius:50%;background:${COLOR};opacity:.5;
      animation:vcbBounce 1.2s ease-in-out infinite}
    .vcb-typing i:nth-child(2){animation-delay:.15s}
    .vcb-typing i:nth-child(3){animation-delay:.3s}
    @keyframes vcbBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px);opacity:1}}

    /* ——— the blessing splash ——— */
    .vcb-splash{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:14px;pointer-events:none;opacity:1;
      background:radial-gradient(120% 90% at 50% 42%,#2a2560 0%,#1c1745 46%,#120e30 100%);
      transition:opacity .55s ease}
    .vcb-splash.fade{opacity:0}
    .vcb-splash-halo{position:absolute;width:270px;height:270px;border-radius:50%;
      background:radial-gradient(circle,rgba(247,201,72,.32) 0%,rgba(247,201,72,.08) 45%,transparent 70%);
      animation:vcbHalo 1.9s ease-out both}
    @keyframes vcbHalo{from{transform:scale(.35);opacity:0}45%{opacity:1}to{transform:scale(1.15);opacity:.85}}
    .vcb-splash-hi{display:flex;gap:.35em;font-size:37px;font-weight:800;z-index:1;
      font-family:Georgia,'Noto Serif Devanagari',serif}
    .vcb-splash-hi span{display:inline-block;opacity:0;
      background:linear-gradient(180deg,#ffe9a8 0%,${GOLD} 55%,#d99a1e 100%);
      -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
      text-shadow:0 0 26px rgba(247,201,72,.45);
      animation:vcbRise .7s cubic-bezier(.22,1,.36,1) both}
    @keyframes vcbRise{from{opacity:0;transform:translateY(22px) scale(.92)}to{opacity:1;transform:translateY(0) scale(1)}}
    .vcb-splash-en{z-index:1;color:rgba(255,236,182,.85);font-size:12.5px;letter-spacing:.42em;
      font-weight:600;opacity:0;animation:vcbRise .7s .55s ease both;padding-left:.42em}
    .vcb-splash-line{z-index:1;width:64px;height:1px;opacity:0;
      background:linear-gradient(90deg,transparent,${GOLD},transparent);
      animation:vcbRise .7s .7s ease both}

    @media (prefers-reduced-motion: reduce){
      .vcb-panel.open,.vcb-m,.vcb-splash-hi span,.vcb-splash-en,.vcb-splash-halo,.vcb-splash-line{animation:none !important;opacity:1}
      .vcb-btn::after{animation:none}
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "vcb-btn";
  btn.setAttribute("aria-label", "Open chat");
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  const panel = document.createElement("div");
  panel.className = "vcb-panel";
  panel.innerHTML = `
    <div class="vcb-head">
      <div class="vcb-head-left">
        <div class="vcb-ava">🙏</div>
        <div><div class="vcb-title">${TITLE}</div><div class="vcb-sub">Ashaeiynn · answers from the teachings</div></div>
      </div>
      <button class="vcb-close" aria-label="Close">×</button>
    </div>
    <div class="vcb-msgs"></div>
    <form class="vcb-form">
      <input class="vcb-input" type="text" placeholder="Type your question…" maxlength="2000" autocomplete="off"/>
      <button class="vcb-send" type="submit">Send</button>
    </form>`;

  document.body.append(btn, panel);

  const msgs = panel.querySelector(".vcb-msgs");
  const form = panel.querySelector(".vcb-form");
  const input = panel.querySelector(".vcb-input");
  const send = panel.querySelector(".vcb-send");

  // ——— blessing splash on open ———
  let splashTimer = null;
  function playSplash() {
    panel.querySelector(".vcb-splash")?.remove();
    clearTimeout(splashTimer);
    const s = document.createElement("div");
    s.className = "vcb-splash";
    const words = SPLASH.split(/\s+/)
      .map((w, i) => `<span style="animation-delay:${0.12 + i * 0.22}s">${w}</span>`)
      .join("");
    s.innerHTML = `
      <div class="vcb-splash-halo"></div>
      <div class="vcb-splash-hi">${words}</div>
      <div class="vcb-splash-line"></div>
      <div class="vcb-splash-en">${SPLASH_SUB}</div>`;
    panel.appendChild(s);
    splashTimer = setTimeout(() => {
      s.classList.add("fade");
      setTimeout(() => s.remove(), 600);
    }, 2000);
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
