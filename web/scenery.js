// The start screen's city: our 3D Itaewon, lit by the real sun over it
// (world3d.js applyLight), as pure scenery behind
// the glass panel (onboard.js "start"). No people, no labels, no pins, the
// map full screen; the camera drifts slowly over the busiest blocks on a
// loop, and on Start / Join it dives from the sky into the party's building.
//
//   scenery.on()           full-screen city, drifting (30 fps)
//   scenery.off()          back to the normal map (players, labels, frame)
//   scenery.live           the 3D is drawing (else: the still image shows)
//   scenery.whenLive(ms)   resolves true once live, false after ms
//   scenery.dive(seed)     -> Promise (~1.5 s); seed picks the building, so
//                          everyone in a party dives into the same one
//   scenery.slow           this phone struggled: the glass goes lite
//   scenery.pullOut(seed)  -> Promise (~1.4 s), on the map (scenery off):
//                          leaving a party, the dive backwards, out of the
//                          building onto you (onboard.js toWorld)
//
// web/start/night.jpg and day.jpg are the drift's first frame (scenery.pose(0))
// by night and by day (index.html picks by the sun), shown at once and
// crossfaded to the live city; test/start_rec.mjs --still re-shoots them
// when the city or the path changes.
import { world3d, CHAR_H, terrainY } from "./world3d.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
// the loop the target follows (world units: Itaewon station is 0,0; Ikovox
// cafe is west, the Grand Ole Opry east), a closed Catmull-Rom
const PATH = [[0, 10], [-70, -30], [-125, -10], [-80, 45], [5, 55], [95, 30], [80, -40], [30, -35]];
const LOOP_S = 150;            // seconds per lap
const SPIN = 0.045;            // rad/s round the target
const THETA0 = 2.35;           // the first frame's heading (the still image's)

function catmull(u) {
  const n = PATH.length, f = ((u % 1) + 1) % 1 * n, i = Math.floor(f), k = f - i;
  const p = j => PATH[(i + j + n) % n];
  const [a, b, c, d] = [p(-1), p(0), p(1), p(2)];
  const q = (A, B, C, D) => 0.5 * (2 * B + (-A + C) * k + (2 * A - 5 * B + 4 * C - D) * k * k + (-A + 3 * B - 3 * C + D) * k * k * k);
  return [q(a[0], b[0], c[0], d[0]), q(a[1], b[1], c[1], d[1])];
}
const ease = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

let on = false, hook = null, t0 = 0, diving = null;
// the scenery's clock: real time, unless a test drives it frame by frame
// (test/start_rec.mjs records the drift and the dive that way: this sandbox
// has no GPU)
const clock = t => typeof globalThis.__sceneryClock === "function" ? globalThis.__sceneryClock() : t;

