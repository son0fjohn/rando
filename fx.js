// Rando demo FX: synthesized sound, NPC reveal moments, attention beacons,
// screen flashes/shakes. No audio files — everything is WebAudio so it ships
// with the static build and never 404s.
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
import { world3d, CHAR_H } from "./world3d.js";
import { staticize, matteify } from "./avatar3.js";

// ---------------------------------------------------------------- audio
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
// unlock on first gesture (mobile)
["pointerdown", "touchstart", "keydown"].forEach(ev =>
  window.addEventListener(ev, () => { try { ac(); } catch {} }, { once: true, passive: true }));

function tone(freq, dur, { type = "sine", gain = 0.18, attack = 0.005, release = 0.08, slide = null, at = 0 } = {}) {
  const c = ac();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  const t0 = c.currentTime + at;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.setValueAtTime(gain, t0 + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, { gain = 0.12, lp = 1200, lpEnd = 200, at = 0 } = {}) {
  const c = ac();
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "lowpass";
  const t0 = c.currentTime + at;
  f.frequency.setValueAtTime(lp, t0); f.frequency.exponentialRampToValueAtTime(lpEnd, t0 + dur);
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}
export const sfx = {
  tick() { try { tone(880, 0.06, { gain: 0.12 }); } catch {} },
  tickUrgent() { try { tone(1320, 0.07, { gain: 0.16, type: "square" }); } catch {} },
  ping() { try { tone(1046, 0.12, { gain: 0.1 }); tone(1568, 0.18, { gain: 0.1, at: 0.1 }); } catch {} },
  open() { try { tone(523, 0.12, { gain: 0.14 }); tone(659, 0.12, { at: 0.11, gain: 0.14 }); tone(784, 0.22, { at: 0.22, gain: 0.16 }); } catch {} },
  whoosh() { try { noise(0.35, { gain: 0.2, lp: 2400, lpEnd: 300 }); } catch {} },
  now() { try { tone(1200, 0.09, { type: "square", gain: 0.2 }); } catch {} },
  rip() { try { noise(0.25, { gain: 0.25, lp: 3000, lpEnd: 600 }); tone(220, 0.3, { type: "sawtooth", gain: 0.12, slide: 110 }); } catch {} },
  dodge() { try { tone(660, 0.08, { gain: 0.12 }); tone(990, 0.12, { at: 0.07, gain: 0.12 }); } catch {} },
  win() { try { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { at: i * 0.13, gain: 0.16 })); tone(1046, 0.5, { at: 0.55, gain: 0.18 }); } catch {} },
  lose() { try { tone(330, 0.5, { type: "sawtooth", gain: 0.12, slide: 80 }); noise(0.5, { gain: 0.15, lp: 800, lpEnd: 80 }); } catch {} },
  boom() { try { tone(120, 0.6, { type: "sine", gain: 0.3, slide: 30 }); noise(0.6, { gain: 0.3, lp: 600, lpEnd: 60 }); } catch {} },
  klaxon() { try { tone(320, 0.5, { type: "sawtooth", gain: 0.16, slide: 140 }); tone(320, 0.5, { type: "sawtooth", gain: 0.16, slide: 140, at: 0.55 }); } catch {} },
  whistle() { try { tone(2100, 0.35, { type: "triangle", gain: 0.14, slide: 2300 }); tone(2300, 0.3, { type: "triangle", gain: 0.14, at: 0.4, slide: 1900 }); } catch {} },
  chime() { try { [1568, 2093, 2637].forEach((f, i) => tone(f, 0.6, { at: i * 0.09, gain: 0.08, release: 0.4 })); } catch {} },
  pop() { try { tone(700, 0.05, { gain: 0.12, slide: 1400 }); } catch {} },
  stamp() { try { noise(0.12, { gain: 0.25, lp: 1500, lpEnd: 400 }); tone(180, 0.12, { gain: 0.2, slide: 90 }); } catch {} },
};
export function buzz(pattern = 60) { try { navigator.vibrate?.(pattern); } catch {} }

