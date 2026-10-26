// What the game hosts' 3D scenes share (Side Quest's Prophet, the Ritual's
// Boss): the look-around camera, tap picking, and the shader bits that put a
// live-lit character into a camera-mapped room. One component, one set of
// settings: a tweak here applies to both games.
//
// Look around: drag on the scene to orbit the camera around the table
// (-24° to the left, 35° to the right, a little up and down, pinch to zoom
// in a bit), with
// easing and a little momentum; ~4 s after the last touch it glides gently
// back to the default view (never while a finger is down). It's never
// locked: players can look around through every line, pick and reveal (the
// games put what has to be read in screen-space overlays). Only drags that
// start on the scene move it: the dialog box and buttons sit above the
// canvas and keep their taps. On phones that report their tilt without
// asking, a very slight parallax (?tilt=0 turns it off).
//
//   const VIEW = viewFrom(PROJ);                        // the picture's camera
//   const orbit = orbitCamera(stage, VIEW, { onTap: (x, y) => ... });
//   stage.onFrame((t, dt) => orbit.update(t, dt));
//   orbit.push(1); orbit.view.yaw; orbit.dispose();
import { THREE } from "./retrolook.js";

const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// how far you may look away from the default view, and how it comes back
export const ORBIT = {
  // -24° … +35°: further left, the Boss's table lamp stands in front of his
  // box (and the Prophet's in front of his ball); everything the camera can
  // reach looks right (test/orbit_shots.mjs)
  yawRange: [-0.42, 0.61],
  pitchRange: [-0.09, 0.2],       // a little lower (never under the table top), a little higher
  zoomRange: [0.72, 1.0],         // pinch: in a bit, never out past the default
  push: 0.84,                     // the push-in on key moments: distance × this
  idleMs: 4000,                   // after the last touch, glide home
};

// the default view from a picture's solved camera (PROJ: pos, pitch, fov,
// aspect): orbit a point `dist` in front of it
export function viewFrom(PROJ, dist = 2.5, o = {}) {
  const [x, y, z] = PROJ.pos;
  return {
    ...ORBIT, ...o,
    target: [x, y - dist * Math.sin(PROJ.pitch), z - dist * Math.cos(PROJ.pitch)],
    dist, yaw: 0, pitch: PROJ.pitch, fov: PROJ.fov, aspect: PROJ.aspect,
  };
}

// first person (Mask Off's round table): the same look-around, from your own
// seat. The camera stays at `eye` and turns in place: a drag moves the world
// with the finger (left: you look right), a pinch narrows the view a little.
//   firstPerson({ eye: [x, y, z], yaw, pitch, fov, yawRange: [-1.4, 1.4] })
export function firstPerson(o) {
  return { ...ORBIT, pitchRange: [-0.18, 0.22], zoomRange: [0.8, 1.0], fov: 60, aspect: 9 / 16, yaw: 0, pitch: 0, ...o, fp: true, target: o.eye, dist: 0 };
}

