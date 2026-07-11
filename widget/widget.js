// Embeddable chat widget. Add to any site (WordPress, app webview, anything) with:
//   <script src="https://YOUR-CHATBOT-DOMAIN/widget.js" defer></script>
// Optional attributes:
//   data-api="https://YOUR-CHATBOT-DOMAIN"  (defaults to where the script came from)
//   data-title="Ask us anything"
//   data-color="#4f46e5"
(() => {
  const script = document.currentScript;
  const API = (script?.dataset.api || new URL(script.src).origin).replace(/\/$/, "");
  const TITLE = script?.dataset.title || "Ask Your Guide";
  const COLOR = script?.dataset.color || "#4f46e5";

  const history = [];

  const style = document.createElement("style");
  style.textContent = `
    .vcb-btn{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;
      background:${COLOR};border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);
      display:flex;align-items:center;justify-content:center;z-index:999998;transition:transform .15s}
    .vcb-btn:hover{transform:scale(1.07)}
    .vcb-panel{position:fixed;bottom:88px;right:20px;width:min(370px,calc(100vw - 32px));
      height:min(540px,calc(100vh - 120px));background:#fff;border-radius:16px;z-index:999999;
      box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .vcb-panel.open{display:flex}
    .vcb-head{background:${COLOR};color:#fff;padding:14px 16px;font-weight:600;font-size:15px;
      display:flex;justify-content:space-between;align-items:center}
    .vcb-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}
    .vcb-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f7f7fb}
    .vcb-m{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;
      white-space:pre-wrap;word-wrap:break-word}
    .vcb-m.user{align-self:flex-end;background:${COLOR};color:#fff;border-bottom-right-radius:4px}
    .vcb-m.bot{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #e5e5ef;border-bottom-left-radius:4px}
    .vcb-src{font-size:12px;margin-top:6px;padding-top:6px;border-top:1px solid #eee}
    .vcb-src a{color:${COLOR};text-decoration:none}
    .vcb-src a:hover{text-decoration:underline}
    .vcb-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e5ef;background:#fff}
    .vcb-input{flex:1;border:1px solid #d5d5e0;border-radius:10px;padding:10px 12px;font-size:14px;outline:none}
    .vcb-input:focus{border-color:${COLOR}}
    .vcb-send{background:${COLOR};color:#fff;border:none;border-radius:10px;padding:0 16px;
      font-size:14px;font-weight:600;cursor:pointer}
    .vcb-send:disabled{opacity:.5;cursor:default}
    .vcb-typing{align-self:flex-start;color:#888;font-size:13px;padding:4px 8px}
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
    <div class="vcb-head"><span>${TITLE}</span><button class="vcb-close" aria-label="Close">×</button></div>
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
    if (open && !greeted) {
      greeted = true;
      addMessage("bot", "Hi! Ask me anything about our videos and I'll find the answer for you.");
    }
    if (open) input.focus();
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
    typing.textContent = "Thinking…";
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
