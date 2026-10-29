// Manhunt on the map (world3d in city mode): the play zone as a glowing gold
// wall (#FFC83D) that steps inward when it shrinks (the next size dashed on
// the ground during the warning), the pings as glowing circles over the
// buildings with the runner's name, fading until the next ping, your
// teammates as fuzzy circles, your own character where you are (your phone
// only), and, for the host's setup, the zone being drawn and a tap -> place.
// On a phone without the 3D map (tests' stub) every call is a no-op.
//
//   const m = mhMap(world3d);
//   m.zone(z, k); m.next(k2); m.pings([{ key, name, c, r, at, kind }]); m.mates([...]);
//   m.focus(z, { cover }); m.pick(clientX, clientY) -> [lat, lng]; m.draft(z); m.dispose();
import * as THREE from "https://esm.sh/three@0.160.0";
import { zoneCentre, zoneRadius, inZone } from "./mhgeo.js";
import { PMTiles } from "./pmtiles.js";
import { lngLatToTile, tileToLngLat } from "./citygen.js";

const GOLD = 0xffc83d;
const M2U = 0.55;   // world units per metre (world3d)

function fadeTex() {
  const c = document.createElement("canvas"); c.width = 4; c.height = 128;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, "rgba(255,255,255,0.75)"); gr.addColorStop(0.12, "rgba(255,255,255,0.42)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function discTex() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0.10)"); gr.addColorStop(0.82, "rgba(255,255,255,0.32)"); gr.addColorStop(0.94, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function mhMap(world) {
  const live = !!world?.scene && typeof world.geo === "function";
  if (!live) {
    const noop = () => {};
    return { live: false, zone: noop, next: noop, pings: noop, mates: noop, focus: noop, pick: () => null, draft: noop, show: noop, dispose: noop, debug: {} };
  }
  const root = new THREE.Group(); root.name = "manhunt"; world.scene.add(root);
  const wallTex = fadeTex(), ringTex = discTex();
  const wallM = new THREE.MeshBasicMaterial({ color: GOLD, map: wallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const lineM = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95, depthWrite: false });
  const nextM = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, depthWrite: false });
  const WALL_H = 70;

  // ---- the zone: built at full size round its centre, scaled to its size k
  const zoneG = new THREE.Group(); root.add(zoneG);
  const nextG = new THREE.Group(); root.add(nextG);
  let Z = null, kNow = 1, kWant = 1;
  function shape(z, g, { wall = true, dash = false, m = lineM } = {}) {
    g.clear();
    if (!z) return;
    const c = world.geo(...zoneCentre(z));
    g.position.set(c.x, 0, c.z);
    // the outline as world points round the centre
    let pts;
    if (z.type === "circle") {
      const n = 96, r = z.r * M2U;
      pts = Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r]);
    } else pts = z.pts.map(p => { const q = world.geo(...p); return [q.x - c.x, q.z - c.z]; });
    for (let i = 0; i < pts.length; i++) {
      if (dash && i % 2) continue;
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bz - az, bx - ax);
      if (wall) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(len, WALL_H), wallM);
        w.position.set((ax + bx) / 2, WALL_H / 2, (az + bz) / 2); w.rotation.y = -ang; w.renderOrder = 3;
        g.add(w);
      }
      const l = new THREE.Mesh(new THREE.PlaneGeometry(len + 0.6, dash ? 2.2 : 3.2), m);
      l.rotation.x = -Math.PI / 2; l.rotation.z = -ang; l.position.set((ax + bx) / 2, 0.5, (az + bz) / 2); l.renderOrder = 4;
      g.add(l);
    }
  }
  function zone(z, k = 1, { instant = false } = {}) {
    if (z !== Z) { Z = z; shape(z, zoneG); kNow = instant ? k : kNow; }
    kWant = k; if (instant) kNow = k;
    world.needsRender = true;
  }
  // the coming step's size, dashed on the ground (null: none coming)
  function next(k) {
    nextG.visible = !!(Z && k);
    if (Z && k) { shape(Z, nextG, { wall: false, dash: true, m: nextM }); nextG.scale.set(k, 1, k); }
    world.needsRender = true;
  }

  // ---- pings and teammates: a glowing disc each, a name over it
  const rings = new Map();   // key -> { mesh, label, at, kind }
  const COLORS = { ping: 0xff5a4a, live: 0xff2a2a, mate: 0x5ad8ff, me: 0xffc83d };
  function ring(key, { name, c, r, kind = "ping", at = performance.now() }) {
    let o = rings.get(key);
    const p = world.geo(c[0], c[1]);
    if (!o) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: ringTex, color: COLORS[kind] ?? COLORS.ping, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
      // (drawn over the buildings: a circle on the street would hide behind them)
      mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 5; root.add(mesh);
      const pos = new THREE.Vector3();
      const label = world.addLabel?.(name, "ping", 6, () => pos);
      o = { mesh, label, pos, kind };
      rings.set(key, o);
    }
    o.mesh.material.color.setHex(COLORS[kind] ?? COLORS.ping);
    o.mesh.position.set(p.x, 0.7 + (kind === "mate" ? 0.1 : 0), p.z);
    o.r = r * M2U;
    o.pos.set(p.x, 14, p.z);
    o.at = at; o.kind = kind;
    if (o.label) o.label.el.lastChild.textContent = name;
  }
  function drop(key) {
    const o = rings.get(key); if (!o) return;
    root.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose();
    if (o.label) world.removeLabel?.(o.label);
    rings.delete(key);
  }
  const sync = (list, prefix) => {
    const keep = new Set();
    for (const x of list) { const k = prefix + x.key; keep.add(k); ring(k, x); }
    for (const k of [...rings.keys()]) if (k.startsWith(prefix) && !keep.has(k)) drop(k);
    world.needsRender = true;
  };
  let fadeMs = 5 * 60 * 1000;
  const pings = (list, { fade } = {}) => { if (fade) fadeMs = fade; sync(list, "p:"); };
  const mates = list => sync(list, "m:");

  // ---- the camera: the whole zone in view
  // (cover: the share of the screen's bottom a sheet covers: the camera
  // aims short of the zone so it sits in the open part above)
  function focus(z, { cover = 0 } = {}) {
    if (!z) return;
    const c = world.geo(...zoneCentre(z)), r = zoneRadius(z) * M2U;
    world.observing = true;
    const th = world.cam.theta, k = r * cover * 1.5;
    world.target.set(c.x + Math.sin(th) * k, 0, c.z + Math.cos(th) * k);
    const dist = Math.max(160, Math.min(1500, r * 2.3));
    world.setFreeView?.(true);   // the whole zone in view: past the map's own haze and zoom range
    world.camGoal = { theta: world.cam.theta, elev: 0.95, dist };
    // the fog starts past the zone, seen from up there (not 300 units from the camera)
    if (world.scene.fog) { world.scene.fog.near = Math.max(300, dist * 0.85); world.scene.fog.far = Math.max(980, dist + r * 2.2); }
    world.camera.far = Math.max(2500, r * 4); world.camera.updateProjectionMatrix();
    world.applyCamera?.();
    world.needsRender = true;
  }
  // a tap on the map -> the ground point under it [lat, lng]
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function pick(clientX, clientY) {
    const r = world.renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), world.camera);
    if (!ray.ray.intersectPlane(ground, hit)) return null;
    return world.ungeo(hit.x, hit.z);
  }
  // the host's zone while it's being drawn (corners shown as pins)
  const draftG = new THREE.Group(); root.add(draftG);
  const pinM = new THREE.MeshBasicMaterial({ color: GOLD });
  function draft(z, corners = []) {
    draftG.clear();
    for (const p of corners) { const q = world.geo(...p); const pin = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 10, 10), pinM); pin.position.set(q.x, 5, q.z); draftG.add(pin); }
    zone(z, 1, { instant: true });
  }

  // ---- each frame: the shrink eases in, pings fade until the next one, live ones pulse
  const hook = (t, dt) => {
    if (Math.abs(kWant - kNow) > 0.001) { kNow += (kWant - kNow) * Math.min(1, dt * 1.2); world.needsRender = true; }
    zoneG.scale.set(kNow, 1, kNow);
    const now = performance.now();
    // true size up close; zoomed out to the whole zone, never smaller than a dot you can see
    const least = (world.cam?.dist ?? 0) * 0.016;
    for (const o of rings.values()) {
      o.mesh.scale.setScalar(Math.max(4, o.r ?? 0, least));
      const age = now - o.at;
      const a = o.kind === "live" ? 0.65 + 0.35 * Math.sin(t * 6) : o.kind === "mate" ? 0.75 : Math.max(0.15, 1 - age / fadeMs);
      o.mesh.material.opacity = a;
      if (o.label) o.label.alpha = Math.max(0.35, a);
    }
    if (rings.size) world.needsRender = true;
  };
  world.tickHooks.push(hook);

  return {
    live: true, zone, next, pings, mates, focus, pick, draft,
    show(on) { root.visible = on; for (const o of rings.values()) if (o.label) o.label.hidden = !on; world.needsRender = true; },
    get k() { return kNow; },
    dispose() {
      world.tickHooks.splice(world.tickHooks.indexOf(hook), 1);
      for (const k of [...rings.keys()]) drop(k);
      world.scene.remove(root);
      root.traverse(o => o.geometry?.dispose?.());
      wallTex.dispose(); ringTex.dispose(); wallM.dispose(); lineM.dispose(); nextM.dispose(); pinM.dispose();
      world.camera.far = 2500; world.camera.updateProjectionMatrix();
      world.setFreeView?.(false);   // (the map's own haze and view back)
      world.observing = false;
      world.needsRender = true;
    },
    debug: { root, zoneG, rings },
  };
}