// the camera: orbit offsets from the default view, eased; `rise(yaw)` lifts
// the camera a little at some angles (to look over something in the way)
export function orbitCamera(st, V, { onTap = null, rise = () => 0 } = {}) {
  const { camera, canvas } = st;
  const T = new THREE.Vector3(...V.target);
  const view = { yaw: 0, pitch: 0, zoom: 1 };              // what's shown (eased toward `want`)
  const want = { yaw: 0, pitch: 0, zoom: 1 };              // where the finger put it
  const vel = { yaw: 0, pitch: 0 };                        // momentum after a flick (rad/s)
  const tilt = { yaw: 0, pitch: 0 };                       // device tilt parallax
  let lastTouch = -1e9, pushGoal = 0, pushNow = 0, homing = false, lastUpd = 0;
  const ptrs = new Map();
  let drag = null, pinch = null;
  const clampView = () => {
    want.yaw = Math.max(V.yawRange[0], Math.min(V.yawRange[1], want.yaw));
    want.pitch = Math.max(V.pitchRange[0], Math.min(V.pitchRange[1], want.pitch));
    want.zoom = Math.max(V.zoomRange[0], Math.min(V.zoomRange[1], want.zoom));
  };
  canvas.style.touchAction = "none";
  canvas.style.pointerEvents = "auto";
  const onDown = e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    homing = false;
    try { canvas.setPointerCapture?.(e.pointerId); } catch {}   // (a pointer the browser no longer knows: still orbit)
    lastTouch = performance.now();
    // (t0: when the finger went down, by the event's own clock: a long frame
    // between down and up mustn't turn a quick tap into a press)
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, lt: performance.now(), moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: want.zoom }; if (drag) drag.moved = 99; }
    vel.yaw = vel.pitch = 0;
  };
  const onMove = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastTouch = performance.now();
    if (ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      want.zoom = pinch.z * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)); clampView();
      return;
    }
    if (!drag) return;
    const now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, now - drag.lt) / 1000;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
    drag.x = e.clientX; drag.y = e.clientY; drag.lt = now;
    if (drag.moved < 6) return;
    const k = 2.2 / Math.max(240, canvas.clientWidth);   // a swipe across the screen ≈ the whole range
    want.yaw -= dx * k; want.pitch += dy * k * 0.6; clampView();
    vel.yaw = vel.yaw * 0.6 + (-dx * k / dt) * 0.4; vel.pitch = vel.pitch * 0.6 + (dy * k * 0.6 / dt) * 0.4;
  };
  const onUp = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    lastTouch = performance.now();
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0 && drag) {
      if (drag.moved < 8 && e.timeStamp - drag.t0 < 450) onTap?.(e.clientX, e.clientY);
      if (performance.now() - drag.lt > 80) vel.yaw = vel.pitch = 0;   // held still before letting go: no flick
      drag = null;
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  // a tiny parallax from the phone's tilt, where the browser gives it
  // without a permission prompt (not iOS); its slow-moving average is "level"
  let tiltBase = null;
  const onTilt = e => {
    if (e.gamma == null || e.beta == null) return;
    if (!tiltBase) tiltBase = { g: e.gamma, b: e.beta };
    tiltBase.g += (e.gamma - tiltBase.g) * 0.02; tiltBase.b += (e.beta - tiltBase.b) * 0.02;
    tilt.yaw = Math.max(-0.05, Math.min(0.05, (e.gamma - tiltBase.g) * 0.003));
    tilt.pitch = Math.max(-0.03, Math.min(0.03, (e.beta - tiltBase.b) * 0.002));
  };
  const tiltOn = !reduce() && typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission !== "function"
    && new URLSearchParams(location.search).get("tilt") !== "0";
  if (tiltOn) addEventListener("deviceorientation", onTilt);

  const camPos = new THREE.Vector3(), deg = Math.PI / 180;
  function update(t, dt) {
    const still = reduce();
    const now = performance.now();
    if (!drag && !pinch && (Math.abs(vel.yaw) > 1e-4 || Math.abs(vel.pitch) > 1e-4)) {
      want.yaw += vel.yaw * dt; want.pitch += vel.pitch * dt; clampView();
      const f = Math.exp(-dt * 4.5); vel.yaw *= f; vel.pitch *= f;
    }
    const idle = ptrs.size === 0 && (homing || now - lastTouch > V.idleMs);
    // (the glide home runs on the clock: a slow phone's long frames don't stretch it)
    const wdt = Math.min(0.5, Math.max(0, (now - (lastUpd || now)) / 1000)); lastUpd = now;
    if (idle) {
      const k = 1 - Math.exp(-wdt * 1.6);
      want.yaw -= want.yaw * k; want.pitch -= want.pitch * k; want.zoom += (1 - want.zoom) * k;
      vel.yaw = vel.pitch = 0;
    }
    const ke = still ? 1 : 1 - Math.exp(-Math.max(dt, wdt) * 10);
    view.yaw += (want.yaw - view.yaw) * ke; view.pitch += (want.pitch - view.pitch) * ke; view.zoom += (want.zoom - view.zoom) * ke;
    pushNow += (pushGoal - pushNow) * (1 - Math.exp(-dt * 1.1));
    const yaw = V.yaw + view.yaw + tilt.yaw, pitch = V.pitch + view.pitch + tilt.pitch + rise(view.yaw);
    if (V.fp) {
      // from the seat: yaw + looks right, pitch + looks up; zoom narrows the view
      camera.position.copy(T);
      if (!still) { camera.position.x += Math.sin(t * 0.31) * 0.004; camera.position.y += Math.sin(t * 0.43 + 1) * 0.003; }
      camPos.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).add(camera.position);
      camera.lookAt(camPos);
      const a = camera.aspect || V.aspect;
      const base = a < V.aspect ? 2 * Math.atan(Math.tan(V.fov * deg / 2) * V.aspect / a) / deg : V.fov;
      const fov = base * view.zoom;
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      return;
    }
    const d = V.dist * view.zoom * (1 - pushNow * (1 - V.push));
    camPos.set(T.x + d * Math.sin(yaw) * Math.cos(pitch), T.y + d * Math.sin(pitch), T.z + d * Math.cos(yaw) * Math.cos(pitch));
    if (!still) { camPos.x += Math.sin(t * 0.31) * 0.005; camPos.y += Math.sin(t * 0.43 + 1) * 0.003; }
    camera.position.copy(camPos); camera.lookAt(T);
    // the same width in view on any screen as at 9:16
    const a = camera.aspect || V.aspect;
    const fov = a < V.aspect ? 2 * Math.atan(Math.tan(V.fov * deg / 2) * V.aspect / a) / deg : V.fov;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  return {
    view, want, T, update,
    push: (k = 1) => { pushGoal = Math.max(0, Math.min(1, k)); },
    // glide back to the default view now (as it does ~4 s after a touch); a new touch takes over
    home: () => { homing = true; vel.yaw = vel.pitch = 0; },
    dispose: () => {
      if (tiltOn) removeEventListener("deviceorientation", onTilt);
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
    },
  };
}