export const scenery = {
  live: false,
  slow: false,
  measured: 0,                 // the median frame time it decided on (ms)

  // the camera at drift time s: { x, z, theta, elev, dist }
  pose(s) {
    const [x, z] = catmull(s / LOOP_S);
    return {
      x, z,
      theta: THETA0 + s * SPIN,
      elev: 0.44 + 0.05 * Math.sin(s * 0.05),
      dist: 300 + 26 * Math.sin(s * 0.033 + 1),
    };
  },

  on() {
    if (on || !world3d.camera) return;
    on = true;
    world3d.hold?.();          // Itaewon's own map while the start screen is up
    world3d.mapView = false;   // the drift's own wide view (no haze round a player, looking straight at the target)
    document.body.classList.add("scenery");
    // full screen, not the map's phone-shaped frame
    world3d.resize();
    world3d.observing = true;
    world3d.camGoal = null;
    world3d.maxFps = this.slow ? 20 : 30;
    world3d.setPaused(false);
    t0 = 0;
    hook = t => {
      t = clock(t);
      // pure scenery: every character (you, the others, the mascots) and the zone rings away
      for (const rec of world3d.chars) { rec.api.group.visible = false; if (rec.shadow) rec.shadow.visible = false; }
      world3d.zoneRings.visible = false;
      // the buildings straight up as soon as they're there (the rise is the map's loading flourish, not ours)
      if (world3d.risers) world3d.finishRise();
      if (diving) return diving(t);
      if (!this.live) return;
      if (!t0) t0 = t;
      // (reduced motion: the first frame, still; __sceneryHold: tests and the still image)
      this.place(this.pose(REDUCED || globalThis.__sceneryHold ? (globalThis.__sceneryHoldAt ?? 0) : t - t0));
    };
    world3d.tickHooks.push(hook);
    world3d.whenBuilt().then(() => this._goLive());
    if (world3d.built) this._goLive();
  },

  off() {
    if (!on) return;
    on = false; diving = null;
    const i = world3d.tickHooks.indexOf(hook); if (i >= 0) world3d.tickHooks.splice(i, 1);
    hook = null;
    for (const rec of world3d.chars) { rec.api.group.visible = true; if (rec.shadow) rec.shadow.visible = true; }
    world3d.zoneRings.visible = true;
    world3d.maxFps = 0;
    this.live = false;
    document.body.classList.remove("scenery-live");
    world3d.camera.fov = 50; world3d.camera.updateProjectionMatrix();
    world3d.mapView = true;    // the map's own view again (the haze closes in round you)
    document.body.classList.remove("scenery");
    world3d.resize();
    world3d.recenter();
    world3d.releaseWorld?.();
  },

  _goLive() {
    if (!on || this.live) return;
    this.live = true;
    this.place(this.pose(0));
    document.body.classList.add("scenery-live");
    document.dispatchEvent(new Event("scenery-live"));
    this._measure();
  },
  whenLive(ms) {
    if (this.live) return Promise.resolve(true);
    return new Promise(res => {
      const done = v => { clearTimeout(tm); document.removeEventListener("scenery-live", ok); res(v); };
      const ok = () => done(true);
      const tm = setTimeout(() => done(false), ms);
      document.addEventListener("scenery-live", ok);
    });
  },

  // a pause on the same clock (the dive's beats)
  wait(ms) {
    const c = globalThis.__sceneryClock;
    if (typeof c !== "function") return new Promise(r => setTimeout(r, ms));
    const end = c() + ms / 1000;
    return new Promise(r => { const iv = setInterval(() => { if (c() >= end) { clearInterval(iv); r(); } }, 15); });
  },

  // camera from a drift pose (the same maths as world3d.applyCamera)
  place(p) {
    const w = world3d, ty = terrainY(p.x, p.z);
    w.target.set(p.x, ty, p.z);
    w.cam.theta = p.theta; w.cam.elev = p.elev; w.cam.dist = p.dist;
    w.applyCamera();
  },

  // a slow phone: frames timed in 1.5 s windows for as long as the start
  // screen is up; two windows in a row mostly over 50 ms (under 20 fps) ->
  // no live blur behind the glass, and fewer frames. (One slow window can be
  // a hiccup: a load, a GC.)
  _measure() {
    let gaps = [], last = 0, t0 = 0, slowRuns = 0;
    const step = now => {
      if (!on || this.slow) return;
      if (!t0) t0 = now;
      if (last) gaps.push(now - last);
      last = now;
      if (now - t0 >= 1500) {
        gaps.sort((a, b) => a - b);
        const median = gaps.length >= 3 ? gaps[gaps.length >> 1] : now - t0;
        this.measured = Math.round(median);
        slowRuns = median > 50 ? slowRuns + 1 : 0;
        gaps = []; t0 = now;
        if ((slowRuns >= 2 && !globalThis.__sceneryNoSlow) || globalThis.__sceneryForceSlow) {
          this.slow = true;
          document.body.classList.add("glass-lite");
          world3d.maxFps = 20;
          return;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  // Explore the world: from wherever the drift is, a glide down onto the
  // map's own view over a spot (world x/z), as smooth as the dive; the map
  // takes over from there (scenery.off, then the world screen, on you)
  glide(to, ms = 1800) {
    if (!on || REDUCED) return Promise.resolve(false);
    const w = world3d, cam = w.camera, d = w.CAM_DEFAULT;
    const T = { x: to.x, y: to.y ?? terrainY(to.x, to.z), z: to.z };
    const P0 = cam.position.clone();
    const L0 = w.target.clone(); L0.y += CHAR_H + 4;
    // (onto the map's own view: looking a little ahead of the spot)
    const { pos: P1, look: L1 } = w.camPose ? w.camPose(T, d, true) : { pos: { x: T.x + d.dist * Math.sin(d.theta) * Math.cos(d.elev), y: T.y + d.dist * Math.sin(d.elev), z: T.z + d.dist * Math.cos(d.theta) * Math.cos(d.elev) }, look: { x: T.x, y: T.y + CHAR_H + 4, z: T.z } };
    w.target.set(T.x, T.y, T.z);       // (the city streams round where we're going)
    return new Promise(res => {
      let s0 = 0;
      diving = t => {
        if (!s0) s0 = t;
        const k = Math.min(1, (t - s0) * 1000 / ms), e = ease(k), lk = ease(Math.min(1, k * 1.25));
        // a gentle arc: a little lift mid-way so it reads as flying, not sliding
        const lift = Math.sin(Math.PI * e) * 40;
        cam.position.set(P0.x + (P1.x - P0.x) * e, P0.y + (P1.y - P0.y) * e + lift, P0.z + (P1.z - P0.z) * e);
        cam.lookAt(L0.x + (L1.x - L0.x) * lk, L0.y + (L1.y - L0.y) * lk, L0.z + (L1.z - L0.z) * lk);
        w.needsRender = true;
        if (k >= 1) {
          Object.assign(w.cam, d);
          w.mapView = true;    // (landed: the map's view, so the next frame doesn't jump)
          w.applyCamera();
          diving = () => {};
          res(true);
        }
      };
    });
  },

  // Leaving a party (onboard.js toWorld): the dive backwards, on the map
  // itself (the scenery is off). The camera starts just over the party's
  // building's roof looking down into it, rises out over it and settles on
  // the map's own view over you (where the map rests: your character, or
  // your last zone until you're back on the map), then the map's camera
  // takes over. Far from that building (a city elsewhere) it lifts off the
  // street right over you instead. Reduced motion: no flight, the map's view at once.
  pullOut(seed = "", ms = 1400) {
    const w = world3d, cam = w.camera;
    if (!cam) return Promise.resolve(false);
    const d = w.CAM_DEFAULT;
    const home = () => w.followPos ?? w.restPos ?? { x: 0, y: 0, z: 0 };
    const rest = () => {
      const T = home(), y = T.y ?? terrainY(T.x, T.z);
      return { T: { x: T.x, y, z: T.z },
        P: { x: T.x + d.dist * Math.sin(d.theta) * Math.cos(d.elev), y: y + d.dist * Math.sin(d.elev), z: T.z + d.dist * Math.cos(d.theta) * Math.cos(d.elev) },
        L: { x: T.x, y: y + CHAR_H + 4, z: T.z } };
    };
    const settle = () => {
      const { T } = rest();
      w.target.set(T.x, T.y, T.z);
      Object.assign(w.cam, d);
      w.camGoal = null; w.observing = false;
      cam.fov = 50; cam.updateProjectionMatrix();
      w.applyCamera();
    };
    if (REDUCED) { settle(); return Promise.resolve(false); }
    const r0 = rest();
    const lot = this.lobbyLot(seed);
    const near = lot && Math.hypot(lot.cx - r0.T.x, lot.cz - r0.T.z) < 450;
    let P0, L0, C;
    if (near) {
      const roofY = terrainY(lot.cx, lot.cz) - 1.2 + lot.h;
      const hx = r0.P.x - lot.cx, hz = r0.P.z - lot.cz, hd = Math.hypot(hx, hz) || 1;
      P0 = { x: lot.cx + hx / hd * 7, y: roofY + 9, z: lot.cz + hz / hd * 7 };
      L0 = { x: lot.cx, y: roofY, z: lot.cz };
      // the swoop's high point: over the building, a little toward where
      // we're going, high enough to rise past the map's view and settle onto it
      C = { x: lot.cx + (r0.P.x - lot.cx) * 0.35, y: Math.max(r0.P.y, roofY) + 90, z: lot.cz + (r0.P.z - lot.cz) * 0.35 };
    } else {
      const T = r0.T;
      P0 = { x: T.x + Math.sin(d.theta) * 6, y: T.y + CHAR_H + 30, z: T.z + Math.cos(d.theta) * 6 };
      L0 = { x: T.x, y: T.y, z: T.z };
      C = { x: (P0.x + r0.P.x) / 2, y: Math.max(r0.P.y, P0.y) + 90, z: (P0.z + r0.P.z) / 2 };
    }
    const place = k => {
      const { P: P1, L: L1 } = rest(), e = ease(k), m = 1 - e;
      cam.position.set(
        m * m * P0.x + 2 * m * e * C.x + e * e * P1.x,
        m * m * P0.y + 2 * m * e * C.y + e * e * P1.y,
        m * m * P0.z + 2 * m * e * C.z + e * e * P1.z);
      const lk = ease(Math.min(1, k * 1.3));
      cam.lookAt(L0.x + (L1.x - L0.x) * lk, L0.y + (L1.y - L0.y) * lk, L0.z + (L1.z - L0.z) * lk);
      cam.fov = 50 + 12 * Math.sin(Math.PI * k);
      cam.updateProjectionMatrix();
      w.needsRender = true;
    };
    w.observing = false; w.camGoal = null;
    place(0);
    this.pulling = true;
    return new Promise(res => {
      let s0 = 0, done = false;
      const finish = () => {
        if (done) return; done = true;
        clearTimeout(guard);
        const i = w.tickHooks.indexOf(hook); if (i >= 0) w.tickHooks.splice(i, 1);
        this.pulling = false;
        settle();
        res(true);
      };
      // (a map that isn't drawing still lands: no frame for a while, it's
      // done; not while a test steps the clock frame by frame)
      let guard = 0;
      const watch = () => { clearTimeout(guard); if (typeof globalThis.__sceneryClock !== "function") guard = setTimeout(finish, Math.max(ms, 2500)); };
      const hook = t => {
        t = clock(t);
        if (!s0) s0 = t;
        const k = Math.min(1, (t - s0) * 1000 / ms);
        place(k);
        watch();
        if (k >= 1) finish();
      };
      watch();
      w.tickHooks.push(hook);
    });
  },
  pulling: false,

  // which building is the party's: one of the tallest near the middle of
  // the loop, picked by the seed (the party code)
  lobbyLot(seed = "") {
    const lots = (world3d.lots ?? []).filter(l => Math.hypot(l.cx, l.cz) < 170 && l.h > 14);
    if (!lots.length) return null;
    lots.sort((a, b) => b.h - a.h);
    const top = lots.slice(0, 12);
    let h = 7; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return top[h % top.length];
  },

  // from wherever the drift is, down into the building: the camera swoops
  // over it and drops onto the roof while the look settles straight down,
  // then the screen goes navy (the lobby is drawn by the caller)
  dive(seed, ms = 1500) {
    if (!on || !this.live || REDUCED) return Promise.resolve(false);
    const lot = this.lobbyLot(seed);
    if (!lot) return Promise.resolve(false);
    const cam = world3d.camera, w = world3d;
    const roofY = terrainY(lot.cx, lot.cz) - 1.2 + lot.h;
    const P0 = cam.position.clone();
    const L0 = w.target.clone(); L0.y += CHAR_H + 4;
    const L1 = { x: lot.cx, y: roofY, z: lot.cz };
    // the swoop's high point: above the building, a little short of it
    const C = { x: lot.cx + (P0.x - lot.cx) * 0.35, y: Math.max(P0.y, roofY + 160), z: lot.cz + (P0.z - lot.cz) * 0.35 };
    // ...and the end: just over the roof's edge on our side, looking down into it
    const hx = P0.x - lot.cx, hz = P0.z - lot.cz, hd = Math.hypot(hx, hz) || 1;
    const P1 = { x: lot.cx + hx / hd * 7, y: roofY + 9, z: lot.cz + hz / hd * 7 };
    const fov0 = cam.fov;
    return new Promise(res => {
      let s0 = 0;
      diving = t => {
        if (!s0) s0 = t;
        const k = Math.min(1, (t - s0) * 1000 / ms), e = ease(k), m = 1 - e;
        // quadratic Bézier P0 -> C -> P1
        cam.position.set(
          m * m * P0.x + 2 * m * e * C.x + e * e * P1.x,
          m * m * P0.y + 2 * m * e * C.y + e * e * P1.y,
          m * m * P0.z + 2 * m * e * C.z + e * e * P1.z);
        const lk = ease(Math.min(1, k * 1.6));
        cam.lookAt(L0.x + (L1.x - L0.x) * lk, L0.y + (L1.y - L0.y) * lk, L0.z + (L1.z - L0.z) * lk);
        cam.fov = fov0 + 14 * Math.sin(Math.PI * Math.min(1, k * 1.1));
        cam.updateProjectionMatrix();
        w.needsRender = true;
        if (k >= 1) { diving = () => {}; res(true); }
      };
    });
  },
};