// ---------------------------------------------------------------- screen fx
const flashEl = document.createElement("div");
flashEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:900;opacity:0;transition:opacity .25s";
document.body.appendChild(flashEl);
export function flash(color = "#fff", ms = 160) {
  flashEl.style.transition = "none"; flashEl.style.background = color; flashEl.style.opacity = "0.85";
  requestAnimationFrame(() => { flashEl.style.transition = `opacity ${ms}ms`; flashEl.style.opacity = "0"; });
}
let shakeUntil = 0, shakeAmp = 0;
export function shake(ms = 400, amp = 1.6) { shakeUntil = performance.now() + ms; shakeAmp = amp; }
world3d.tickHooks.push(() => {
  if (performance.now() < shakeUntil) {
    const k = (shakeUntil - performance.now()) / 400;
    world3d.camera.position.x += (Math.random() - 0.5) * shakeAmp * k;
    world3d.camera.position.y += (Math.random() - 0.5) * shakeAmp * k;
    world3d.needsRender = true;
  }
});

// ---------------------------------------------------------------- tweens
const tweens = [];
function tween(dur, fn, ease = t => t, done = null) {
  tweens.push({ t0: performance.now(), dur, fn, ease, done });
}
world3d.tickHooks.push(() => {
  const now = performance.now();
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    tw.fn(tw.ease(k));
    if (k >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
  if (tweens.length) world3d.needsRender = true;
});
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ---------------------------------------------------------------- particles
function burst(pos, { count = 24, colors = [0xffd60a, 0xff5d8a, 0x4da6ff, 0x7dff5e], size = 0.9, speed = 18, up = 22, life = 1400 } = {}) {
  const group = new THREE.Group();
  const items = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true }));
    m.position.copy(pos);
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random());
    items.push({ m, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: up * (0.5 + Math.random()), rot: Math.random() * 6 });
    group.add(m);
  }
  world3d.scene.add(group);
  const t0 = performance.now();
  const step = () => {
    const k = (performance.now() - t0) / life;
    for (const it of items) {
      it.m.position.x += it.vx * 0.016; it.m.position.z += it.vz * 0.016;
      it.vy -= 40 * 0.016; it.m.position.y += it.vy * 0.016;
      it.m.rotation.x += it.rot * 0.03; it.m.rotation.y += it.rot * 0.02;
      it.m.material.opacity = 1 - k;
    }
    world3d.needsRender = true;
    if (k < 1) requestAnimationFrame(step);
    else { world3d.scene.remove(group); items.forEach(it => { it.m.geometry.dispose(); it.m.material.dispose(); }); }
  };
  step();
}
function hearts(pos) {
  const group = new THREE.Group();
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const g = cv.getContext("2d"); g.fillStyle = "#ff6b9d"; g.font = "52px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("♥", 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  const items = [];
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.setScalar(3.2);
    sp.position.set(pos.x + (Math.random() - 0.5) * 6, pos.y + CHAR_H * 0.8, pos.z + (Math.random() - 0.5) * 6);
    items.push({ sp, vy: 6 + Math.random() * 5, wob: Math.random() * 6 });
    group.add(sp);
  }
  world3d.scene.add(group);
  const t0 = performance.now();
  const step = () => {
    const k = (performance.now() - t0) / 1800;
    for (const it of items) { it.sp.position.y += it.vy * 0.016; it.sp.position.x += Math.sin(k * 8 + it.wob) * 0.05; it.sp.material.opacity = 1 - k; }
    world3d.needsRender = true;
    if (k < 1) requestAnimationFrame(step); else { world3d.scene.remove(group); tex.dispose(); }
  };
  step();
}

// ---------------------------------------------------------------- props
const loader = new GLTFLoader();
const propCache = {};
async function loadProp(name, height) {
  if (propCache[name]) return propCache[name].clone(true);
  try {
    const g = await loader.loadAsync(`quests/props/${name}.glb`);
    const src = g.scene;
    src.updateWorldMatrix(true, true);
    staticize(src); matteify(src);
    const holder = new THREE.Group(); holder.add(src); holder.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(holder); const size = new THREE.Vector3(); box.getSize(size);
    holder.scale.setScalar(height / size.y); holder.updateWorldMatrix(true, true);
    const b2 = new THREE.Box3().setFromObject(holder);
    holder.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    const wrap = new THREE.Group(); wrap.add(holder);
    propCache[name] = wrap;
    return wrap.clone(true);
  } catch (e) {
    return null;
  }
}
function proceduralLever() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 3.4), new THREE.MeshLambertMaterial({ color: 0x8a6a2a }));
  base.position.y = 0.6; g.add(base);
  const arm = new THREE.Group(); arm.position.set(0, 1.2, 0);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 10), new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }));
  rod.position.y = 3.5; arm.add(rod);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 12), new THREE.MeshLambertMaterial({ color: 0xd92b2b }));
  knob.position.y = 7.2; arm.add(knob);
  g.add(arm); g.userData.arm = arm;
  return g;
}