// what a tap at (cx, cy) hit: the nearest of [{ kind, objs }]
export function pickTap(st, targets, cx, cy) {
  const r = st.canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), st.camera);
  let best = null;
  for (const t of targets) {
    // (what's hidden can't be tapped: a slid-off drape, a prop put away)
    const hit = ray.intersectObjects(t.objs, true).find(h => { for (let o = h.object; o; o = o.parent) if (!o.visible) return false; return true; });
    if (hit && (!best || hit.distance < best.d)) best = { kind: t.kind, d: hit.distance, point: hit.point };
  }
  return best;
}

// he keeps half an eye on you: head and neck turn a little toward the camera
// (targets are euler vectors per bone)
export function headFollow(target, view) {
  target.head.y += Math.max(-0.4, Math.min(0.4, view.yaw * 0.45)); target.neck.y += Math.max(-0.2, Math.min(0.2, view.yaw * 0.2));
  target.head.x -= view.pitch * 0.4;
}

// ---- shaders for a live-lit character on an encoded stage (retrolook
// `encoded: true`): every lit material writes display-ready colour itself
export const encode = sh => {
  sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  gl_FragColor.rgb = sRGBTransferOETF(gl_FragColor).rgb;");
};
// ...and under a table top he's in its shadow (no shadow maps: the table's
// footprint and height are known). T: { x, z, w, d, y }, its top; `strength`
// is in linear light (0.87 is about 0.4 once on screen)
export const underTable = (T, strength = 0.87) => sh => {
  const THX = T.w / 2, THZ = T.d / 2;
  sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldU;")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvWorldU = (modelMatrix * vec4(transformed, 1.0)).xyz;");
  sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWorldU;")
    .replace("#include <dithering_fragment>", `
    float inX = 1.0 - smoothstep(${(THX - 0.1).toFixed(2)}, ${(THX + 0.08).toFixed(2)}, abs(vWorldU.x - ${T.x.toFixed(3)}));
    float inZ = 1.0 - smoothstep(${(THZ - 0.06).toFixed(2)}, ${(THZ + 0.1).toFixed(2)}, abs(vWorldU.z - (${T.z.toFixed(3)})));
    float below = 1.0 - smoothstep(${(T.y - 0.12).toFixed(3)}, ${(T.y - 0.03).toFixed(3)}, vWorldU.y);
    gl_FragColor.rgb *= 1.0 - ${strength.toFixed(3)} * inX * inZ * below;
    #include <dithering_fragment>
    gl_FragColor.rgb = sRGBTransferOETF(gl_FragColor).rgb;`);
};

