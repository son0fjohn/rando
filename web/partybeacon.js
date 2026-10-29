// Public house parties on the map: a giant neon house floating above the
// buildings of the party's area, bobbing and pulsing in the event pink, with
// light rays and a beam down to the street, labelled "Jae's party · 6/12".
// Tap it and the party card slides up (party.js).
//
// SAFETY: a house party is often at someone's home, so the beacon is NEVER at
// the host's position. The host's phone announces only its presence ZONE
// (the same on-device zone snap presence uses: a fixed launch zone, or a
// ~2 km grid cell) and each phone places the house at that zone's centre plus
// a fixed offset picked from the party id (40-140 m, any direction). No
// address, no coordinates of the host ever travel. Private parties are never
// announced, so they never get a beacon.
import { world3d, geoPos } from "./world3d.js";

const LIFT = 42;                         // world units above the street (over the rooftops)
const beacons = new Map();               // id -> { el, pos, ground }
let layer = null, onTap = null;

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// where a party's beacon stands: its zone's centre, nudged by the party id
export function beaconSpot(zone, partyId) {
  const h = hash(partyId);
  const ang = (h % 360) * Math.PI / 180, m = 40 + ((h >>> 9) % 101);   // 40..140 m
  const dLat = Math.cos(ang) * m / 110540, dLng = Math.sin(ang) * m / (111320 * Math.cos(zone.lat * Math.PI / 180));
  return { lat: zone.lat + dLat, lng: zone.lng + dLng };
}

const HOUSE = `<svg viewBox="0 0 22 20" shape-rendering="crispEdges" aria-hidden="true">
  <path class="pb-roof" d="M11 1L21 10H19V19H3V10H1Z"/>
  <path class="pb-win" d="M6 11h3v3H6zM13 11h3v3h-3z"/>
  <path class="pb-door" d="M9.5 15h3v4h-3z"/>
  <path class="pb-chim" d="M15 2h2v4h-2z"/>
</svg>`;

export const partyBeacons = {
  // tap handler: fn(entry)
  onTap(fn) { onTap = fn; },
  // list: [{ id, name, hostName, count, cap, vibe, zone: { lat, lng } }]
  sync(list) {
    if (!world3d.frame || !world3d.camera) return;
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "beacon-layer";
      world3d.frame.appendChild(layer);
      world3d.tickHooks.push(place);
    }
    const seen = new Set();
    for (const r of list) {
      if (!r.zone || !Number.isFinite(+r.zone.lat) || !Number.isFinite(+r.zone.lng)) continue;
      seen.add(r.id);
      let b = beacons.get(r.id);
      if (!b) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "pbeacon";
        el.innerHTML = `<span class="pb-beam"></span><span class="pb-rays"></span><span class="pb-house">${HOUSE}</span><span class="pb-label"></span>`;
        el.addEventListener("click", e => { e.stopPropagation(); onTap?.(beacons.get(r.id)?.entry); });
        layer.appendChild(el);
        b = { el };
        beacons.set(r.id, b);
      }
      const spot = beaconSpot(r.zone, r.id);
      const ground = geoPos(spot.lat, spot.lng);
      b.ground = ground;
      b.pos = ground.clone(); b.pos.y += LIFT;
      b.entry = r;
      const label = `${r.name || `${r.hostName}'s party`} · ${r.count}/${r.cap}`;
      const lab = b.el.querySelector(".pb-label");
      if (lab.textContent !== label) lab.textContent = label;
      b.el.setAttribute("aria-label", `${label} — tap for the party`);
      b.el.classList.toggle("live", r.state === "playing");
    }
    for (const [id, b] of beacons) if (!seen.has(id)) { b.el.remove(); beacons.delete(id); }
    world3d.needsRender = true;
  },
  clear() { this.sync([]); },
  get size() { return beacons.size; },
};

// every frame: put each house on screen (or pin it to the edge pointing at
// it), scaled so it's big up close and still readable from far away
function place() {
  if (!beacons.size) return;
  const W = world3d.frame.clientWidth, H = world3d.frame.clientHeight, cam = world3d.camera;
  for (const b of beacons.values()) {
    const v = b.pos.clone().project(cam), g = b.ground.clone().project(cam);
    const dist = cam.position.distanceTo(b.pos);
    const k = Math.max(0.55, Math.min(1.3, 260 / dist));
    let x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    // past the map's haze it isn't on the map: pinned to the edge, pointing the way
    const inRange = (world3d.rangeFade?.(b.ground) ?? 1) > 0.02;
    const on = inRange && v.z < 1 && x > 10 && x < W - 10 && y > 10 && y < H - 120;
    if (!on) {
      // off screen: clamp to the edge, small, pointing the way
      let dx = v.x, dy = -v.y;
      if (v.z > 1) { dx = -dx; dy = -dy; }
      const m = Math.max(Math.abs(dx), Math.abs(dy), 1e-3);
      x = (dx / m * 0.86 * 0.5 + 0.5) * W; y = (dy / m * 0.8 * 0.5 + 0.5) * H;
      x = Math.max(64, Math.min(W - 64, x)); y = Math.max(70, Math.min(H - 150, y));
    }
    b.el.classList.toggle("edge", !on);
    b.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    b.el.style.setProperty("--k", on ? k.toFixed(2) : "0.5");
    const beam = on && g.z < 1 ? Math.max(0, (-g.y * 0.5 + 0.5) * H - y) : 0;
    b.el.style.setProperty("--beam", `${Math.round(beam)}px`);
    b.el.style.zIndex = String(on ? Math.round(1000 - dist / 4) : 1);
  }
}