// ---------------------------------------------------------------- NPC reveals
// Real animation over time on the actual NPC mesh (+ props, lights, particles,
// sound). Each returns a promise that resolves when the moment is over.
export async function reveal(arch) {
  const rec = world3d.archRecs[`arch-${arch}`];
  if (!rec) return;
  const g = rec.api.group;
  const base = g.position.clone();
  const yaw0 = g.rotation.y;
  rec.api.revealing = true;
  if (arch === "chill") {
    // Nabi: halo glow, two hops with a full spin, hearts + chime
    sfx.chime();
    const light = new THREE.PointLight(0xffe3a0, 0, 60); light.position.copy(base).add(new THREE.Vector3(0, CHAR_H * 1.1, 0));
    world3d.scene.add(light);
    await new Promise(res => tween(1700, k => {
      const hop = Math.abs(Math.sin(k * Math.PI * 2)) * 6;
      g.position.y = base.y + hop;
      g.rotation.y = yaw0 + easeInOut(k) * Math.PI * 2;
      light.intensity = 2.5 * Math.sin(k * Math.PI);
      if (k > 0.45 && k < 0.5) hearts(base);
    }, t => t, res));
    world3d.scene.remove(light);
  } else if (arch === "chaos") {
    // Nalli: hops beside a lever, YANKS it; red/magenta strobe, klaxon, shake
    let lever = await loadProp("lever", 9);
    if (!lever) lever = proceduralLever();
    lever.position.copy(base).add(new THREE.Vector3(7, 0, 0));
    lever.position.y = base.y;
    world3d.scene.add(lever);
    const arm = lever.userData.arm || lever.children[0];
    const red = new THREE.PointLight(0xff2a4a, 0, 80); red.position.copy(base).add(new THREE.Vector3(0, 14, 0));
    const mag = new THREE.PointLight(0xff3ad6, 0, 80); mag.position.copy(base).add(new THREE.Vector3(6, 10, 4));
    world3d.scene.add(red, mag);
    // hop toward the lever
    await new Promise(res => tween(500, k => {
      g.position.x = base.x + easeOut(k) * 3.5;
      g.position.y = base.y + Math.sin(k * Math.PI) * 4;
      g.rotation.y = Math.PI / 2;
    }, t => t, res));
    sfx.klaxon(); shake(600, 2.2); buzz([80, 40, 80]);
    await new Promise(res => tween(900, k => {
      if (arm) arm.rotation.z = -0.7 + easeInOut(Math.min(1, k * 1.6)) * 1.4;   // the yank
      const strobe = Math.sin(k * Math.PI * 10) > 0;
      red.intensity = strobe ? 4 : 0.3; mag.intensity = strobe ? 0.3 : 4;
      g.position.y = base.y + (k < 0.3 ? Math.sin(k / 0.3 * Math.PI) * 2 : 0);
    }, t => t, res));
    flash("#ff2a4a", 220);
    await new Promise(res => tween(600, k => { red.intensity = 4 * (1 - k); mag.intensity = 4 * (1 - k); g.position.x = base.x + 3.5 * (1 - easeOut(k)); }, t => t, res));
    world3d.scene.remove(red, mag, lever);
  } else {
    // Dali: a sprint lap around the spot, a leap, whistle + confetti
    sfx.whistle(); buzz(50);
    await new Promise(res => tween(1500, k => {
      const a = k * Math.PI * 4;
      g.position.x = base.x + Math.sin(a) * 5;
      g.position.z = base.z + Math.cos(a) * 5;
      g.rotation.y = a + Math.PI / 2;
      rec.api.walking = true;
    }, t => t, res));
    rec.api.walking = false;
    await new Promise(res => tween(700, k => {
      g.position.x = base.x; g.position.z = base.z;
      g.position.y = base.y + Math.sin(k * Math.PI) * 9;
      g.rotation.y = yaw0 + k * Math.PI * 2;
      if (k > 0.4 && k < 0.46) burst(base.clone().add(new THREE.Vector3(0, CHAR_H * 0.9, 0)), { count: 36 });
    }, t => t, res));
  }
  g.position.copy(base); g.rotation.y = yaw0;
  rec.api.revealing = false;
  world3d.needsRender = true;
}

