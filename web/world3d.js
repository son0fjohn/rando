// Rando 3D world: low-poly flat-shaded scene with an orbit camera locked
// to your avatar (PoGo-style: rotate, tilt, zoom — the avatar keeps its
// screen spot, the world moves). Characters are billboards of the same
// relit renders used everywhere else. DOM bubbles/tags anchor to 3D
// points via projection each tick.
import * as THREE from "https://esm.sh/three@0.160.0";
import { mergeGeometries } from "https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js";
import { makeCharacter } from "./character3d.js";

const CHAR_H = 15;

// Geographic world: coordinates ARE real Itaewon geography, projected the
// same way scripts/fetch_roads.py bakes the OSM roads.
const GEO_CENTER = [37.5346, 126.9946]; // Itaewon station
const GEO_SCALE = 0.55;                 // world units per metre
const WORLD_EDGE = 1050;                // far positions clamp to this radius

function geoPos(lat, lng) {
  const mLat = 110540.0, mLng = 111320.0 * Math.cos(GEO_CENTER[0] * Math.PI / 180);
  let x = (Number(lng) - GEO_CENTER[1]) * mLng * GEO_SCALE;
  let z = -(Number(lat) - GEO_CENTER[0]) * mLat * GEO_SCALE; // north = -z
  const d = Math.hypot(x, z);
  if (d > WORLD_EDGE) { // visitors far outside Itaewon appear at the map
    x *= WORLD_EDGE / d; // edge in their true real-world direction
    z *= WORLD_EDGE / d;
  }
  return new THREE.Vector3(x, 0, z);
}

// NPCs at real spots: one pair in Gyeongnidan, one by Itaewon station.
const NPC_DEFS = [
  { id: "npc-silver",  lat: 37.5390, lng: 126.9884, partner: "npc-dreads",
    preset: { body: "grey",   eyes: "sleepy",  head: "floppyears" } },
  { id: "npc-dreads",  lat: 37.5389, lng: 126.9892, partner: "npc-silver",
    preset: { body: "navy",   eyes: "default", iris: "brown", head: "teardrop" } },
  { id: "npc-buzzcut", lat: 37.5349, lng: 126.9951, partner: "npc-cans",
    preset: { body: "red",    eyes: "anime",   iris: "orange", head: "smallspikes" } },
  { id: "npc-cans",    lat: 37.5347, lng: 126.9958, partner: "npc-buzzcut",
    preset: { body: "orange", eyes: "spiral",  head: "notailspike" } },
];

// day/night mode: auto from local time, ?mode=night|day overrides.
// Palettes are the law from assets/world/STYLE.md.
const modeParam = new URLSearchParams(location.search).get("mode");
const hourNow = new Date().getHours();
export const NIGHT = modeParam === "night" ||
  (modeParam !== "day" && (hourNow >= 19 || hourNow < 6.5));
const M = NIGHT ? {
  skyTop: "#0b1a38", skyMid: "#23406e", skyHor: "#547499",
  fog: 0x1c2c49, hemiSky: 0x4a5f8a, hemiGround: 0x1c2438, hemiInt: 0.72,
  sunCol: 0xa8c2e8, sunInt: 0.5, cloudBody: "#d8e2f2", cloudShade: "#8fa0bd",
  cloudTint: 0xc2cfe2, cloudOp: 0.8, grass: 0x3d5c40, road: 0x474c59,
  winCol: 0x2e2a22, winEmis: 0xffc86e,
} : {
  skyTop: "#2f83d2", skyMid: "#6cb2e6", skyHor: "#e2f1fa",
  fog: 0xdcebf6, hemiSky: 0xeaf6ff, hemiGround: 0x8fa3b8, hemiInt: 1.15,
  sunCol: 0xfff2d9, sunInt: 1.15, cloudBody: "#ffffff", cloudShade: "#c9dff0",
  cloudTint: 0xffffff, cloudOp: 0.95, grass: 0x79b356, road: 0x9599a2,
  winCol: 0x9db4c8, winEmis: 0x000000,
};

