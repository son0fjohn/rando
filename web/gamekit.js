// Shared kit for quests + catalog games: host-authoritative state, bots,
// and the full-screen game UI primitives (panel, HUD, prompts, votes).
import { mulberry, hashStr } from "./net.js";
import { avatar3Random } from "./bots.js";

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- host game
// Subclass (or pass handlers): hostInit(s), hostTick(s, dt), hostInput(s, m),
// render(s), onEvent(m). The host mutates `s` and broadcasts snapshots; clients
// only render. If the host leaves, the next member continues from the last
// snapshot (host is always "earliest-joined present member").
export class HostGame {
  constructor(ctx, handlers, { hz = 5 } = {}) {
    this.ctx = ctx;
    this.room = ctx.room;
    this.h = handlers;
    this.s = null;
    this.hz = hz;
    this.running = false;
    this.rng = mulberry(ctx.seed ^ hashStr(ctx.room.id));
    this.lastSend = 0;
    this.lastT = performance.now();
  }
  get hosting() { return this.room.isHost; }
  start(initial) {
    this.running = true;
    this.s = initial;
    this.room.on("state", this._onState = m => { if (!this.hosting) { this.s = m.s; try { this.h.render?.(this.s); } catch (e) { this._err("render", e); } } });
    this.room.on("input", this._onInput = m => { if (this.hosting && this.s) { try { this.h.hostInput?.(this.s, m); } catch (e) { this._err("hostInput", e); } } });
    this.room.on("ev", this._onEv = m => {
      if (m.ev === "__end") { if (!this._ended) { this._ended = true; this.stop(); this.ctx.onEnd(); } return; }
      try { this.h.onEvent?.(m); } catch (e) { this._err("onEvent", e); }
    });
    if (this.hosting) this.h.hostInit?.(this.s);
    const tick = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.lastT) / 1000);
      this.lastT = now;
      if (this.hosting && this.s) {
        try { this.h.hostTick?.(this.s, dt); } catch (e) { this._err("hostTick", e); }
        if (!this.running) return;   // hostTick ended the game
        if (now - this.lastSend > 1000 / this.hz) { this.lastSend = now; this.room.send("state", { s: this.s }); }
        try { this.h.render?.(this.s); } catch (e) { this._err("render", e); }
      }
    };
    const loop = () => { if (!this.running) return; this._rafAt = performance.now(); tick(); this._raf = requestAnimationFrame(loop); };
    window.__game = this;   // debug handle
    this.lastT = performance.now();
    loop();
    // throttled / hidden tabs: keep the host simulation alive on an interval
    this._pump = setInterval(() => { if (this.running && performance.now() - (this._rafAt || 0) > 200) tick(); }, 100);
    // clients render at their own pace from the latest snapshot; host renders in loop
    this._renderTimer = setInterval(() => { if (!this.hosting && this.s) { try { this.h.render?.(this.s); } catch (e) { this._err("render", e); } } }, 120);
  }
  _err(where, e) {
    this.lastErr = { where, msg: String(e?.stack || e), t: Date.now() };
    (this.errs ??= []).length < 10 && this.errs.push(this.lastErr);
    if (!this._errLogged || Date.now() - this._errLogged > 5000) { this._errLogged = Date.now(); console.warn("[game]", where, e); }
  }
  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    clearInterval(this._renderTimer); clearInterval(this._pump);
    this.room.off("state", this._onState); this.room.off("input", this._onInput); this.room.off("ev", this._onEv);
  }
  // host-originated one-off event for everyone (incl. host)
  emit(type, payload = {}) { this.room.send("ev", { ev: type, ...payload }); }
  // host: end the game for EVERYONE (clients learn it from the broadcast)
  finish() {
    if (this._ended) return;
    this._ended = true;
    this.emit("__end");
    this.stop();
    this.ctx.onEnd();
  }
  // client -> host
  input(type, payload = {}) { this.room.send("input", { in: type, ...payload }); }
}

