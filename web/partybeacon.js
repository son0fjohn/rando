// Public house parties on the map: the host's own character, standing in the
// party's area, with a small low-poly house floating over their head: a gold
// roof, lit windows, a soft gold glow, gently bobbing and turning, readable
// by day and by night. A glass tag over it names the party and how many are
// in ("Full" when it is). It's there the whole time the party runs: in the
// lobby and through every game, until it ends. Tap the house, its tag or the
// host and the party card slides up (party.js).
//
// SAFETY: a house party is often at someone's home, so the host is NEVER
// drawn where they are. The host's phone announces only its presence ZONE
// (the same on-device zone snap presence uses: a fixed launch zone, or a
// ~2 km grid cell) and every phone stands the host at that zone's centre plus
// a fixed offset picked from the party id (partyhouse.js beaconSpot, 15-35 m
// any direction). No address, no coordinates of the host ever travel. That's
// also why the host shows here while they're inside the lobby or a game,
// where presence alone wouldn't put them: the announce does, at zone level.
// The host's presence character (if any) is left out of the cluster so they
// aren't drawn twice. Private parties are never announced, so they never get
// a house. Hand-off: a new host announces their own zone, and the house pops
// out over the old host and in over the new one.
import * as THREE from "https://esm.sh/three@0.160.0";
import { world3d, geoPos } from "./world3d.js";
import { makeHumanCharacter, makeHumanCharacterSync } from "./avatar4.js";
import { getDay } from "./daylight.js";
import { beaconSpot, diffHouses } from "./partyhouse.js";
import { t } from "./i18n.js";

const CHAR_H = 15;                        // (world3d.js CHAR_H) a character's height, world units
const POP_IN = 560, POP_OUT = 340;        // ms
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

const live = new Map();                   // house key -> rec
const dying = new Set();                  // recs popping out
let layer = null, onTap = null, me = null, hostIds = new Set(), kit = null;