// victory / resolution burst at a position (used by quests + games)
export function celebrate(pos) { sfx.win(); burst(pos, { count: 48, up: 26 }); flash("#fff", 200); buzz([40, 30, 40, 30, 120]); }

// ---------------------------------------------------------------- beacons
// "Something is happening HERE, now": a light column + a ring of orbiting dots
// (one per person in the lobby, so headcount is readable from across the map)
// + pulsing ground ring + an edge arrow when off-screen + an audible ping and
// a vibration when a window opens near you. Motion over static state.
const beacons = new Map();
const arrowLayer = document.createElement("div");
arrowLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:60;overflow:hidden";
let arrowLayerMounted = false;
function mountArrows() { if (!arrowLayerMounted && world3d.frame) { world3d.frame.appendChild(arrowLayer); arrowLayerMounted = true; } }

export const beacon = {
  set(id, pos, { count = 0, color = 0xffd60a, live = false, label = "" } = {}) {
    mountArrows();
    let b = beacons.get(id);
    if (!b) {
      const group = new THREE.Group();
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 140, 12, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      col.position.y = 70;
      group.add(col);
      const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7.2, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
      group.add(ring);
      const dots = new THREE.Group(); dots.position.y = CHAR_H + 6;
      group.add(dots);
      const arrow = document.createElement("div");
      arrow.className = "edge-arrow";
      arrow.innerHTML = `<span class="ea-dot"></span><span class="ea-txt"></span>`;
      arrowLayer.appendChild(arrow);
      b = { group, col, ring, dots, arrow, color, n: 0, live, label, t0: performance.now() };
      world3d.scene.add(group);
      beacons.set(id, b);
    }
    b.group.position.set(pos.x, pos.y, pos.z);
    b.live = live; b.label = label;
    b.col.material.color.setHex(color); b.ring.material.color.setHex(color);
    if (b.n !== count) {
      b.dots.clear();
      for (let i = 0; i < Math.min(count, 24); i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ color }));
        b.dots.add(d);
      }
      b.n = count;
    }
    b.arrow.querySelector(".ea-txt").textContent = label;
    b.arrow.style.setProperty("--c", `#${color.toString(16).padStart(6, "0")}`);
  },
  clear(id) {
    const b = beacons.get(id); if (!b) return;
    world3d.scene.remove(b.group); b.arrow.remove(); beacons.delete(id);
  },
  has(id) { return beacons.has(id); },
};
world3d.tickHooks.push(t => {
  if (!beacons.size) return;
  const W = world3d.frame.clientWidth, H = world3d.frame.clientHeight;
  for (const b of beacons.values()) {
    const k = (performance.now() - b.t0) / 1000;
    const pulse = b.live ? 0.32 + 0.18 * Math.sin(k * 7) : 0.16 + 0.08 * Math.sin(k * 2.5);
    b.col.material.opacity = pulse;
    const rk = (k % 1.6) / 1.6;
    b.ring.scale.setScalar(1 + rk * 2.2); b.ring.material.opacity = 0.7 * (1 - rk);
    b.dots.rotation.y = k * (b.live ? 2.4 : 1.1);
    const r = 7 + Math.min(b.n, 24) * 0.5;
    b.dots.children.forEach((d, i) => {
      const a = i / Math.max(1, b.dots.children.length) * Math.PI * 2;
      d.position.set(Math.cos(a) * r, Math.sin(k * 3 + i) * 1.2, Math.sin(a) * r);
    });
    // edge arrow when the beacon is off-screen
    const p = b.group.position.clone().setY(b.group.position.y + CHAR_H);
    const v = p.project(world3d.camera);
    const on = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.92;
    if (on || !b.live && b.n === 0) { b.arrow.style.display = "none"; continue; }
    // clamp to the screen edge with a margin, pointing toward it
    let x = v.x, y = -v.y;
    if (v.z > 1) { x = -x; y = -y; }
    const m = Math.max(Math.abs(x), Math.abs(y), 1e-3);
    x = x / m * 0.9; y = y / m * 0.9;
    b.arrow.style.display = "";
    b.arrow.style.left = ((x * 0.5 + 0.5) * W) + "px";
    b.arrow.style.top = ((y * 0.5 + 0.5) * H) + "px";
    b.arrow.style.setProperty("--rot", (Math.atan2(y, x) * 180 / Math.PI) + "deg");
  }
  world3d.needsRender = true;
});
