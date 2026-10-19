// The party lobby: a top-down room everyone walks around in.
//
// The vibe's backdrop (web/lobbies/) is drawn at its own aspect, centered,
// so every phone sees the same room and furniture lines up. Each player is a
// flat pixel sprite of their own 3D character (charsprite.js) with a pixel
// name tag (the host gets a crown). Tap the floor and you walk there, around
// the furniture; tap the TV to walk over and open the game picker; tap
// someone to open their profile card.
//
// Network: one small message per TAP, not a position stream. A tap
// broadcasts the path ("lpos" { x, y, path }, backdrop pixels) and every
// phone walks the sprite along it at the same speed, so movement is smooth
// everywhere. When someone joins, everyone re-sends where they're standing
// (no path = place there) so the newcomer sees the room as it is.
//
// Depth: everything in the room layer is z-sorted by where its feet touch
// the floor; tall furniture is re-drawn above anyone standing behind it
// (roomdefs.js `front` slices), so people walk behind and in front of it.
//
// Positions are room-relative, in memory only, and die with the party.
import { esc, avatarHue } from "./hpkit.js";
import { ROOMS, ROOM_W, ROOM_H } from "./roomdefs.js";
import { spriteFor, silhouetteFor, SPRITE } from "./charsprite.js";

const SPEED = 230;                     // backdrop px per second
const CELL = 16;                       // pathfinding grid, backdrop px
const FOOT = 14;                       // keep feet this far from furniture
const PERSONAL = 34;                   // light separation between standing people
const BUBBLE_MS = 4500;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ROW = { down: 0, left: 1, right: 1, up: 2 };
const hash = id => avatarHue(id) * 7919 + String(id).length * 104729;