// zone character: density weight for buildings (urban) vs greenery
const ZONE_FLAVOR = [
  { lat: 37.5346, lng: 126.9946, build: 1.0,  green: 0.05 }, // Itaewon station
  { lat: 37.5349, lng: 126.9941, build: 0.95, green: 0.05 }, // Hamilton Alley
  { lat: 37.5392, lng: 126.9887, build: 0.7,  green: 0.3 },  // Gyeongnidan
  { lat: 37.5340, lng: 126.9868, build: 0.55, green: 0.35 }, // Noksapyeong
  { lat: 37.5418, lng: 126.9882, build: 0.3,  green: 0.9 },  // Haebangchon
  { lat: 37.5289, lng: 126.9944, build: 0.25, green: 0.85 }, // Bogwang
];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const world3d = {
  scene: null, camera: null, renderer: null, frame: null,
  cam: { theta: 0, elev: 0.58, dist: 175 },
  CAM_DEFAULT: { theta: 0, elev: 0.58, dist: 175 },
  camGoal: null,               // eased recenter target
  target: new THREE.Vector3(0, 0, 0),
  followPos: null,
  observing: false,            // true after a pan: camera roams free
  player: null, playerShadow: null,
  remoteGroup: null,
  zoneRings: new THREE.Group(),
  anchors: [],                 // { el, getPos } DOM overlays following 3D points
  needsRender: true,

  init(frameEl) {
    this.frame = frameEl;
    const w = frameEl.clientWidth, h = frameEl.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(w, h);
    Object.assign(this.renderer.domElement.style, {
      position: "absolute", inset: "0", touchAction: "none", cursor: "grab",
    });
    frameEl.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(M.skyTop);
    this.scene.fog = new THREE.Fog(M.fog, 340, 1250);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 2500);

    this.scene.add(new THREE.HemisphereLight(M.hemiSky, M.hemiGround, M.hemiInt));
    const sun = new THREE.DirectionalLight(M.sunCol, M.sunInt);
    sun.position.set(120, 200, 80);
    this.scene.add(sun);

    this.buildTerrain();
    this.scene.add(this.zoneRings);
    this.remoteGroup = new THREE.Group();
    this.scene.add(this.remoteGroup);
    for (const n of NPC_DEFS) {
      const pos = geoPos(n.lat, n.lng);
      const rec = this.makeChar(n.preset, pos, this.scene);
      const partner = NPC_DEFS.find(d => d.id === n.partner);
      if (partner) {
        const pp = geoPos(partner.lat, partner.lng);
        rec.api.group.rotation.y = Math.atan2(pp.x - pos.x, pp.z - pos.z);
      }
    }
    this.loadWorld(); // async: real roads + zone-flavored buildings/trees

    this.bindControls();
    window.addEventListener("resize", () => this.resize());

    // interval-driven ticks (works even in throttled tabs) + rAF when live
    setInterval(() => this.tick(), 90);
    const loop = () => { requestAnimationFrame(loop); this.tick(); };
    loop();
    this.applyCamera();
  },

  // canvas-generated texture helper
  canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },

  // Palette + design from the original painted world: pale tiled ground,
  // slate-blue roads with light sidewalk borders, white flat-roofed
  // buildings with dark window bands, blue sky and clouds. No trees.
  buildTerrain() {
    // sky: deep azure overhead easing to pale at the horizon (the art's
    // gradient), rendered on an inverted dome so fog can't wash it out
    const skyTex = this.canvasTex(16, 256, g => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, M.skyTop);
      grad.addColorStop(0.55, M.skyMid);
      grad.addColorStop(1, M.skyHor);
      g.fillStyle = grad;
      g.fillRect(0, 0, 16, 256);
      if (NIGHT) { // scatter of stars in the upper sky
        g.fillStyle = "rgba(255,255,255,0.9)";
        let s = 12345;
        for (let i = 0; i < 40; i++) {
          s = (s * 16807) % 2147483647;
          const x = s % 16, y = (s >> 4) % 120;
          g.fillRect(x, y, 1, 1);
        }
      }
    });
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 24, 12),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
    this.scene.add(sky);

    // cel-style cumulus like the original art: solid white rounded tops,
    // flat bases, cool blue shading tucked underneath — no airbrush fuzz
    const cloudTex = this.canvasTex(256, 128, g => {
      const puffs = [[52, 76, 28], [94, 58, 40], [144, 62, 36], [190, 76, 26], [120, 80, 42]];
      g.fillStyle = M.cloudShade; // under-shadow pass, nudged down
      for (const [x, y, r] of puffs) {
        g.beginPath(); g.arc(x, y + 8, r, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = M.cloudBody; // solid body
      for (const [x, y, r] of puffs) {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      g.fillRect(34, 66, 184, 26);   // unify the base into one mass
      g.fillStyle = M.cloudShade;    // thin shading strip along the base
      g.fillRect(40, 86, 172, 8);
      g.clearRect(0, 94, 256, 34);   // hard flat cut — cel look
    });
    const cloudRand = mulberry32(777);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, opacity: M.cloudOp, color: M.cloudTint, fog: false,
      }));
      const a = cloudRand() * Math.PI * 2;
      const r = 950 + cloudRand() * 450;
      s.position.set(Math.cos(a) * r, 130 + cloudRand() * 260, Math.sin(a) * r);
      const w = 220 + cloudRand() * 240;
      s.scale.set(w, w * 0.42, 1);
      this.scene.add(s);
    }

    // ground: open grass, per the globe reference — roads/buildings/trees
    // arrive from real geometry in loadWorld()
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1500, 48),
      new THREE.MeshLambertMaterial({ color: M.grass }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  },

  // Real Itaewon: roads baked from OpenStreetMap (scripts/fetch_roads.py),
  // buildings placed along actual road frontage with density driven by
  // zone character (urban clusters), trees filling the green zones.
  async loadWorld() {
    let data;
    try {
      data = await (await fetch("roads.json")).json();
    } catch { return; }
    const rand = mulberry32(4207);
    const WID = { primary: 24, secondary: 19, tertiary: 15, residential: 11, pedestrian: 8, unclassified: 11 };

    const roadGeos = [];
    const occupied = new Set(); // 25u cells covered by roads/buildings
    const mark = (x, z) => occupied.add(Math.round(x / 25) + "," + Math.round(z / 25));
    const candidates = [];
    for (const road of data.roads) {
      const w = WID[road.t] ?? 11;
      const pts = road.p;
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        if (i < pts.length - 1) {
          const [x2, z2] = pts[i + 1];
          const dx = x2 - x, dz = z2 - z;
          const len = Math.hypot(dx, dz);
          if (len < 0.5) continue;
          const ang = Math.atan2(dx, dz);
          const g = new THREE.BoxGeometry(w, 0.5, len);
          g.applyMatrix4(new THREE.Matrix4().makeRotationY(ang)
            .setPosition((x + x2) / 2, 0.25, (z + z2) / 2));
          roadGeos.push(g);
          const steps = Math.max(1, Math.floor(len / 22));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps, px = x + dx * t, pz = z + dz * t;
            mark(px, pz);
            if (road.t !== "pedestrian") candidates.push({ x: px, z: pz, ang, w });
          }
        }
        if (i > 0 && i < pts.length - 1) {
          const jg = new THREE.CylinderGeometry(w / 2, w / 2, 0.5, 10);
          jg.applyMatrix4(new THREE.Matrix4().setPosition(x, 0.25, z));
          roadGeos.push(jg);
        }
      }
    }
    this.scene.add(new THREE.Mesh(
      mergeGeometries(roadGeos),
      new THREE.MeshLambertMaterial({ color: M.road })));

    // zone flavor fields (gaussian falloff around zone centers)
    const flavors = ZONE_FLAVOR.map(f => ({ p: geoPos(f.lat, f.lng), build: f.build, green: f.green }));
    const fieldAt = (x, z, key) => {
      let v = 0;
      for (const f of flavors) {
        const d2 = (x - f.p.x) ** 2 + (z - f.p.z) ** 2;
        v = Math.max(v, f[key] * Math.exp(-d2 / (2 * 260 * 260)));
      }
      return v;
    };

    // buildings: colorful smooth boxes with accent roof slabs
    const bodyCols = [0xf4f1ea, 0xefe8dd, 0xe9eef2, 0xf7f7f7, 0xddd8cf];
    const accCols = [0xe2704e, 0x58b0a2, 0xf2b84b, 0x5a7fc2, 0xd95f79, 0x7fc98f, 0xc9524a];
    const bodyGeos = bodyCols.map(() => []);
    const accGeos = accCols.map(() => []);
    const winGeos = [];
    const usedLots = new Set();
    // gathering plazas: keep zone centers clear of structures
    const nearZoneCenter = (x, z, rad) =>
      flavors.some(f => (x - f.p.x) ** 2 + (z - f.p.z) ** 2 < rad * rad);
    for (const c of candidates) {
      const D = fieldAt(c.x, c.z, "build");
      if (rand() > D * 0.34) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const off = c.w / 2 + 9 + rand() * 15;
      const px = c.x + Math.cos(c.ang) * off * side;
      const pz = c.z - Math.sin(c.ang) * off * side;
      if (nearZoneCenter(px, pz, 78)) continue;
      const lot = Math.round(px / 36) + "," + Math.round(pz / 36);
      if (usedLots.has(lot)) continue;
      usedLots.add(lot);
      mark(px, pz);
      const fw = 16 + rand() * 14, fd = 16 + rand() * 14;
      let h = 10 + D * (14 + rand() * 46);
      // keep sightlines open around gathering plazas: low-rise near centers
      if (nearZoneCenter(px, pz, 170)) h = Math.min(h, 20);
      const bi = Math.floor(rand() * bodyCols.length);
      // reference look: mostly quiet white/grey, occasional colour pop
      const ai = rand() < 0.38 ? Math.floor(rand() * accCols.length) : -1;
      const rot = () => new THREE.Matrix4().makeRotationY(c.ang);
      const bg = new THREE.BoxGeometry(fw, h, fd);
      bg.applyMatrix4(rot().setPosition(px, h / 2, pz));
      bodyGeos[bi].push(bg);
      const rg = new THREE.BoxGeometry(fw + 2, 2.2, fd + 2);
      rg.applyMatrix4(rot().setPosition(px, h + 1.1, pz));
      if (ai >= 0) accGeos[ai].push(rg);
      else bodyGeos[bi].push(rg);
      if (h > 34 && rand() < 0.5) {
        const tg = new THREE.BoxGeometry(fw * 0.6, 10, fd * 0.6);
        tg.applyMatrix4(rot().setPosition(px, h + 7.2, pz));
        bodyGeos[bi].push(tg);
      }
      // window quads on front/back faces — cool glass by day, warm glow
      // at night (per STYLE.md)
      if (rand() < 0.65) {
        const rows = Math.max(1, Math.floor(h / 16));
        for (let wr = 0; wr < rows; wr++) {
          for (const face of [1, -1]) {
            if (rand() < 0.35) continue;
            const wg = new THREE.PlaneGeometry(fw * 0.55, 4.2);
            const wy = 7 + wr * (h - 10) / rows;
            const local = new THREE.Matrix4().makeRotationY(face === 1 ? 0 : Math.PI)
              .setPosition(0, 0, face * (fd / 2 + 0.25));
            const world = rot().setPosition(px, wy, pz).multiply(local);
            wg.applyMatrix4(world);
            winGeos.push(wg);
          }
        }
      }
    }
    bodyGeos.forEach((arr, i) => arr.length && this.scene.add(new THREE.Mesh(
      mergeGeometries(arr), new THREE.MeshLambertMaterial({ color: bodyCols[i] }))));
    accGeos.forEach((arr, i) => arr.length && this.scene.add(new THREE.Mesh(
      mergeGeometries(arr), new THREE.MeshLambertMaterial({ color: accCols[i] }))));
    if (winGeos.length) this.scene.add(new THREE.Mesh(
      mergeGeometries(winGeos),
      new THREE.MeshLambertMaterial({
        color: M.winCol,
        emissive: M.winEmis,
        emissiveIntensity: NIGHT ? 1 : 0,
      })));

    // trees: green-zone weighted, clear of roads and lots
    const trunkGeos = [];
    const canopyCols = [0x5e9c46, 0x6fae4f, 0x4f8f3e];
    const canopyGeos = canopyCols.map(() => []);
    for (let i = 0; i < 1500; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 1000;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (occupied.has(Math.round(x / 25) + "," + Math.round(z / 25))) continue;
      if (nearZoneCenter(x, z, 40)) continue;
      const G = fieldAt(x, z, "green") + 0.06;
      if (rand() > G * 0.75) continue;
      const tg = new THREE.CylinderGeometry(1.2, 1.5, 7, 7);
      tg.applyMatrix4(new THREE.Matrix4().setPosition(x, 3.5, z));
      trunkGeos.push(tg);
      const ci = Math.floor(rand() * canopyCols.length);
      const cr = 5 + rand() * 3;
      const cg = new THREE.SphereGeometry(cr, 10, 8);
      cg.applyMatrix4(new THREE.Matrix4().setPosition(x, 7 + cr * 0.7, z));
      canopyGeos[ci].push(cg);
    }
    if (trunkGeos.length) this.scene.add(new THREE.Mesh(
      mergeGeometries(trunkGeos), new THREE.MeshLambertMaterial({ color: 0x8a6a48 })));
    canopyGeos.forEach((arr, i) => arr.length && this.scene.add(new THREE.Mesh(
      mergeGeometries(arr), new THREE.MeshLambertMaterial({ color: canopyCols[i] }))));

    this.needsRender = true;
  },

  registerZones(zones) {
    this.zoneRings.clear();
    for (const z of zones.filter(z => z.kind !== "auto")) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(11, 13.5, 40),
        new THREE.MeshBasicMaterial({ color: 0x8fc2ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const p = geoPos(z.lat, z.lng);
      ring.position.set(p.x, 0.35, p.z);
      this.zoneRings.add(ring);
    }
    this.needsRender = true;
  },

  chars: new Set(),      // every live modular character (for animation)
  remoteRecs: [],

  makeChar(avatarCfg, pos, parent) {
    const api = makeCharacter(avatarCfg);
    api.group.position.copy(pos);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a0e14, transparent: true, opacity: 0.25 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(5.4, 2.6, 1);
    shadow.position.set(pos.x, 0.42, pos.z);
    parent.add(api.group);
    parent.add(shadow);
    const rec = { api, shadow, walkTarget: null };
    this.chars.add(rec);
    return rec;
  },

  removeChar(rec, parent) {
    parent.remove(rec.api.group);
    parent.remove(rec.shadow);
    this.chars.delete(rec);
  },

  setPlayer(opts) { // { avatar, lat, lng } | null
    const prevPos = this.player ? this.player.api.group.position.clone() : null;
    if (this.player) {
      this.removeChar(this.player, this.scene);
      this.player = null;
    }
    if (opts) {
      const pos = geoPos(opts.lat, opts.lng);
      // zone change while already in world: walk there instead of teleporting
      const spawnAt = prevPos && prevPos.distanceTo(pos) > 1 ? prevPos : pos;
      this.player = this.makeChar(opts.avatar, spawnAt, this.scene);
      if (!spawnAt.equals(pos)) this.player.walkTarget = pos.clone();
      this.followPos = this.player.api.group.position; // live ref: camera tracks walking
      this.observing = false; // going open snaps attention back to you
    } else {
      this.followPos = null;
    }
    this.needsRender = true;
  },

  setRemotes(list) { // [{ avatar, lat, lng, slot }]
    for (const rec of this.remoteRecs) this.removeChar(rec, this.remoteGroup);
    this.remoteRecs = [];
    this.remoteGroup.clear();
    for (const r of list) {
      const dx = (r.slot % 2 ? -1 : 1) * Math.ceil((r.slot + 1) / 2) * 9;
      const dz = ((r.slot % 3) - 1) * 5;
      const pos = geoPos(r.lat, r.lng).add(new THREE.Vector3(dx, 0, dz));
      const rec = this.makeChar(r.avatar, pos, this.remoteGroup);
      // face roughly inward toward the cluster for a hanging-out feel
      rec.api.group.rotation.y = Math.atan2(-dx, 6);
      this.remoteRecs.push(rec);
    }
    this.needsRender = true;
  },

  // ---- DOM overlays pinned to 3D points ----
  anchor(el, getPos) {
    this.anchors.push({ el, getPos });
    this.placeAnchor(this.anchors[this.anchors.length - 1]);
  },
  anchorAtZone(el, lat, lng, headY = CHAR_H + 1) {
    const p = geoPos(lat, lng);
    this.anchor(el, () => new THREE.Vector3(p.x, headY, p.z));
  },
  anchorAtNpc(el, npcId) {
    const n = NPC_DEFS.find(n => n.id === npcId);
    if (!n) return;
    this.anchorAtZone(el, n.lat, n.lng);
  },
  anchorAtPlayer(el, headY = CHAR_H + 1) {
    this.anchor(el, () =>
      this.player ? this.player.api.group.position.clone().setY(headY) : null);
  },
  placeAnchor(a) {
    if (!a.el.isConnected) return false;
    const pos = a.getPos();
    if (!pos) { a.el.style.display = "none"; return true; }
    const v = pos.project(this.camera);
    if (v.z > 1) { a.el.style.display = "none"; return true; }
    a.el.style.display = "";
    a.el.style.left = ((v.x * 0.5 + 0.5) * this.frame.clientWidth) + "px";
    a.el.style.top = ((-v.y * 0.5 + 0.5) * this.frame.clientHeight) + "px";
    return true;
  },

  // ---- camera ----
  applyCamera() {
    const t = this.target;
    const { theta, elev, dist } = this.cam;
    this.camera.position.set(
      t.x + dist * Math.sin(theta) * Math.cos(elev),
      t.y + dist * Math.sin(elev),
      t.z + dist * Math.cos(theta) * Math.cos(elev));
    this.camera.lookAt(t.x, t.y + CHAR_H + 4, t.z);
    this.needsRender = true;
  },

  recenter() {
    this.observing = false;
    this.camGoal = { ...this.CAM_DEFAULT };
  },

  // One-finger drag PANS (free observer); two fingers pinch-zoom, twist to
  // rotate, move vertically together to tilt. Desktop: drag pans, wheel
  // zooms, right-click or Ctrl+drag orbits. Recenter returns to follow.
  bindControls() {
    const el = this.renderer.domElement;
    const pointers = new Map();
    let gesture = null;
    el.addEventListener("contextmenu", e => e.preventDefault());
    el.addEventListener("pointerdown", e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.camGoal = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = {
          type: "two",
          d0: Math.hypot(a.x - b.x, a.y - b.y),
          a0: Math.atan2(b.y - a.y, b.x - a.x),
          midY0: (a.y + b.y) / 2,
          dist0: this.cam.dist, theta0: this.cam.theta, elev0: this.cam.elev,
        };
      } else if (pointers.size === 1) {
        // locked on your character while open: one finger orbits around
        // you (no ghost/spectator pan); free pan only while invisible
        gesture = { type: this.followPos ? "orbit"
          : (e.button === 2 || e.ctrlKey) ? "orbit" : "pan" };
      }
      el.style.cursor = "grabbing";
    });
    el.addEventListener("pointermove", e => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture && gesture.type === "two" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.cam.dist = Math.min(420, Math.max(70, gesture.dist0 * (gesture.d0 / d)));
        this.cam.theta = gesture.theta0 + (ang - gesture.a0);
        this.cam.elev = Math.min(1.25, Math.max(0.22,
          gesture.elev0 + ((a.y + b.y) / 2 - gesture.midY0) * 0.004));
        this.applyCamera();
      } else if (gesture && gesture.type === "orbit") {
        this.cam.theta -= (e.clientX - prev.x) * 0.006;
        this.cam.elev = Math.min(1.25, Math.max(0.22, this.cam.elev + (e.clientY - prev.y) * 0.004));
        this.applyCamera();
      } else if (gesture && gesture.type === "pan") {
        this.observing = true; // free observer mode until recenter
        const k = this.cam.dist * 0.0016;
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        const sin = Math.sin(this.cam.theta), cos = Math.cos(this.cam.theta);
        this.target.x += (-cos * dx - sin * dy) * k;
        this.target.z += (sin * dx - cos * dy) * k;
        this.target.x = Math.max(-1100, Math.min(1100, this.target.x));
        this.target.z = Math.max(-1100, Math.min(1100, this.target.z));
        this.applyCamera();
      }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && gesture && gesture.type === "two") {
        gesture = pointers.size === 1 ? { type: "pan" } : null;
      }
      if (!pointers.size) {
        gesture = null;
        el.style.cursor = "grab";
      }
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", e => {
      e.preventDefault();
      this.cam.dist = Math.min(420, Math.max(70, this.cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
      this.applyCamera();
    }, { passive: false });
  },

  resize() {
    const w = this.frame.clientWidth, h = this.frame.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  },

  lastT: 0,

  tick() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.2, t - this.lastT || 0.016);
    this.lastT = t;

    // animate characters: walking movement + idle/waddle cycles
    if (this.chars.size) this.needsRender = true;
    for (const rec of this.chars) {
      if (rec.walkTarget) {
        const gp = rec.api.group.position;
        const d = new THREE.Vector3().subVectors(rec.walkTarget, gp);
        d.y = 0;
        const dist = d.length();
        if (dist < 0.4) {
          rec.walkTarget = null;
          rec.api.walking = false;
        } else {
          rec.api.walking = true;
          rec.api.group.rotation.y = Math.atan2(d.x, d.z);
          d.normalize().multiplyScalar(Math.min(dist, dt * 16));
          gp.add(d);
        }
      }
      rec.api.tick(t);
      rec.shadow.position.set(rec.api.group.position.x, 0.42, rec.api.group.position.z);
    }

    // glide the camera target home — unless the user is roaming free
    if (!this.observing) {
      const goal = this.followPos ?? new THREE.Vector3(0, 0, 0);
      if (this.target.distanceTo(goal) > 0.5) {
        this.target.lerp(goal, 0.18);
        this.applyCamera();
      }
    }
    if (this.camGoal) {
      const c = this.cam, g = this.camGoal;
      c.theta += (g.theta - c.theta) * 0.2;
      c.elev += (g.elev - c.elev) * 0.2;
      c.dist += (g.dist - c.dist) * 0.2;
      if (Math.abs(g.theta - c.theta) < 0.005 && Math.abs(g.dist - c.dist) < 1) this.camGoal = null;
      this.applyCamera();
    }
    this.anchors = this.anchors.filter(a => this.placeAnchor(a));
    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  },
};