// ---------------------------------------------------------------- bots
const BOT_NAMES = ["mina", "jun", "soyeon", "tae", "hana", "dongwoo", "yuri", "kai", "seo", "bomi", "leo", "jiwoo", "nari", "hyun", "ari", "mo"];
export function makeBots(n, rng, existingIds = new Set()) {
  const out = [];
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  for (let i = 0; i < n; i++) {
    const id = `bot-${names[i % names.length]}-${i}`;
    if (existingIds.has(id)) continue;
    out.push({
      id, handle: names[i % names.length], isBot: true,
      avatar: avatar3Random(rng),
      skill: 0.25 + rng() * 0.6, aggro: rng(), social: 0.3 + rng() * 0.7, reaction: 260 + rng() * 220,
    });
  }
  return out;
}
export function gauss(rng, mu, sd) {
  const u = 1 - rng(), v = rng();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------- UI primitives
// One full-screen layer (#game-layer) with: a HUD strip (top), a main panel
// (centre), and a toast feed. Games swap the panel's content.
export const ui = {
  show() { $("game-layer").hidden = false; },
  hide() { $("game-layer").hidden = true; this.panel(""); this.hud(""); $("game-feed").innerHTML = ""; $("game-layer").className = ""; this._key = null; },
  theme(arch) { $("game-layer").className = arch ? `arch-${arch}` : ""; },
  hud(html) { $("game-hud").innerHTML = html; },
  panel(html, cls = "") { const p = $("game-panel"); p.innerHTML = html; p.className = cls; p.hidden = !html; },
  toast(text, cls = "") {
    const f = $("game-feed");
    const d = document.createElement("div"); d.className = `gt ${cls}`; d.textContent = text;
    f.appendChild(d); while (f.children.length > 5) f.firstChild.remove();
    setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 300); }, 3200);
  },
  // big centred stage card with a title, body html and optional countdown
  stage(title, body, sub = "") {
    this.panel(`<div class="stage"><div class="st-sub">${sub}</div><h2>${title}</h2><div class="st-body">${body}</div></div>`, "stage-wrap");
  },
  // keyed render: only rebuild the panel when `key` changes (so inputs,
  // radios and focus survive the 150 ms render loop). Returns true if rebuilt.
  _key: null,
  once(key, fn) { if (this._key === key) return false; this._key = key; fn(); return true; },
  resetKey() { this._key = null; },
  // small live chat inside the panel (talk games): feed + input
  chatHtml(lines, placeholder = "say something…") {
    return `<div class="gchat"><div class="gchat-feed">${lines.map(l => `<div><b>${l.who}</b> ${l.text}</div>`).join("")}</div>
      <form class="gchat-form"><input id="gchat-in" maxlength="120" placeholder="${placeholder}" autocomplete="off"><button type="submit">↑</button></form></div>`;
  },
  bindChat(onSay) {
    const f = $("game-panel").querySelector(".gchat-form"); if (!f) return;
    f.onsubmit = e => { e.preventDefault(); const v = $("gchat-in").value.trim(); if (v) { onSay(v); $("gchat-in").value = ""; } };
    const feed = $("game-panel").querySelector(".gchat-feed"); if (feed) feed.scrollTop = feed.scrollHeight;
  },
  updateChat(lines) {
    const feed = $("game-panel").querySelector(".gchat-feed"); if (!feed) return;
    feed.innerHTML = lines.map(l => `<div><b>${l.who}</b> ${l.text}</div>`).join(""); feed.scrollTop = feed.scrollHeight;
  },
  // choice buttons; onPick(value)
  choices(items, onPick, { picked = null, disabled = false } = {}) {
    return `<div class="choices">` + items.map(it => {
      const v = typeof it === "string" ? it : it.value, label = typeof it === "string" ? it : it.label;
      return `<button class="ch ${picked === v ? "on" : ""}" data-v="${String(v).replace(/"/g, "&quot;")}" ${disabled ? "disabled" : ""}>${label}</button>`;
    }).join("") + `</div>`;
  },
  bindChoices(onPick) {
    $("game-panel").querySelectorAll("button.ch").forEach(b => b.onclick = () => onPick(b.dataset.v));
  },
  // text prompt; onSubmit(text)
  prompt(placeholder, onSubmit, { maxlength = 80, submitLabel = "send" } = {}) {
    const html = `<form class="gp-form"><input id="gp-in" maxlength="${maxlength}" placeholder="${placeholder}" autocomplete="off"><button type="submit">${submitLabel}</button></form>`;
    setTimeout(() => {
      const f = $("game-panel").querySelector(".gp-form");
      if (!f) return;
      f.onsubmit = e => { e.preventDefault(); const v = $("gp-in").value.trim(); if (v) { onSubmit(v); $("gp-in").value = ""; $("gp-in").disabled = true; f.querySelector("button").disabled = true; } };
      $("gp-in").focus();
    }, 30);
    return html;
  },
  bar(frac, cls = "") { return `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, frac * 100))}%"></i></div>`; },
  clock(ms) { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; },
  names(ids, players) { return ids.map(i => players[i]?.handle ?? i).join(", "); },
};

// share text → clipboard with a toast
export async function shareText(text) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text); ui.toast("copied to clipboard");
  } catch { ui.toast("couldn't share"); }
}