// ---------------------------------------------------------------- pathfinding
// A coarse walkability grid per room, A* over it (8 directions, no corner
// cutting), then string-pulled to straight segments.
const grids = new Map();
function gridFor(vibe) {
  if (grids.has(vibe)) return grids.get(vibe);
  const R = ROOMS[vibe] ?? ROOMS.chill;
  const gw = Math.ceil(ROOM_W / CELL), gh = Math.ceil(ROOM_H / CELL);
  const open = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x = (gx + 0.5) * CELL, y = (gy + 0.5) * CELL;
    let ok = x >= R.walk.x0 && x <= R.walk.x1 && y >= R.walk.y0 && y <= R.walk.y1;
    if (ok) for (const [x0, y0, x1, y1] of R.block) if (x > x0 - FOOT && x < x1 + FOOT && y > y0 - FOOT / 2 && y < y1 + FOOT / 2) { ok = false; break; }
    open[gy * gw + gx] = ok ? 1 : 0;
  }
  const g = { R, gw, gh, open };
  grids.set(vibe, g);
  return g;
}
const cellOf = (g, x, y) => [clamp(Math.floor(x / CELL), 0, g.gw - 1), clamp(Math.floor(y / CELL), 0, g.gh - 1)];
const isOpen = (g, gx, gy) => gx >= 0 && gy >= 0 && gx < g.gw && gy < g.gh && g.open[gy * g.gw + gx] === 1;
export function walkable(vibe, x, y) { const g = gridFor(vibe); const [gx, gy] = cellOf(g, x, y); return isOpen(g, gx, gy); }
// the nearest open spot to (x, y)
function nearestOpen(g, x, y) {
  const [cx, cy] = cellOf(g, x, y);
  if (isOpen(g, cx, cy)) return [x, y];
  for (let r = 1; r < 40; r++) {
    let best = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !isOpen(g, cx + dx, cy + dy)) continue;
      const px = (cx + dx + 0.5) * CELL, py = (cy + dy + 0.5) * CELL, d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = [px, py]; }
    }
    if (best) return best;
  }
  return [x, y];
}
function lineOpen(g, ax, ay, bx, by) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 3));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const [gx, gy] = cellOf(g, ax + (bx - ax) * t, ay + (by - ay) * t);
    if (!isOpen(g, gx, gy)) return false;
  }
  return true;
}
export function findPath(vibe, from, to) {
  const g = gridFor(vibe);
  const [sx0, sy0] = nearestOpen(g, from[0], from[1]);
  const [tx, ty] = nearestOpen(g, to[0], to[1]);
  if (lineOpen(g, sx0, sy0, tx, ty)) return [[tx, ty]];
  const [sx, sy] = cellOf(g, sx0, sy0), [ex, ey] = cellOf(g, tx, ty);
  const N = g.gw * g.gh, gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), shut = new Uint8Array(N);
  const h = (x, y) => { const dx = Math.abs(x - ex), dy = Math.abs(y - ey); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const heap = [];                     // tiny binary heap of [f, idx]
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const s = sy * g.gw + sx, e = ey * g.gw + ex;
  gs[s] = 0; push(h(sx, sy), s);
  while (heap.length) {
    const [, i] = pop();
    if (i === e) break;
    if (shut[i]) continue;
    shut[i] = 1;
    const x = i % g.gw, y = (i / g.gw) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!isOpen(g, nx, ny)) continue;
      if (dx && dy && (!isOpen(g, x + dx, y) || !isOpen(g, x, y + dy))) continue;   // no corner cutting
      const j = ny * g.gw + nx, c = gs[i] + (dx && dy ? 1.414 : 1);
      if (c < gs[j]) { gs[j] = c; came[j] = i; push(c + h(nx, ny), j); }
    }
  }
  if (came[e] < 0 && s !== e) return [[tx, ty]];          // unreachable: go straight (never happens on these maps)
  const cells = [];
  for (let i = e; i !== s && i >= 0; i = came[i]) cells.push([(i % g.gw + 0.5) * CELL, (((i / g.gw) | 0) + 0.5) * CELL]);
  cells.reverse();
  cells[cells.length - 1] = [tx, ty];
  // string-pull: skip every waypoint that's in straight sight
  const out = [];
  let ax = sx0, ay = sy0;
  for (let k = 0; k < cells.length; k++) {
    const nxt = cells[k + 1];
    if (nxt && lineOpen(g, ax, ay, nxt[0], nxt[1])) continue;
    out.push(cells[k]); [ax, ay] = cells[k];
  }
  return out.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

// ---------------------------------------------------------------- the TV
// A little CRT drawn in code (no asset): 26x24 pixels, scaled like sprites.
let tvUrl = null;
function tvSprite() {
  if (tvUrl) return tvUrl;
  const cv = document.createElement("canvas");
  cv.width = 26; cv.height = 24;
  const g = cv.getContext("2d");
  const r = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  r("#1a1d3d", 8, 0, 1, 4); r("#1a1d3d", 17, 0, 1, 4); r("#1a1d3d", 9, 3, 8, 1);        // antenna
  r("#1a1d3d", 1, 4, 24, 17); r("#b9c3e6", 2, 5, 22, 15); r("#8a95c4", 2, 18, 22, 2);    // case
  r("#1a1d3d", 4, 7, 15, 10); r("#4de8c8", 5, 8, 13, 8); r("#bff6ff", 6, 9, 4, 2);       // screen + glare
  r("#ff5d8a", 20, 8, 2, 2); r("#ffc84d", 20, 11, 2, 2); r("#1a1d3d", 20, 14, 2, 3);     // knobs
  r("#1a1d3d", 4, 21, 4, 3); r("#1a1d3d", 18, 21, 4, 3);                                  // feet
  return (tvUrl = cv.toDataURL());
}

