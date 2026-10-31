// Joining a party from the map: are you near the host? (No three.js, no
// network: the logic tests read it.)
//
// Only a join by tapping a public party on the map is checked. QR codes,
// codes and invite links skip it: having the code already means you're with
// them. GPS inside a bar is often 50-100 m off, so the check is forgiving:
// it passes when the two accuracy circles come within PARTY.JOIN_RANGE_M of
// each other.
//
// PRIVACY: the host's position never leaves the host's phone. The joiner's
// phone sends a FUZZED circle (snapped to a 10 m grid, moved 25-50 m a random
// way, its radius grown to cover that) on the party's channel; only the
// host's phone reads it, checks it and forgets it, and answers just "ok" or
// "too far, about N km" in coarse steps. Nothing is stored. The host answers
// each joiner a few times at most (KNOCKS), so nobody can walk circles round
// a party to find the door.
import { PARTY } from "./hpconfig.js";

export const ACC_CAP_M = 300;      // a ±3 km fix doesn't get to pass everything
const FUZZ_MIN = 25, FUZZ_MAX = 50, GRID_M = 10;
export const KNOCKS = { max: 6, perMs: 10 * 60 * 1000 };

const R = 6371000, rad = d => d * Math.PI / 180;
export function distM(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// the joiner's circle as it leaves the phone; rnd for tests
export function fuzzCircle({ lat, lng, acc }, rnd = Math.random) {
  const m = FUZZ_MIN + rnd() * (FUZZ_MAX - FUZZ_MIN), ang = rnd() * 2 * Math.PI;
  const mLat = R * Math.PI / 180, mLng = mLat * Math.cos(rad(lat));
  const snap = (v, per) => Math.round(v * per / GRID_M) * GRID_M / per;
  return {
    lat: snap(lat + Math.cos(ang) * m / mLat, mLat), lng: snap(lng + Math.sin(ang) * m / mLng, mLng),
    acc: Math.round(Math.min(Number(acc) || ACC_CAP_M, ACC_CAP_M) + FUZZ_MAX + GRID_M),
  };
}

// "about 1.5 km": never finer than half a kilometre
export function coarseKm(m) {
  const km = m < 2000 ? Math.max(0.5, Math.ceil(m / 500) * 0.5) : Math.round(m / 1000);
  return km;
}

// on the host's phone: joiner's (fuzzed) circle vs the host's own fix
export function judge(joiner, host, range = PARTY.JOIN_RANGE_M) {
  const d = distM(joiner, host);
  const slack = Math.min(joiner.acc || 0, ACC_CAP_M + FUZZ_MAX + GRID_M) + Math.min(host.acc || 0, ACC_CAP_M);
  return d - slack <= range ? { ok: true } : { ok: false, km: coarseKm(d) };
}

// the host's rate limit: fn(from) -> may this knock be answered?
export function knockLimiter(now = () => Date.now()) {
  const seen = new Map();
  return from => {
    const t = now(), list = (seen.get(from) ?? []).filter(x => t - x < KNOCKS.perMs);
    if (list.length >= KNOCKS.max) { seen.set(from, list); return false; }
    list.push(t); seen.set(from, list); return true;
  };
}