// a soft round sprite texture (smoke, glows, halos)
export function softDot(stops = [[0, "rgba(255,255,255,.9)"], [0.4, "rgba(220,200,255,.35)"], [1, "rgba(200,180,255,0)"]]) {
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 6, 32, 32, 32);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// a thin wisp of smoke rising from `from` (an Object3D): sprites that rise,
// drift, widen and fade, looping. update(t, dt, puff) — puff (0..1) thickens it
export function smokeWisp(scene, map, { n = 16, color = 0xe8e8ec, rise = 0.5, speed = 0.22, base = 0.045, thick = 0.12, encodeIt = true } = {}) {
  const puffs = [], bp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    if (encodeIt) sp.material.onBeforeCompile = encode;
    sp.userData = { t: i / n, x: 0 }; sp.renderOrder = 5; scene.add(sp); puffs.push(sp);
  }
  return {
    puffs,
    update(from, t, dt, puff = 0, on = 1) {
      const still = reduce();
      from.getWorldPosition(bp);
      for (const sp of puffs) {
        const u = sp.userData;
        u.t += dt * (still ? 0 : speed);
        if (u.t >= 1) { u.t -= 1; u.x = (Math.random() - 0.5) * 0.02; }
        const a = u.t;
        sp.position.set(bp.x + u.x + Math.sin(a * 6 + t * 0.8) * 0.035 * a, bp.y + 0.02 + a * rise, bp.z - a * 0.06);
        sp.scale.set(0.022 + a * 0.06, 0.05 + a * 0.12, 1);
        sp.material.opacity = on * (base + puff * thick) * Math.sin(Math.PI * Math.min(1, a * 1.1)) * (1 - a * 0.5);
      }
    },
  };
}

// where an object is on screen (CSS px): its posed (skinned) vertices
// projected, or a box's corners; and how far it is from the camera (tests:
// what the chosen player covers)
const _bv = new THREE.Vector3(), _bc = new THREE.Vector3();
export function screenBox(st, obj) {
  const { camera, canvas } = st;
  const r = canvas.getBoundingClientRect();
  let l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity, n = 0;
  _bc.set(0, 0, 0);
  const at = v => {
    _bc.add(v); n++;
    v.project(camera);
    const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
    l = Math.min(l, x); rr = Math.max(rr, x); t = Math.min(t, y); b = Math.max(b, y);
  };
  if (obj.isBox3) { for (let i = 0; i < 8; i++) at(_bv.set(i & 1 ? obj.max.x : obj.min.x, i & 2 ? obj.max.y : obj.min.y, i & 4 ? obj.max.z : obj.min.z)); }
  else {
    obj.updateMatrixWorld(true);
    obj.traverseVisible(o => {
      const pos = o.isMesh && o.geometry?.attributes.position;
      if (!pos || o.isSprite) return;
      for (let i = 0; i < pos.count; i += 3) { o.getVertexPosition(i, _bv); at(_bv.applyMatrix4(o.matrixWorld)); }
    });
  }
  if (!n) return null;
  return { left: l, top: t, right: rr, bottom: b, depth: _bc.divideScalar(n).distanceTo(camera.position) };
}

