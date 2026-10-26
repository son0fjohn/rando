// Manhunt's rules that don't need a screen: the zone (a circle or a drawn
// shape) and how it shrinks, the fuzzy circles a phone sends instead of
// where it is, the teams, the bounties and the points. No DOM, no three.js:
// the game, the map overlay, the bots and the tests all read it.
import { MANHUNT as M } from "./hpconfig.js";

const R_EARTH = 6371000;
export const mLat = 110540, mLng = lat => 111320 * Math.cos(lat * Math.PI / 180);

export function dist(a, b) {   // [lat, lng] pairs, metres (haversine)
  const p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180;
  const dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
// metres east / north of `o` -> [lat, lng]
export const offset = (o, east, north) => [o[0] + north / mLat, o[1] + east / mLng(o[0])];
const local = (o, p) => [(p[1] - o[1]) * mLng(o[0]), (p[0] - o[0]) * mLat];

// ---- the zone: { type: "circle", c: [lat, lng], r } | { type: "poly", pts: [[lat, lng], ...] }
export function zoneCentre(z) {
  if (!z) return null;
  if (z.type === "circle") return z.c;
  const n = z.pts.length;
  return [z.pts.reduce((a, p) => a + p[0], 0) / n, z.pts.reduce((a, p) => a + p[1], 0) / n];
}
// the zone's size as a radius (a shape: its farthest corner)
export function zoneRadius(z) {
  if (!z) return 0;
  if (z.type === "circle") return z.r;
  const c = zoneCentre(z);
  return Math.max(...z.pts.map(p => dist(c, p)));
}
// is the zone one the game can be played in? [ok, why]
export function zoneOk(z) {
  if (!z) return [false, "draw the zone on the map"];
  if (z.type === "circle") {
    if (!(z.r >= M.ZONE.minR)) return [false, `a bit bigger: at least ${M.ZONE.minR * 2} m across, a few blocks`];
    if (z.r > M.ZONE.maxR) return [false, `smaller: at most ${M.ZONE.maxR * 2 / 1000} km across`];
    return [true, ""];
  }
  if (!Array.isArray(z.pts) || z.pts.length < 3) return [false, "tap at least 3 corners"];
  if (z.pts.length > M.ZONE.maxPts) return [false, `at most ${M.ZONE.maxPts} corners`];
  const r = zoneRadius(z);
  if (r < M.ZONE.minR) return [false, `a bit bigger: at least ${M.ZONE.minR * 2} m across`];
  if (r > M.ZONE.maxR) return [false, `smaller: at most ${M.ZONE.maxR * 2 / 1000} km across`];
  return [true, ""];
}
// how big the zone is at a moment of the round (1 = full size): it holds,
// then shrinks in steps (SHRINK.steps); `next` is the coming step, if any
export function shrinkAt(frac, on = true) {
  let k = 1, next = null;
  if (on) for (const st of M.SHRINK.steps) { if (frac >= st.at) k = st.k; else { next = st; break; } }
  return { k, next };
}
// the zone at size k (about its centre)
export function zoneAt(z, k = 1) {
  if (!z || k === 1) return z;
  if (z.type === "circle") return { ...z, r: z.r * k };
  const c = zoneCentre(z);
  return { ...z, pts: z.pts.map(p => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]) };
}
export function inZone(z, p) {
  if (!z || !p) return false;
  if (z.type === "circle") return dist(z.c, p) <= z.r;
  const o = zoneCentre(z), q = local(o, p), ring = z.pts.map(x => local(o, x));
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < (xj - xi) * (q[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- fuzzy circles: what a phone sends instead of where it is
// the circle's size over the round: START_M at the start, MIN_M at the end
export const fuzzRadius = frac => Math.round(M.FUZZ.START_M - (M.FUZZ.START_M - M.FUZZ.MIN_M) * Math.max(0, Math.min(1, frac)));
// a circle of radius r that contains p: its centre moved up to 0.8 r in a
// random direction, then snapped to the grid (so the exact spot can't be
// averaged out of repeated pings either: each ping is a fresh draw)
export function fuzz(p, r, rng = Math.random) {
  const g = M.FUZZ.GRID_M;
  // (the snap moves the centre up to g/√2 more: the true spot always stays inside)
  const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * Math.max(0, Math.min(r * 0.8, r - g * 0.71));
  const o = offset(p, Math.cos(a) * d, Math.sin(a) * d);
  const gy = Math.round((o[0] * mLat) / g) * g / mLat, gx = Math.round((o[1] * mLng(p[0])) / g) * g / mLng(p[0]);
  return { c: [+gy.toFixed(6), +gx.toFixed(6)], r };
}
// a decoy: a circle like any other, somewhere else in the zone (200-450 m away)
export function decoy(p, r, z, rng = Math.random) {
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2, d = 200 + rng() * 250;
    const q = offset(p, Math.cos(a) * d, Math.sin(a) * d);
    if (!z || inZone(z, q)) return fuzz(q, r, rng);
  }
  return fuzz(p, r, rng);
}

// ---- teams: each player picked hunter, runner or random
// -> { roles: { id: "hunter" | "runner" }, warn: "" }
export function teams(ids, prefs = {}, rng = Math.random) {
  const roles = {}, rand = [];
  for (const id of ids) {
    const p = prefs[id];
    if (p === "hunter" || p === "runner") roles[id] = p; else rand.push(id);
  }
  for (let i = rand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rand[i], rand[j]] = [rand[j], rand[i]]; }
  // the randoms fill in toward about one hunter per four players
  const want = Math.max(1, Math.round(ids.length / 4));
  const count = r => Object.values(roles).filter(x => x === r).length;
  for (const id of rand) roles[id] = count("hunter") < want ? "hunter" : "runner";
  // a random pick never leaves the runners empty
  if (!count("runner") && rand.length > 1) roles[rand[rand.length - 1]] = "runner";
  return { roles, warn: lopsided(roles) };
}
// a warning when the teams won't make a good game ("" = fine)
export function lopsided(roles) {
  const v = Object.values(roles), h = v.filter(r => r === "hunter").length, r = v.filter(x => x === "runner").length;
  if (!h) return "no hunters: someone has to hunt";
  if (!r) return "no runners: someone has to run";
  if (h > r) return `${h} hunters for ${r} runner${r === 1 ? "" : "s"}: lopsided`;
  if (r >= 8 * h) return `${r} runners for one hunter: lopsided`;
  return "";
}

// ---- points: hunters for their tags (faster is worth more), runners for
// staying free (and lasting to the end, and being the last one standing)
// players: [{ id, wasRunner, tagged, out, endAt }]; tags: [{ by, at }]; huntMs: the hunt's length
export function points(players, tags, huntMs) {
  const P = M.POINTS, out = {};
  const runners = players.filter(p => p.wasRunner);
  const free = runners.filter(p => !p.tagged && !p.out);
  let last = null;
  if (free.length === 1) last = free[0].id;
  else if (!free.length && runners.length) last = runners.reduce((a, b) => ((b.endAt ?? 0) > (a.endAt ?? 0) ? b : a)).id;
  for (const p of players) {
    let pts = 0;
    if (p.wasRunner) {
      pts += Math.floor(Math.min(huntMs, p.endAt ?? huntMs) / 60000) * P.SURVIVE_MIN;
      if (!p.tagged && !p.out) pts += P.UNCAUGHT;
      if (p.id === last) pts += P.LAST_SURVIVOR;
    }
    for (const t of tags) if (t.by === p.id) pts += P.TAG + Math.round(P.FAST * Math.max(0, 1 - t.at / Math.max(1, huntMs)));
    out[p.id] = pts;
  }
  return { points: out, last };
}
// the bounty on a runner's poster, after `pings` pings survived (for show)
export const bounty = pings => M.BOUNTY.START + M.BOUNTY.PER_PING * pings;
export const won = n => `₩${Math.round(n).toLocaleString("en-US")}`;