// ---------------------------------------------------------------- the room
export class LobbyRoom {
  // el: container to fill; room: net.js Room; me: { id, handle, avatar }
  // bots: local-only wanderers (the host's ?bots=N seats) — only this device sees them
  // onTV(): you walked to the TV · onPerson(id): you tapped someone
  constructor(el, room, me, { bots = [], vibe = "chill", onTV = null, onPerson = null } = {}) {
    this.el = el; this.room = room; this.me = me;
    this.bots = bots; this.vibe = ROOMS[vibe] ? vibe : "chill";
    this.onTV = onTV; this.onPerson = onPerson;
    this.people = new Map();           // id -> { el, x, y, path, facing, walking, sheet, lastSeen }
    this.hiddenIds = new Set();
    this._timers = new Set();
    this._lastAnnounce = 0;
    this._raf = null;
    this.mount();
  }

  get R() { return ROOMS[this.vibe]; }

  mount() {
    this.el.classList.add("lr-floor");
    this.el.innerHTML = `<div class="lr-stage"><div class="lr-layer"></div></div><div class="lr-hint">tap anywhere to walk</div>`;
    this.stage = this.el.querySelector(".lr-stage");
    this.layer = this.el.querySelector(".lr-layer");
    this._onTap = e => this.tap(e);
    this.stage.addEventListener("pointerdown", this._onTap);
    this._onPos = m => { if (m.from !== this.me.id) this.remote(m.from, m); };
    this.room.on("lpos", this._onPos);
    this._ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.layout()) : null;
    this._ro?.observe(this.el);
    this.buildScene();
    // bots wander on their own, on this device only
    for (const b of this.bots) {
      const t = setInterval(() => {
        if (Math.random() < 0.5) this.walk(b.id, [this.R.walk.x0 + Math.random() * (this.R.walk.x1 - this.R.walk.x0), this.R.walk.y0 + Math.random() * (this.R.walk.y1 - this.R.walk.y0)], false);
      }, 2600 + Math.random() * 2600);
      this._timers.add(t);
    }
    this.layout();
    this.sync();
  }

  destroy() {
    this.stage?.removeEventListener("pointerdown", this._onTap);
    this.room.off("lpos", this._onPos);
    this._ro?.disconnect();
    for (const t of this._timers) { clearInterval(t); clearTimeout(t); }
    this._timers.clear();
    cancelAnimationFrame(this._raf); this._raf = null;
    this.el.classList.remove("lr-floor");
    this.el.innerHTML = "";
    this.people.clear();
  }

  // vibe change (the host's meta arrives after you join): new backdrop, same people
  setVibe(vibe) {
    vibe = ROOMS[vibe] ? vibe : "chill";
    if (vibe === this.vibe && this.layer.querySelector(".lr-tv")) return;
    this.vibe = vibe;
    this.buildScene();
    for (const [id, p] of this.people) {
      [p.x, p.y] = nearestOpenSpot(this.vibe, p.x, p.y);
      p.path = [];
      this.place(id);
    }
  }
  // kept for party.js: the backdrop follows the vibe
  setBackground(url) {
    if (this.stage.dataset.bg === url) return;
    this.stage.dataset.bg = url;
    this.stage.style.backgroundImage = `url(${url})`;
    this.layer.querySelectorAll(".lr-front").forEach(f => { f.style.backgroundImage = `url(${url})`; });
  }

  buildScene() {
    this.layer.querySelectorAll(".lr-front, .lr-tv").forEach(n => n.remove());
    const R = this.R, url = this.stage.dataset.bg;
    for (const f of R.front) {
      const d = document.createElement("div");
      d.className = "lr-front";
      d.dataset.r = f.r.join(",");
      d.style.zIndex = String(f.base);
      if (url) d.style.backgroundImage = `url(${url})`;
      this.layer.appendChild(d);
    }
    const tv = document.createElement("button");
    tv.type = "button"; tv.className = "lr-tv"; tv.setAttribute("aria-label", "the TV: pick a game");
    tv.style.backgroundImage = `url(${tvSprite()})`;
    tv.style.zIndex = String(R.tv.y);
    tv.addEventListener("pointerdown", e => { e.stopPropagation(); this.goTV(); });
    this.layer.appendChild(tv);
    this.layout();
  }

  // fit the backdrop's aspect inside the floor; sprites at a whole-number scale
  layout() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const s = Math.min(r.width / ROOM_W, r.height / ROOM_H);
    this.s = s;
    this.stage.style.width = `${Math.round(ROOM_W * s)}px`;
    this.stage.style.height = `${Math.round(ROOM_H * s)}px`;
    const k = Math.max(1, Math.round(ROOM_H * s / 300));     // sprite pixels -> CSS px
    this.k = k;
    this.stage.style.setProperty("--px", `${k}px`);
    this.stage.style.setProperty("--sw", `${SPRITE.W * k}px`);
    this.stage.style.setProperty("--sh", `${SPRITE.H * k}px`);
    for (const f of this.layer.querySelectorAll(".lr-front")) {
      const [x0, y0, x1, y1] = f.dataset.r.split(",").map(Number);
      Object.assign(f.style, { left: `${x0 * s}px`, top: `${y0 * s}px`, width: `${(x1 - x0) * s}px`, height: `${(y1 - y0) * s}px`,
        backgroundSize: `${ROOM_W * s}px ${ROOM_H * s}px`, backgroundPosition: `${-x0 * s}px ${-y0 * s}px` });
    }
    const tv = this.layer.querySelector(".lr-tv");
    if (tv) Object.assign(tv.style, { width: `${26 * k}px`, height: `${24 * k}px`, left: `${this.R.tv.x * s - 13 * k}px`, top: `${this.R.tv.y * s - 24 * k}px` });
    for (const id of this.people.keys()) this.place(id);
  }

  // ---- people
  doorSpot(id) {
    const [dx, dy] = this.R.door, h = hash(id);
    return nearestOpenSpot(this.vibe, dx + ((h % 7) - 3) * 14, dy + (((h >> 3) % 5) - 2) * 10);
  }

  // reconcile sprites with the room's presence (+ local bots)
  sync() {
    const list = [
      ...this.room.members.map(m => ({ id: m.id, handle: m.handle, avatar: m.avatar, host: m.id === this.room.hostId, bot: false })),
      ...this.bots.map(b => ({ id: b.id, handle: b.handle, avatar: b.avatar, host: false, bot: true })),
    ];
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let p = this.people.get(m.id);
      if (!p) {
        const el = document.createElement("div");
        el.className = "lr-av pop";
        el.dataset.id = m.id;
        el.innerHTML = `<span class="lr-bubble" hidden></span><div class="lr-spr"></div><span class="lr-tag"></span>`;
        el.querySelector(".lr-spr").addEventListener("pointerdown", e => {
          if (m.id === this.me.id) return;           // tapping yourself just walks
          e.stopPropagation();
          this.onPerson?.(m.id);
        });
        this.layer.appendChild(el);
        const [x, y] = this.doorSpot(m.id);
        p = { el, x, y, path: [], facing: "down", walking: false, sheetKey: null };
        this.people.set(m.id, p);
        const t = setTimeout(() => el.classList.remove("pop"), 700); this._timers.add(t);
        this.place(m.id);
      }
      p.handle = m.handle;
      const sig = `${m.handle}|${m.host}|${m.bot}|${m.id === this.me.id}`;
      if (p.el.dataset.sig !== sig) {
        p.el.dataset.sig = sig;
        p.el.classList.toggle("me", m.id === this.me.id);
        p.el.querySelector(".lr-tag").innerHTML = `${m.host ? '<i class="lr-crown" aria-label="host"></i>' : ""}${esc(m.handle)}${m.bot ? "<small>bot</small>" : ""}${m.id === this.me.id ? "<small>you</small>" : ""}`;
      }
      this.setLook(m.id, m.avatar);
      p.el.classList.toggle("hidden", this.hiddenIds.has(m.id));
    }
    for (const [id, p] of this.people) if (!seen.has(id)) this.poof(id, p);
    // a membership change means someone may have just arrived: tell the room
    // where I'm standing (throttled — presence syncs can come in bursts)
    if (Date.now() - this._lastAnnounce > 400) {
      this._lastAnnounce = Date.now();
      const me = this.people.get(this.me.id);
      if (me) { const at = me.path.at(-1) ?? [me.x, me.y]; this.room.send("lpos", { x: Math.round(at[0]), y: Math.round(at[1]) }); }
    }
  }

  // the player's own sprite sheet: the pixel figure right away, then their
  // real character once it's rendered (cached per look)
  setLook(id, avatar) {
    const p = this.people.get(id); if (!p) return;
    const key = JSON.stringify(avatar ?? {});
    if (p.sheetKey === key) return;
    p.sheetKey = key;
    const apply = sh => {
      if (p.sheetKey !== key) return;
      const spr = p.el.querySelector(".lr-spr");
      spr.style.backgroundImage = `url(${sh.url})`;
      p.el.classList.toggle("nowalk", !sh.anim);
      p.sheet = sh;
    };
    apply(silhouetteFor(avatar));
    spriteFor(avatar).then(apply);
  }

  poof(id, p) {
    this.people.delete(id);
    p.el.classList.add("poof");
    const t = setTimeout(() => p.el.remove(), 420); this._timers.add(t);
  }

  hide(ids) {
    this.hiddenIds = new Set(ids);
    for (const [id, p] of this.people) p.el.classList.toggle("hidden", this.hiddenIds.has(id));
  }

  // ---- input
  tap(e) {
    if (e.target.closest("button:not(.lr-tv), a, input")) return;
    const r = this.stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / this.s, y = (e.clientY - r.top) / this.s;
    this.el.querySelector(".lr-hint")?.remove();
    this.mark(x, y);
    this.walk(this.me.id, [x, y], true);
  }
  mark(x, y) {
    const m = document.createElement("i");
    m.className = "lr-tapmark";
    m.style.left = `${x * this.s}px`; m.style.top = `${y * this.s}px`; m.style.zIndex = "4000";
    this.layer.appendChild(m);
    const t = setTimeout(() => m.remove(), 450); this._timers.add(t);
  }
  goTV() {
    this.el.querySelector(".lr-hint")?.remove();
    const at = this.R.tv.at;
    const me = this.people.get(this.me.id);
    if (me && Math.hypot(me.x - at[0], me.y - at[1]) < 20) { this.face(this.me.id, "up"); this.onTV?.(); return; }
    this._tvPending = true;
    this.walk(this.me.id, at, true, true);
  }

  // walk someone to a spot: path around the furniture, a little personal
  // space at the end; mine is broadcast so everyone walks the same path
  walk(id, to, broadcast, exact = false) {
    const p = this.people.get(id); if (!p) return;
    if (id === this.me.id && !exact) this._tvPending = false;
    let dest = nearestOpenSpot(this.vibe, to[0], to[1]);
    if (!exact) dest = this.roomy(id, dest);
    const path = findPath(this.vibe, [p.x, p.y], dest);
    p.path = path;
    this.run();
    if (broadcast) this.room.send("lpos", { x: Math.round(dest[0]), y: Math.round(dest[1]), path });
  }
  // nudge a destination off anyone already standing there
  roomy(id, [x, y]) {
    for (let tries = 0; tries < 8; tries++) {
      const near = [...this.people].find(([oid, o]) => oid !== id && Math.hypot((o.path.at(-1)?.[0] ?? o.x) - x, (o.path.at(-1)?.[1] ?? o.y) - y) < PERSONAL);
      if (!near) break;
      const o = near[1], ox = o.path.at(-1)?.[0] ?? o.x, oy = o.path.at(-1)?.[1] ?? o.y;
      let dx = x - ox, dy = y - oy;
      if (!dx && !dy) { dx = (hash(id) % 2) ? 1 : -1; dy = 0.3; }
      const d = Math.hypot(dx, dy);
      [x, y] = nearestOpenSpot(this.vibe, ox + dx / d * PERSONAL, oy + dy / d * PERSONAL * 0.7);
    }
    return [x, y];
  }
  remote(id, m) {
    const p = this.people.get(id); if (!p) return;
    const x = Number(m.x), y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const path = Array.isArray(m.path) ? m.path.filter(q => Array.isArray(q) && Number.isFinite(+q[0]) && Number.isFinite(+q[1])).slice(0, 64).map(q => [clamp(+q[0], 0, ROOM_W), clamp(+q[1], 0, ROOM_H)]) : null;
    if (path?.length) { p.path = path; this.run(); return; }
    // no path: they're standing there (sent when someone joins)
    if (Math.hypot(p.x - x, p.y - y) > 2) { p.x = clamp(x, 0, ROOM_W); p.y = clamp(y, 0, ROOM_H); p.path = []; this.place(id); }
  }
  face(id, f) { const p = this.people.get(id); if (p) { p.facing = f; this.place(id); } }

  // ---- the walk loop: runs only while someone is moving
  run() {
    if (this._raf) return;
    let last = performance.now();
    const step = now => {
      // a tab that wasn't drawing (app in the background, phone locked)
      // catches up in one step instead of 0.1 s a frame
      const dt = Math.min(10, (now - last) / 1000); last = now;
      let moving = false;
      for (const [id, p] of this.people) {
        if (!p.path.length) { if (p.walking) { p.walking = false; p.el.classList.remove("walking"); } continue; }
        moving = true;
        let left = SPEED * dt;
        while (left > 0 && p.path.length) {
          const [tx, ty] = p.path[0], dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
          if (d > 0.5) p.facing = Math.abs(dx) > Math.abs(dy) * 0.8 ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
          if (d <= left) { p.x = tx; p.y = ty; p.path.shift(); left -= d; }
          else { p.x += dx / d * left; p.y += dy / d * left; left = 0; }
        }
        if (!p.walking) { p.walking = true; p.el.classList.add("walking"); }
        this.place(id);
        if (!p.path.length && id === this.me.id && this._tvPending) { this._tvPending = false; p.facing = "up"; this.place(id); this.onTV?.(); }
      }
      this._raf = moving ? requestAnimationFrame(step) : null;
      if (!moving) for (const p of this.people.values()) if (p.walking) { p.walking = false; p.el.classList.remove("walking"); }
    };
    this._raf = requestAnimationFrame(step);
  }

  place(id) {
    const p = this.people.get(id); if (!p || !this.s) return;
    const w = SPRITE.W * this.k, h = SPRITE.H * this.k;
    p.el.style.transform = `translate3d(${Math.round(p.x * this.s - w / 2)}px, ${Math.round(p.y * this.s - h + 2 * this.k)}px, 0)`;
    p.el.style.zIndex = String(Math.round(p.y));
    p.el.style.setProperty("--row", ROW[p.facing] ?? 0);
    p.el.classList.toggle("flip", p.facing === "right");
  }

  // a chat line as a speech bubble over the speaker
  say(id, text) {
    const p = this.people.get(id); if (!p) return;
    const b = p.el.querySelector(".lr-bubble"); if (!b) return;
    b.textContent = text.length > 60 ? text.slice(0, 57) + "…" : text;
    b.hidden = false;
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.hidden = true; }, BUBBLE_MS);
  }
  wave(id) {
    const p = this.people.get(id); if (!p) return;
    p.el.classList.remove("wave"); void p.el.offsetWidth; p.el.classList.add("wave");
    this.say(id, "👋");
  }
  // for tests and the card: where someone stands, in backdrop pixels
  where(id) { const p = this.people.get(id); return p ? { x: p.x, y: p.y, facing: p.facing, walking: p.walking } : null; }
}

function nearestOpenSpot(vibe, x, y) { return nearestOpen(gridFor(vibe), x, y); }