// the big roads a zone takes in (from the city chunks): names, for the host's
// safety warning. [] when there's no city data here.
const MAJOR = new Set(["motorway", "trunk", "primary"]);
const archives = new Map();
export async function majorRoads(world, z) {
  const url = world?.city?.url;
  if (!url || !z) return [];
  const href = new URL(url, document.baseURI).href;
  if (!archives.has(href)) archives.set(href, new PMTiles(href));
  const src = archives.get(href);
  const c = zoneCentre(z), R = zoneRadius(z);
  const dLat = R / 110540, dLng = R / (111320 * Math.cos(c[0] * Math.PI / 180));
  const [x0, y1] = lngLatToTile(c[1] - dLng, c[0] - dLat, 16).map(Math.floor), [x1, y0] = lngLatToTile(c[1] + dLng, c[0] + dLat, 16).map(Math.floor);
  const names = new Map();
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    let t = null;
    try { const b = await src.tile(16, x, y); t = b && JSON.parse(new TextDecoder().decode(b)); } catch { t = null; }
    for (const r of t?.r ?? []) {
      if (!MAJOR.has(r.c)) continue;
      for (let k = 0; k < r.p.length; k += 2) {
        const [lng, lat] = tileToLngLat(16, x, y, r.p[k], r.p[k + 1]);
        if (inZone(z, [lat, lng])) { const n = r.n || "a major road"; names.set(n, (names.get(n) ?? 0) + 1); break; }
      }
    }
  }
  return [...names.keys()].sort((a, b) => (a === "a major road") - (b === "a major road"));
}
