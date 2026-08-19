// Arena: world-space play engine for the chase-type quests and catalog games.
//
// Your OWN position comes from the joystick (sim mode, default — so the
// whole thing is playable from a desk) or from GPS (?gps=1) mapped into the
// same world coordinates the map uses. Everyone else is an ENTITY: other
// humans (their own broadcast positions) and bots (from host snapshots).
//
// Privacy is the mechanic: other players are only rendered as avatars inside
// `visRange`; beyond that the radar shows DISTANCE BANDS ONLY (no bearing),
// unless a role grants full radar (ghost spies, hunters' trail pings).
import * as THREE from "https://esm.sh/three@0.160.0";
import { world3d, geoPos, terrainY, CHAR_H } from "./world3d.js";
import { sfx, buzz } from "./fx.js";

const $ = id => document.getElementById(id);
const GPS_MODE = new URLSearchParams(location.search).get("gps") === "1";
const SPEED = 19;              // world units / s (a brisk jog; 1 u ≈ 1.8 m)
const U_PER_M = 0.55;          // world units per metre (GEO_SCALE)
export const m2u = m => m * U_PER_M;

export const arena = {
  active: false,
  room: null,
  me: null,
  center: null,        // THREE.Vector3
  radius: 0,
  visRange: m2u(28),   // see avatars inside ~28 m
  entities: new Map(), // id -> ent
  fullRadar: false,    // role-granted: blips at true bearing
  stick: { dx: 0, dy: 0, on: false },
  gpsWatch: null,
  ring: null,
  lastPosSend: 0,
  hooks: [],           // per-frame fns(t, dt) from the current quest/game
  // --- cam memory
  _cam: null,

  enter({ room, me, center, radius, visRange }) {
    this.leave();
    this.active = true;
    this.room = room; this.me = me;
    this.center = center.clone();
    this.radius = radius;
    if (visRange) this.visRange = visRange;
    this.fullRadar = false;
    $("arena-hud").hidden = false;
    this._bindStick();
    this._mountRing();
    // camera: pull in so the play area reads
    this._cam = { ...world3d.cam };
    world3d.camGoal = { theta: world3d.cam.theta, elev: 0.62, dist: 120 };
    world3d.observing = false;
    // spawn me near the centre if I'm far (the demo starts you at your zone;
    // a real run starts you at the venue anyway)
    const p = world3d.player?.api.group.position;
    if (p && p.distanceTo(this.center) > this.radius) {
      const a = Math.random() * Math.PI * 2;
      p.set(this.center.x + Math.cos(a) * 8, this.center.y, this.center.z + Math.sin(a) * 8);
      world3d.player.baseY = terrainY(p.x, p.z);
    }
    if (GPS_MODE) this._startGps();
    room?.on("pos", this._onPos = m => {
      if (m.from === this.me.id) return;
      const e = this.entities.get(m.from);
      if (e) { e.tx = m.x; e.tz = m.z; e.seen = Date.now(); }
    });
    world3d.tickHooks.push(this._tick = (t, dt) => this.tick(t, dt));
  },

  leave() {
    if (!this.active) return;
    this.active = false;
    $("arena-hud").hidden = true;
    if (this._tick) world3d.tickHooks = world3d.tickHooks.filter(f => f !== this._tick);
    if (this.room && this._onPos) this.room.off("pos", this._onPos);
    for (const e of this.entities.values()) this._dropChar(e);
    this.entities.clear();
    if (this.ring) { world3d.scene.remove(this.ring); this.ring = null; }
    for (const m of this._marks || []) world3d.scene.remove(m);
    this._marks = [];
    if (this.gpsWatch !== null) { navigator.geolocation.clearWatch(this.gpsWatch); this.gpsWatch = null; }
    if (world3d.player) { world3d.player.walkVel = null; world3d.player.api.walking = false; }
    if (this._cam) { world3d.camGoal = { ...this._cam }; this._cam = null; }
    this.hooks = [];
    this.fullRadar = false;
    const r = $("arena-radar"); if (r) r.innerHTML = "";
  },

  // ---------------------------------------------------------------- me
  myPos() { return world3d.player?.api.group.position ?? this.center; },
  distTo(ent) { const p = this.myPos(); return Math.hypot(ent.x - p.x, ent.z - p.z); },
  near(maxDist) { return [...this.entities.values()].filter(e => e.alive !== false && this.distTo(e) <= maxDist); },
  outsideCircle() { const p = this.myPos(); return Math.hypot(p.x - this.center.x, p.z - this.center.z) > this.radius; },

  // ---------------------------------------------------------------- entities
  // snapshot entities: [{id, handle, avatar, isBot, x, z, alive, role, ...}]
  setEntities(list) {
    const seen = new Set();
    for (const s of list) {
      if (s.id === this.me.id) continue;
      seen.add(s.id);
      let e = this.entities.get(s.id);
      if (!e) {
        e = { id: s.id, handle: s.handle, avatar: s.avatar, isBot: !!s.isBot, x: s.x, z: s.z, tx: s.x, tz: s.z, char: null, alive: true };
        this.entities.set(s.id, e);
      }
      // humans own their position (pos broadcasts); bots come from the host
      if (s.isBot || e.seen === undefined || Date.now() - (e.seen || 0) > 4000) { e.tx = s.x; e.tz = s.z; }
      e.alive = s.alive !== false;
      e.role = s.role; e.tag = s.tag; e.state = s;
    }
    for (const [id, e] of this.entities) if (!seen.has(id)) { this._dropChar(e); this.entities.delete(id); }
  },
  _ensureChar(e) {
    if (e.char) return e.char;
    const pos = new THREE.Vector3(e.x, terrainY(e.x, e.z), e.z);
    e.char = world3d.makeChar(e.avatar, pos, world3d.scene, undefined, e.handle);
    e.char.walkVel = { x: 0, z: 0 };
    return e.char;
  },
  _dropChar(e) {
    if (e.char) { world3d.removeChar(e.char, world3d.scene); e.char = null; }
  },

  // ---------------------------------------------------------------- ring/marks
  _mountRing() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 96),
      new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.center.x, this.center.y + 0.35, this.center.z);
    ring.scale.setScalar(this.radius);
    world3d.scene.add(ring);
    this.ring = ring;
    this._marks = [];
  },
  setRadius(r) { this.radius = r; if (this.ring) this.ring.scale.setScalar(r); },
  // a glowing ground mark (mission spot / pen) — returns a handle to remove
  mark(pos, color = 0x4da6ff, r = 6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.8, r, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, terrainY(pos.x, pos.z) + 0.4, pos.z);
    world3d.scene.add(m); this._marks.push(m); return m;
  },
  unmark(m) { world3d.scene.remove(m); this._marks = this._marks.filter(x => x !== m); },

  // ---------------------------------------------------------------- input
  _bindStick() {
    if (this._stickBound) return;
    this._stickBound = true;
    const pad = $("arena-stick"), nub = pad.querySelector(".nub");
    const setNub = (dx, dy) => { nub.style.transform = `translate(calc(-50% + ${dx * 32}px), calc(-50% + ${dy * 32}px))`; };
    const from = e => {
      const r = pad.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      return { dx, dy };
    };
    pad.addEventListener("pointerdown", e => { try { pad.setPointerCapture(e.pointerId); } catch {} this.stick.on = true; Object.assign(this.stick, from(e)); setNub(this.stick.dx, this.stick.dy); });
    pad.addEventListener("pointermove", e => { if (!this.stick.on) return; Object.assign(this.stick, from(e)); setNub(this.stick.dx, this.stick.dy); });
    const end = () => { this.stick.on = false; this.stick.dx = this.stick.dy = 0; setNub(0, 0); };
    pad.addEventListener("pointerup", end); pad.addEventListener("pointercancel", end);
    this.keys = new Set();
    window.addEventListener("keydown", e => { if (this.active && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName ?? "")) this.keys.add(e.key.toLowerCase()); });
    window.addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
  },
  _startGps() {
    if (!navigator.geolocation) return;
    this.gpsWatch = navigator.geolocation.watchPosition(p => {
      const wp = geoPos(p.coords.latitude, p.coords.longitude);
      if (world3d.player) world3d.player.walkTarget = wp;
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
    $("arena-mode").textContent = "GPS";
  },

  // ---------------------------------------------------------------- frame
  tick(t, dt) {
    const me = world3d.player;
    if (!me) return;
    // input -> velocity (joystick first, then keys). Camera-relative: up on
    // the stick = away from the camera, like every mobile twin-stick game
    let dx = this.stick.dx, dy = this.stick.dy;
    if (!this.stick.on && this.keys) {
      dx = (this.keys.has("arrowright") || this.keys.has("d") ? 1 : 0) - (this.keys.has("arrowleft") || this.keys.has("a") ? 1 : 0);
      dy = (this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0) - (this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0);
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    }
    if (!GPS_MODE) {
      if (Math.hypot(dx, dy) > 0.08) {
        const th = world3d.cam.theta;              // camera yaw
        const fx = Math.sin(th), fz = Math.cos(th); // camera forward (toward target) is -this
        const vx = (-dy) * (-fx) + dx * fz;
        const vz = (-dy) * (-fz) + dx * (-fx);
        const sp = SPEED * (this.speedMul ?? 1);
        me.walkVel = { x: vx * sp, z: vz * sp };
      } else {
        me.walkVel = { x: 0, z: 0 };
      }
    }
    // keep inside the map edge at least (quests decide what leaving the circle means)
    // entities: lerp toward targets, create/hide avatars by visibility
    const my = me.api.group.position;
    for (const e of this.entities.values()) {
      e.x += (e.tx - e.x) * Math.min(1, dt * 6);
      e.z += (e.tz - e.z) * Math.min(1, dt * 6);
      const d = Math.hypot(e.x - my.x, e.z - my.z);
      const show = e.alive !== false && (d <= this.visRange || this.fullRadar);
      if (show) {
        const c = this._ensureChar(e);
        const gp = c.api.group.position;
        const mvx = (e.x - gp.x), mvz = (e.z - gp.z);
        const sp = Math.hypot(mvx, mvz) / Math.max(dt, 0.016);
        c.api.walking = sp > 2.5;
        if (c.api.walking) c.api.group.rotation.y = Math.atan2(mvx, mvz);
        gp.x = e.x; gp.z = e.z; c.baseY = terrainY(e.x, e.z);
        c.api.group.visible = true; c.shadow.visible = true;
        if (c.label) c.label.hidden = false;
      } else if (e.char) {
        e.char.api.group.visible = false; e.char.shadow.visible = false;
        if (e.char.label) e.char.label.hidden = true;
      }
    }
    // broadcast my position 5x/s
    if (this.room && t - this.lastPosSend > 0.2) {
      this.lastPosSend = t;
      this.room.send("pos", { x: +my.x.toFixed(1), z: +my.z.toFixed(1) });
    }
    this._radar(my);
    for (const fn of this.hooks) fn(t, dt);
  },

  // ---------------------------------------------------------------- radar
  _radar(my) {
    const el = $("arena-radar");
    if (!el || (this._radarT && performance.now() - this._radarT < 120)) return;
    this._radarT = performance.now();
    const R = 44; // px radius
    const scale = R / Math.max(30, this.radius);
    let html = "";
    let nearest = Infinity;
    for (const e of this.entities.values()) {
      if (e.alive === false) continue;
      const dx = e.x - my.x, dz = e.z - my.z;
      const d = Math.hypot(dx, dz);
      nearest = Math.min(nearest, d);
      const cls = e.role === "hunter" ? "hunter" : (e.isBot ? "bot" : "human");
      if (this.fullRadar || d <= this.visRange) {
        // true bearing (inside visual range it's fair: you can see them)
        const th = -world3d.cam.theta;
        const rx = dx * Math.cos(th) - dz * Math.sin(th), rz = dx * Math.sin(th) + dz * Math.cos(th);
        const px = Math.max(-R, Math.min(R, rx * scale)), py = Math.max(-R, Math.min(R, rz * scale));
        html += `<i class="blip ${cls}" style="left:${R + px}px;top:${R + py}px"></i>`;
      } else {
        // distance band only: ring at the right distance, angle jittered
        const a = (e.jit ??= Math.random() * Math.PI * 2) + performance.now() / 4000;
        const rr = Math.min(R - 3, d * scale);
        html += `<i class="blip ${cls} faint" style="left:${R + Math.cos(a) * rr}px;top:${R + Math.sin(a) * rr}px"></i>`;
      }
    }
    el.innerHTML = html;
    const hud = $("arena-near");
    if (hud) {
      if (nearest < m2u(12)) { hud.textContent = "someone is RIGHT HERE"; hud.className = "hot"; }
      else if (nearest < m2u(30)) { hud.textContent = `someone within ${Math.round(nearest / U_PER_M)} m`; hud.className = "warm"; }
      else if (nearest < Infinity) { hud.textContent = `nearest ${Math.round(nearest / U_PER_M)} m`; hud.className = ""; }
      else { hud.textContent = "nobody in range"; hud.className = ""; }
    }
  },

  // ---------------------------------------------------------------- duel
  // Reaction duel between two players (attacker/defender) with spectators.
  // The host decides the outcome from the two reaction times.
  duel: {
    el: null, flashAt: 0, tapped: false, onTap: null, raf: null,
    start({ id, role, delayMs, a, b, onTap }) {
      const el = $("duel"); this.el = el;
      el.hidden = false; el.className = `role-${role}`;
      $("duel-a").textContent = a; $("duel-b").textContent = b;
      $("duel-verb").textContent = role === "attacker" ? "RIP on NOW" : role === "defender" ? "DODGE on NOW" : "watching…";
      const big = $("duel-big"); big.textContent = "…"; big.className = "";
      this.tapped = false; this.onTap = onTap; this.id = id;
      this.flashAt = performance.now() + delayMs;
      const btn = $("duel-tap");
      btn.hidden = role === "watch";
      btn.onclick = () => this.tap();
      clearInterval(this.raf);
      const loop = () => {
        if (this.el.hidden) { clearInterval(this.raf); return; }
        const left = this.flashAt - performance.now();
        if (left > 0) { if (big.className !== "wait") { big.textContent = "get ready"; big.className = "wait"; } }
        else if (!this.tapped && big.className !== "now") { big.textContent = "NOW!"; big.className = "now"; sfx.now(); buzz(30); }
      };
      this.raf = setInterval(loop, 25);
      loop();
    },
    tap() {
      if (this.tapped || !this.el || this.el.hidden) return;
      this.tapped = true;
      const dtms = performance.now() - this.flashAt;      // negative = jumped the gun
      $("duel-big").textContent = dtms < 0 ? "too early!" : `${Math.round(dtms)} ms`;
      this.onTap?.(this.id, dtms);
    },
    result(text, good) {
      $("duel-big").textContent = text; $("duel-big").className = good ? "good" : "bad";
      setTimeout(() => this.end(), 1100);
    },
    end() { if (this.el) { this.el.hidden = true; clearInterval(this.raf); } },
  },
};

// mark arena HUD mode at load
addEventListener("DOMContentLoaded", () => { const m = $("arena-mode"); if (m) m.textContent = GPS_MODE ? "GPS" : "joystick (sim)"; });