// ---------------------------------------------------------------- the house
// one shared set of geometry and materials: a cream box, a gold hip roof
// (a 4-sided cone), a chimney, a navy door and four lit windows, flat-shaded
function makeKit() {
  // (drawn with the see-through things, after the glow: the glow shows
  // through the rooftops in front of it, the house itself never does)
  const std = (color, emissive = 0x000000, ei = 0) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, flatShading: true, roughness: 0.62, metalness: 0.05, transparent: true, opacity: 1 });
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, "rgba(255,214,110,.95)"); r.addColorStop(0.3, "rgba(255,190,60,.5)"); r.addColorStop(1, "rgba(255,170,30,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  })();
  return {
    body: new THREE.BoxGeometry(7, 5.2, 6),
    roof: new THREE.ConeGeometry(6.1, 4.4, 4, 1),
    chim: new THREE.BoxGeometry(1.1, 2.6, 1.1),
    door: new THREE.BoxGeometry(1.7, 2.8, 0.25),
    win: new THREE.BoxGeometry(1.4, 1.3, 0.2),
    wall: std(0xfff0d4, 0x6b4a14, 0.18),
    gold: std(0xf6b41c, 0xffa600, 0.5),
    navy: std(0x1d2a5c, 0x0a1030, 0.2),
    lit: new THREE.MeshBasicMaterial({ color: 0xffe7a1, transparent: true, opacity: 1 }),
    glowTex,
    disc: new THREE.CircleGeometry(1, 32),
  };
}
function makeHouse() {
  kit ??= makeKit();
  const K = kit, g = new THREE.Group(), body = new THREE.Group();
  const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.renderOrder = 2; body.add(m); return m; };
  add(K.body, K.wall, 0, 0, 0);
  const roof = add(K.roof, K.gold, 0, 2.6 + 2.2, 0, Math.PI / 4); roof.scale.set(1, 1, 0.9);
  add(K.chim, K.wall, 1.9, 4.6, -1.2);
  add(K.door, K.navy, 0, -1.2, 3.05);
  for (const [x, z, ry] of [[-2.2, 3.06, 0], [2.2, 3.06, 0], [3.56, 0, Math.PI / 2], [-3.56, 0, Math.PI / 2]]) add(K.win, K.lit, x, 0.6, z, ry);
  body.position.y = 0;
  g.add(body);
  // the soft gold glow behind it (a sprite: it always faces the camera; seen
  // over the rooftops, so a house behind a tower still shows where it is)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.glowTex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, opacity: 0.7 }));
  glow.scale.setScalar(22); glow.position.y = 1.4; glow.renderOrder = 1;
  g.add(glow);
  g.userData = { body, glow };
  return g;
}
// a soft gold pool of light on the street under the host
function makePool() {
  kit ??= makeKit();
  const m = new THREE.Mesh(kit.disc, new THREE.MeshBasicMaterial({ map: kit.glowTex, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.rotation.x = -Math.PI / 2; m.scale.setScalar(9);
  return m;
}

// ---------------------------------------------------------------- one party's house
function create(entry) {
  const rec = { key: entry.key, entry, born: performance.now(), out: 0, phase: Math.random() * 6.28, host: null, own: entry.hostId === me };
  live.set(rec.key, rec);
  rec.house = makeHouse();
  rec.pool = makePool();
  world3d.scene.add(rec.house, rec.pool);
  rec.tag = document.createElement("button");
  rec.tag.type = "button";
  rec.tag.className = "phouse-tag glass";
  rec.tag.innerHTML = `<i class="ph-ico" aria-hidden="true"></i><span class="ph-name"></span><span class="ph-n"></span><em class="ph-full"></em>`;
  rec.tag.addEventListener("click", e => { e.stopPropagation(); tap(rec); });
  layer.appendChild(rec.tag);
  rec.taps = [{ object: rec.house, onTap: () => tap(rec) }];
  world3d.tapTargets.push(...rec.taps);
  place(rec);
  if (!rec.own) spawnHost(rec);
  update(rec, entry);
  return rec;
}
function tap(rec) { if (!rec.out) onTap?.(rec.entry); }
function spot(entry) { const s = beaconSpot(entry.zone, entry.id); return geoPos(s.lat, s.lng); }
function place(rec) { if (!rec.own) rec.ground = spot(rec.entry); }

// the host's character under the house, in their own look (the announce's)
function spawnHost(rec) {
  const look = rec.entry.look ?? {};
  const install = api => {
    if (rec.out || !live.has(rec.key) || live.get(rec.key) !== rec) { api?.dispose?.(); return; }
    if (rec.host) dropHost(rec);
    rec.host = world3d.makeChar(look, rec.ground.clone(), world3d.scene, api ?? undefined);
    rec.host.api.group.rotation.y = Math.PI / 8;
    const tt = { object: rec.host.api.group, onTap: () => tap(rec) };
    rec.taps.push(tt); world3d.tapTargets.push(tt);
    world3d.needsRender = true;
  };
  const sync = makeHumanCharacterSync?.(look);
  if (sync) { install(sync); return; }
  // the character template isn't in yet: the blob stand-in now, the real one when it lands
  install(undefined);
  Promise.resolve(makeHumanCharacter?.(look)).then(api => api && Promise.resolve(api.ready).then(() => install(api))).catch(() => {});
}
function dropHost(rec) {
  if (!rec.host) return;
  const g = rec.host.api.group;
  world3d.tapTargets = world3d.tapTargets.filter(x => x.object !== g);
  rec.taps = rec.taps.filter(x => x.object !== g);
  world3d.removeChar(rec.host, world3d.scene);
  rec.host = null;
}
function update(rec, entry) {
  const lookChanged = JSON.stringify(entry.look ?? {}) !== JSON.stringify(rec.entry.look ?? {});
  const zoneChanged = entry.zone?.id !== rec.entry.zone?.id || entry.zone?.lat !== rec.entry.zone?.lat || entry.zone?.lng !== rec.entry.zone?.lng;
  rec.entry = entry;
  if (zoneChanged) { place(rec); if (rec.host) { rec.host.walkTarget = rec.ground.clone(); } }
  if (lookChanged && !rec.own) spawnHost(rec);
  const name = entry.name || t("ph.partyOf", { host: entry.hostName ?? "" });
  const q = s => rec.tag.querySelector(s);
  if (q(".ph-name").textContent !== name) q(".ph-name").textContent = name;
  const n = `${entry.count}/${entry.cap}`;
  if (q(".ph-n").textContent !== n) q(".ph-n").textContent = n;
  q(".ph-full").textContent = entry.full ? t("ph.full") : "";
  rec.tag.classList.toggle("full", !!entry.full);
  rec.tag.classList.toggle("live", entry.state === "playing");
  rec.tag.setAttribute("aria-label", `${name} · ${n}${entry.full ? ` · ${t("ph.full")}` : ""} — ${t("ph.tapHint")}`);
}
function kill(rec) {
  live.delete(rec.key);
  rec.out = performance.now();
  rec.tag.classList.add("out");
  dying.add(rec);
}
function dispose(rec) {
  dying.delete(rec);
  for (const tt of rec.taps) world3d.tapTargets = world3d.tapTargets.filter(x => x !== tt);
  dropHost(rec);
  world3d.scene.remove(rec.house, rec.pool);
  rec.house.traverse(o => { if (o.isSprite) o.material.dispose(); });
  rec.pool.material.dispose();
  rec.tag.remove();
}

// ---------------------------------------------------------------- every frame
const easeOutBack = k => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
function frame(t) {
  if (!live.size && !dying.size) return;
  const now = performance.now(), cam = world3d.camera, W = world3d.frame.clientWidth, H = world3d.frame.clientHeight;
  const day = getDay(), still = reduced();
  for (const rec of [...live.values(), ...dying]) {
    let pop;
    if (rec.out) {
      const k = Math.min(1, (now - rec.out) / POP_OUT);
      if (k >= 1) { dispose(rec); continue; }
      pop = still ? 1 - k : (1 - k) * (1 - k) * (1 + 1.6 * k);
    } else {
      const k = Math.min(1, (now - rec.born) / POP_IN);
      pop = still ? k : easeOutBack(k);
    }
    // where the house is: over the host's head (your own: over you)
    let ground = rec.ground;
    if (rec.own) {
      const p = world3d.player?.api.group.position;
      ground = p ? new THREE.Vector3(p.x, world3d.player.baseY ?? p.y, p.z) : null;
    } else if (rec.host) {
      const p = rec.host.api.group.position;
      ground = new THREE.Vector3(p.x, rec.host.baseY ?? ground.y, p.z);
      rec.host.api.group.scale.setScalar(Math.max(0.001, Math.min(1.15, pop)));
    }
    rec.house.visible = rec.pool.visible = !!ground;
    if (!ground) { rec.tag.style.display = "none"; continue; }
    // big enough to read when zoomed out, never smaller than up close
    const dist = cam.position.distanceTo(ground);
    const k = Math.max(1, Math.min(2.6, dist / 190));
    const bob = still ? 0 : Math.sin(t * 1.9 + rec.phase) * 0.9;
    const y = ground.y + CHAR_H + 3.5 + 5 * k + bob;
    rec.house.position.set(ground.x, y, ground.z);
    rec.house.scale.setScalar(Math.max(0.001, k * pop));
    rec.house.userData.body.rotation.y = still ? 0.5 : 0.5 + t * 0.45 + rec.phase;
    // the glow: a touch stronger at night, still there by day
    const glow = rec.house.userData.glow;
    glow.material.opacity = (0.5 + 0.32 * (1 - day)) * Math.min(1, pop) * (still ? 1 : 0.9 + 0.1 * Math.sin(t * 2.4 + rec.phase));
    kit.gold.emissiveIntensity = 0.32 + 0.45 * (1 - day);
    rec.pool.position.set(ground.x, ground.y + 0.12, ground.z);
    rec.pool.material.opacity = (0.35 + 0.3 * (1 - day)) * Math.min(1, pop);
    // the tag, over the roof (gone with the map's haze, like everything pinned to it)
    const top = new THREE.Vector3(ground.x, y + 6.5 * k, ground.z);
    const v = top.clone().project(cam);
    const fade = world3d.rangeFade?.(ground) ?? 1;
    const x = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
    const on = v.z < 1 && fade > 0.02 && x > -80 && x < W + 80 && sy > -40 && sy < H + 40;
    rec.house.visible = rec.pool.visible = fade > 0.02;
    if (rec.host) rec.host.api.group.visible = fade > 0.02;
    rec.tag.style.display = on ? "" : "none";
    if (on) {
      rec.tag.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(sy)}px, 0) translate(-50%, -100%) scale(${Math.min(1, pop).toFixed(3)})`;
      rec.tag.style.opacity = fade >= 0.99 ? "" : fade.toFixed(2);
      rec.tag.style.zIndex = String(Math.round(1000 - dist / 4));
    }
  }
  world3d.needsRender = true;
}

const rec0 = r => (r.host ? r.host.api.group.position : r.ground) ?? null;

// the host's own presence character (if presence shows them) would stand in
// the cluster too: leave them out while their house is up
function setHosts(ids) {
  const same = ids.size === hostIds.size && [...ids].every(id => hostIds.has(id));
  hostIds = ids;
  if (same) return;
  world3d.skipRemote = hostIds.size ? r => hostIds.has(r.userId) : null;
  if (world3d._lastRemotes) world3d.setRemotes(world3d._lastRemotes);
}

export const partyBeacons = {
  // tap handler: fn(entry)
  onTap(fn) { onTap = fn; },
  // houses: partyhouse.js housesFrom(directory list); opts.me: this phone's
  // user id (your own party's house floats over you, not a second you)
  sync(houses, { me: myId = null } = {}) {
    if (!world3d.frame || !world3d.camera || !world3d.scene) return;
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "beacon-layer";
      world3d.frame.appendChild(layer);
      world3d.tickHooks.push(frame);
    }
    me = myId;
    const byKey = new Map(houses.map(h => [h.key, h]));
    const d = diffHouses([...live.keys()], houses);
    for (const key of d.remove) kill(live.get(key));
    for (const key of d.keep) update(live.get(key), byKey.get(key));
    for (const key of d.add) create(byKey.get(key));
    setHosts(new Set(houses.filter(h => h.hostId !== me).map(h => h.hostId)));
    world3d.needsRender = true;
  },
  clear() { this.sync([]); },
  get size() { return live.size; },
  // tests: what's on the map
  debug() {
    return [...live.values()].map(r => ({ key: r.key, host: r.entry.hostId, full: !!r.entry.full, own: r.own, hasHost: !!r.host,
      n: r.tag.querySelector(".ph-n")?.textContent ?? "", pos: { x: r.house.position.x, y: r.house.position.y, z: r.house.position.z }, ground: rec0(r)?.y ?? null }));
  },
};