// ---- the chosen player, in the room: their own 3D character (avatar4.js),
// sitting or standing where the room puts them, under a soft light, lit live
// like the host. Idle, they look between the host and the camera now and
// then. They pop in (a quick overshoot and a puff), react, stay for the turn
// and pop out the same way. Only ever one: a new pick waits until the last
// one is gone (a still-loading pick is dropped when another comes).
//   const g = guestSpot(stage, { at: [x, 0, z], face: 0.2, stance: "sit", seat: 0.1, look: [x, y, z], light: { color, angle, intensity }, cone: true });
//   g.show(key, avatar, { pop: true }); g.react("surprised"); g.cheer(); g.hide(); g.update(t, dt) each frame
// No 3D characters on this page (the test stubs): show() does nothing.
const CHAR_UNITS = 15;          // avatar4's height in its own units
export function guestSpot(st, { at = [0.5, 0, 0], face = 0, height = 1.2, stance = "stand", seat = 0, look = null, light = {}, cone = false } = {}) {
  const { scene, camera } = st;
  const L = { color: 0xffd8a0, intensity: 6, angle: 0.42, penumbra: 0.55, ...light };
  const root = new THREE.Group(); root.position.set(...at); root.rotation.y = face; root.visible = false; scene.add(root);
  const body = new THREE.Group(); body.position.y = seat; root.add(body);
  const spot = new THREE.SpotLight(L.color, 0, 4.5, L.angle, L.penumbra, 1.1);
  spot.position.set(at[0] + 0.15, 2.6, at[2] + 0.45); spot.target = root; scene.add(spot);
  // the pool of light on the floor, and (cone: true) the beam itself
  const dot = softDot([[0, "rgba(255,255,255,.95)"], [0.45, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]);
  const add = { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false };
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ map: dot, color: L.color, ...add }));
  pool.material.onBeforeCompile = encode; pool.rotation.x = -Math.PI / 2; pool.position.y = 0.006; pool.renderOrder = 2; root.add(pool);
  let beam = null;
  if (cone) {
    const g = new THREE.CylinderGeometry(0.04, 0.42, 2.6, 24, 1, true); g.translate(0, 1.3, 0);
    beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: L.color, side: THREE.DoubleSide, ...add }));
    beam.material.onBeforeCompile = encode; beam.renderOrder = 7; root.add(beam);
  }
  // the pop's puff (in and out), round the middle of them
  const puffs = [];
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    sp.material.onBeforeCompile = encode; sp.renderOrder = 6; root.add(sp); puffs.push(sp);
  }
  let ch = null, key = null, next = null, loading = null, want = false, wantKey = null, popAt = -1e9, outAt = -1e9, on = 0, tok = 0, wrapT = 0;
  // where they look: the host now and then, the camera the rest (head yaw, eased in avatar4)
  let gazeAt = 0, gazeHost = false;
  const hostAt = look ? new THREE.Vector3(...look) : null, headAt = new THREE.Vector3(), lookV = new THREE.Vector3();
  const yawTo = p => {
    root.updateMatrixWorld(); headAt.set(0, seat + height * (stance === "sit" ? 0.5 : 0.85), 0); root.localToWorld(headAt);
    lookV.copy(p).sub(headAt);
    let a = Math.atan2(lookV.x, lookV.z) - root.rotation.y;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.max(-1.0, Math.min(1.0, a));
  };
  // the character's own shaders, made to write display-ready colour like
  // everything else on this stage (its emote marks are added later: rechecked)
  const wrap = () => body.traverse(o => {
    const m = o.material;
    if (!m || m.userData?.npcEnc) return;
    const prev = m.onBeforeCompile, pk = m.customProgramCacheKey?.bind(m);
    m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r); encode(sh); };
    m.customProgramCacheKey = () => (pk ? pk() : "") + "|npc-enc";
    m.userData.npcEnc = true; m.needsUpdate = true;
  });
  async function show(k, avatar, { pop = true, react = null } = {}) {
    // someone else is on: they pop out (the puff) while this one loads
    if (ch && key !== k && key === wantKey && on > 0.5) outAt = performance.now();
    want = true; wantKey = k;
    if (k === key && ch) {
      // back to the one already here: drop anyone still on their way in
      if (next) { next.c.dispose?.(); next = null; }
      if (loading) { tok++; loading = null; }
      if (pop) popAt = performance.now(); if (react) api.react(react); return true;
    }
    if (next?.key === k) { next.pop ||= pop; next.react ??= react; return true; }
    if (loading?.key === k) { loading.pop ||= pop; loading.react ??= react; return true; }   // already on its way
    const my = ++tok, ask = loading = { key: k, pop, react };
    let c = null;
    try {
      const A = await import("./avatar4.js");
      if (my !== tok) return false;
      c = await A.makeCharacter4(avatar ?? {});
      await Promise.race([c.ready ?? Promise.resolve(), new Promise(r => setTimeout(r, 12000))]);
    } catch (e) {
      // (no character this time: a later show() tries again)
      c?.dispose?.(); if (my === tok) loading = null;
      console.warn("[npcstage] the chosen player didn't load:", e?.message ?? e);
      return false;
    }
    if (my !== tok) { c.dispose?.(); return false; }   // (a newer pick or a hide took over)
    loading = null;
    c.group.scale.setScalar(height / CHAR_UNITS);
    c.unit = height / CHAR_UNITS; c.stance = stance;
    // it goes in on the next frame, once the last one is gone
    if (next) next.c.dispose?.();
    next = { c, key: k, pop: ask.pop, react: ask.react };
    return true;
  }
  const api = {
    root, spot, show, light: L,
    get shown() { return want && !!ch && key === wantKey; },
    // characters in the scene right now (never more than one), and whose (tests)
    count: () => body.children.length,
    get key() { return ch && on > 0 ? key : null; },
    // on screen (tests), and moving them (dev)
    rect: () => ch && root.visible ? screenBox(st, body) : null,
    place(x, z, f = root.rotation.y, y = seat) { root.position.x = x; root.position.z = z; root.rotation.y = f; seat = y; body.position.y = y; spot.position.set(x + 0.15, 2.6, z + 0.45); },
    hide() {
      if (want && ch && on > 0.5) outAt = performance.now();
      want = false; wantKey = null; tok++; loading = null;
      if (next) { next.c.dispose?.(); next = null; }
    },
    react(kind = "surprised") {
      if (!ch) return;
      gazeHost = false; gazeAt = performance.now() + 2500;
      if (kind === "surprised") { ch.react?.("surprised", 1.8); ch.emote?.("exclaim", 1.5); }
      else ch.react?.(kind, 1.4);
    },
    // "let's go": a happy hop, sparkles
    cheer() { if (!ch) return; ch.react?.("happy", 1.6); ch.emote?.("sparkles", 1.4); },
    update(t, dt) {
      const still = reduce(), now = performance.now();
      // the swap: the next one goes in only once the last one has popped out
      // (and only if they're still the one wanted)
      if (next && next.key !== wantKey) { next.c.dispose?.(); next = null; }
      if (next && (!ch || on < 0.02)) {
        if (ch) { body.remove(ch.group); ch.dispose?.(); }
        ({ c: ch, key } = next);
        body.add(ch.group); wrap();
        if (next.pop) popAt = now;
        const r = next.react; next = null;
        if (r) api.react(r);
      }
      const vis = want && ch && key === wantKey ? 1 : 0;
      on += (vis - on) * Math.min(1, dt * (vis ? 10 : 7));
      if (!vis && on < 0.01) on = 0;
      root.visible = on > 0;
      // popped out and nobody coming: gone from the scene, not just hidden
      if (!on && ch && !want && !next) { body.remove(ch.group); ch.dispose?.(); ch = null; key = null; }
      if (!root.visible) return;
      if (ch) {
        // now and then a look at the host, then back to the camera
        if (now > gazeAt) { gazeHost = !gazeHost && !!hostAt; gazeAt = now + (gazeHost ? 1800 + Math.random() * 1200 : 2600 + Math.random() * 2600); }
        ch.gaze = still ? 0 : yawTo(gazeHost ? hostAt : camera.position) * (gazeHost ? 1 : 0.8);
        ch.tick?.(t);
        if ((wrapT += dt) > 0.5) { wrapT = 0; wrap(); }
      }
      // the pop: in from nothing, a little overshoot, settle; out: shrink away
      // (wall-clock: in step with the game on a slow phone too)
      const popT = (now - popAt) / 1000;
      const k = Math.min(1, popT / 0.45);
      const s = still ? 1 : k < 1 ? Math.max(0.001, 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)) : 1;
      body.scale.setScalar(s * on);
      const puffT = Math.min(popT, (now - outAt) / 1000);
      for (const [i, sp] of puffs.entries()) {
        const a = (i / puffs.length) * Math.PI * 2, r = 0.08 + puffT * 0.9;
        sp.position.set(Math.cos(a) * r, seat + 0.1 + puffT * 0.5 + (i % 3) * 0.06, Math.sin(a) * r * 0.6);
        sp.scale.setScalar(0.12 + puffT * 0.35);
        sp.material.opacity = still ? 0 : Math.max(0, 0.55 * (1 - puffT / 0.7));
      }
      spot.intensity = L.intensity * on;
      pool.material.opacity = 0.42 * on;
      if (beam) beam.material.opacity = 0.05 * on;
    },
    dispose() { tok++; if (ch) ch.dispose?.(); if (next) next.c.dispose?.(); scene.remove(root, spot); dot.dispose(); },
  };
  return api;
}
