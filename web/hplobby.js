// The party lobby as a walkable 2D room.
//
// Everyone in the party stands on the vibe's generated backdrop as their
// placeholder avatar. Tap anywhere on the floor and you walk there; everyone
// else sees you walk. Chat lines pop up as speech bubbles over the speaker.
//
// Network cost is one tiny message per TAP, not a position stream: a tap
// broadcasts the destination ("lpos" {x, y}, normalised 0..1), and every
// phone animates the walk itself with a CSS transition at a fixed speed. A
// new tap mid-walk retargets from wherever the avatar currently is (that's
// how CSS transitions behave), so nobody needs a physics loop. When someone
// joins, everyone re-sends where they're standing so the newcomer sees the
// room as it is.
//
// Positions are room-relative, in memory only, and die with the party.
import { avatarHtml, esc, avatarHue } from "./hpkit.js";

const SPEED = 0.28;                  // floor-widths per second
const BOUNDS = { x0: 0.07, x1: 0.93, y0: 0.30, y1: 0.94 };   // walkable band (keeps feet off the wall)
const BUBBLE_MS = 4500;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// a stable starting spot per player, so everyone agrees before anyone moves
function homeSpot(id) {
  const h = avatarHue(id) * 7919 + String(id).length * 104729;
  return {
    x: BOUNDS.x0 + ((h % 997) / 997) * (BOUNDS.x1 - BOUNDS.x0),
    y: BOUNDS.y0 + 0.2 + (((h >> 3) % 991) / 991) * (BOUNDS.y1 - BOUNDS.y0 - 0.2),
  };
}

export class LobbyRoom {
  // el: container to fill; room: net.js Room; me: { id, handle }
  // bots: local-only wanderers (the host's ?bots=N seats) — only this device sees them
  constructor(el, room, me, { bots = [] } = {}) {
    this.el = el; this.room = room; this.me = me;
    this.bots = bots;
    this.pos = new Map();            // id -> { x, y } (current destination)
    this.els = new Map();            // id -> element
    this._timers = new Set();
    this._lastAnnounce = 0;
    this.mount();
  }

  mount() {
    this.el.classList.add("lr-floor");
    this.el.innerHTML = `<div class="lr-hint">tap anywhere to walk</div><div class="lr-people"></div>`;
    this.people = this.el.querySelector(".lr-people");
    this._onTap = e => this.tap(e);
    this.el.addEventListener("pointerdown", this._onTap);
    this._onPos = m => { if (m.from !== this.me.id) this.moveTo(m.from, m.x, m.y); };
    this.room.on("lpos", this._onPos);
    // bots wander on their own, on this device only
    for (const b of this.bots) {
      this.pos.set(b.id, homeSpot(b.id));
      const t = setInterval(() => {
        if (Math.random() < 0.55) this.moveTo(b.id, BOUNDS.x0 + Math.random() * (BOUNDS.x1 - BOUNDS.x0), BOUNDS.y0 + Math.random() * (BOUNDS.y1 - BOUNDS.y0));
      }, 2600 + Math.random() * 2400);
      this._timers.add(t);
    }
    this.sync();
  }

  destroy() {
    this.el.removeEventListener("pointerdown", this._onTap);
    this.room.off("lpos", this._onPos);
    for (const t of this._timers) { clearInterval(t); clearTimeout(t); }
    this._timers.clear();
    this.el.classList.remove("lr-floor");
    this.el.innerHTML = "";
    this.pos.clear(); this.els.clear();
  }

  setBackground(url) {
    if (this.el.dataset.bg === url) return;
    this.el.dataset.bg = url;
    this.el.style.backgroundImage = `url(${url})`;
  }

  // reconcile avatars with the room's presence (+ local bots)
  sync() {
    const people = [
      ...this.room.members.map(m => ({ id: m.id, handle: m.handle, host: m.id === this.room.hostId, bot: false })),
      ...this.bots.map(b => ({ id: b.id, handle: b.handle, host: false, bot: true })),
    ];
    const seen = new Set();
    for (const p of people) {
      seen.add(p.id);
      let el = this.els.get(p.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "lr-av";
        el.dataset.id = p.id;
        this.people.appendChild(el);
        this.els.set(p.id, el);
        const at = this.pos.get(p.id) ?? homeSpot(p.id);
        this.pos.set(p.id, at);
        this._place(el, at, 0);
      }
      const sig = `${p.handle}|${p.host}|${p.bot}|${p.id === this.me.id}`;
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        el.classList.toggle("me", p.id === this.me.id);
        el.innerHTML = `<span class="lr-bubble" hidden></span>
          ${avatarHtml(p, { size: 40, ring: p.host ? "gold" : "" })}
          <span class="lr-name">${esc(p.handle)}${p.host ? " ★" : ""}${p.bot ? ' <small>bot</small>' : ""}${p.id === this.me.id ? ' <small>you</small>' : ""}</span>`;
      }
    }
    for (const [id, el] of this.els) if (!seen.has(id)) { el.remove(); this.els.delete(id); this.pos.delete(id); }
    // a membership change means someone may have just arrived: tell the room
    // where I'm standing (throttled — presence syncs can come in bursts)
    if (Date.now() - this._lastAnnounce > 400) {
      this._lastAnnounce = Date.now();
      const me = this.pos.get(this.me.id);
      if (me) this.room.send("lpos", { x: +me.x.toFixed(3), y: +me.y.toFixed(3) });
    }
  }

  tap(e) {
    if (e.target.closest("button, a, input")) return;
    const r = this.el.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, BOUNDS.x0, BOUNDS.x1);
    const y = clamp((e.clientY - r.top) / r.height, BOUNDS.y0, BOUNDS.y1);
    this.moveTo(this.me.id, x, y);
    this.room.send("lpos", { x: +x.toFixed(3), y: +y.toFixed(3) });
    this.el.querySelector(".lr-hint")?.remove();
  }

  moveTo(id, x, y) {
    const el = this.els.get(id);
    x = clamp(Number(x), BOUNDS.x0, BOUNDS.x1); y = clamp(Number(y), BOUNDS.y0, BOUNDS.y1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const from = this.pos.get(id) ?? { x, y };
    this.pos.set(id, { x, y });
    if (!el) return;
    // duration from distance in floor-widths (height scaled by aspect)
    const r = this.el.getBoundingClientRect();
    const aspect = r.width ? r.height / r.width : 1;
    const d = Math.hypot(x - from.x, (y - from.y) * aspect);
    const ms = Math.round(1000 * d / SPEED);
    if (x < from.x - 0.005) el.classList.add("left"); else if (x > from.x + 0.005) el.classList.remove("left");
    this._place(el, { x, y }, ms);
    el.classList.add("walking");
    clearTimeout(el._walkT);
    el._walkT = setTimeout(() => el.classList.remove("walking"), ms);
  }

  _place(el, { x, y }, ms) {
    el.style.transitionDuration = `${ms}ms`;
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    el.style.zIndex = String(10 + Math.round(y * 100));     // nearer the camera draws on top
  }

  // a chat line as a speech bubble over the speaker
  say(id, text) {
    const el = this.els.get(id); if (!el) return;
    const b = el.querySelector(".lr-bubble"); if (!b) return;
    b.textContent = text.length > 60 ? text.slice(0, 57) + "…" : text;
    b.hidden = false;
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.hidden = true; }, BUBBLE_MS);
  }
}
