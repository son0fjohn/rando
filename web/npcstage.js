// What the game hosts' 3D scenes share (Side Quest's Prophet, the Ritual's
// Boss): the look-around camera, tap picking, and the shader bits that put a
// live-lit character into a camera-mapped room. One component, one set of
// settings: a tweak here applies to both games.
//
// Look around: drag on the scene to orbit the camera around the table
// (about ±60° each way, a little up and down, pinch to zoom in a bit), with
// easing and a little momentum; ~3 s after the last touch it glides back to
// the default view. hold(true) glides it home and keeps it there (the games
// do that for their pick and reveal). On phones that report their tilt
// without asking, a very slight parallax (?tilt=0 turns it off).
//
//   const VIEW = viewFrom(PROJ);                        // the picture's camera
//   const orbit = orbitCamera(stage, VIEW, { onTap: (x, y) => ... });
//   stage.onFrame((t, dt) => orbit.update(t, dt));
//   orbit.hold(true); orbit.push(1); orbit.view.yaw; orbit.dispose();
import { THREE } from "./retrolook.js";

const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// how far you may look away from the default view, and how it comes back
export const ORBIT = {
  yawRange: [-1.05, 1.05],        // ±60°
  pitchRange: [-0.09, 0.2],       // a little lower (never under the table top), a little higher
  zoomRange: [0.72, 1.0],         // pinch: in a bit, never out past the default
  push: 0.84,                     // the push-in on key moments: distance × this
  idleMs: 3000,                   // after the last touch, glide home
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

// the camera: orbit offsets from the default view, eased; `rise(yaw)` lifts
// the camera a little at some angles (to look over something in the way)
export function orbitCamera(st, V, { onTap = null, rise = () => 0 } = {}) {
  const { camera, canvas } = st;
  const T = new THREE.Vector3(...V.target);
  const view = { yaw: 0, pitch: 0, zoom: 1 };              // what's shown (eased toward `want`)
  const want = { yaw: 0, pitch: 0, zoom: 1 };              // where the finger put it
  const vel = { yaw: 0, pitch: 0 };                        // momentum after a flick (rad/s)
  const tilt = { yaw: 0, pitch: 0 };                       // device tilt parallax
  let held = false, lastTouch = -1e9, pushGoal = 0, pushNow = 0;
  const ptrs = new Map();
  let drag = null, pinch = null;
  const clampView = () => {
    want.yaw = Math.max(V.yawRange[0], Math.min(V.yawRange[1], want.yaw));
    want.pitch = Math.max(V.pitchRange[0], Math.min(V.pitchRange[1], want.pitch));
    want.zoom = Math.max(V.zoomRange[0], Math.min(V.zoomRange[1], want.zoom));
  };
  const free = () => !held;
  canvas.style.touchAction = "none";
  canvas.style.pointerEvents = "auto";
  const onDown = e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture?.(e.pointerId);
    lastTouch = performance.now();
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), lt: performance.now(), moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: want.zoom }; if (drag) drag.moved = 99; }
    vel.yaw = vel.pitch = 0;
  };
  const onMove = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastTouch = performance.now();
    if (ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      if (free()) { want.zoom = pinch.z * pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)); clampView(); }
      return;
    }
    if (!drag) return;
    const now = performance.now(), dx = e.clientX - drag.x, dy = e.clientY - drag.y, dt = Math.max(1, now - drag.lt) / 1000;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0));
    drag.x = e.clientX; drag.y = e.clientY; drag.lt = now;
    if (!free() || drag.moved < 6) return;
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
      if (drag.moved < 8 && performance.now() - drag.t0 < 450) onTap?.(e.clientX, e.clientY);
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
    const idle = ptrs.size === 0 && now - lastTouch > V.idleMs;
    if (held || idle) {
      const k = 1 - Math.exp(-dt * (held ? 3 : 1.8));
      want.yaw -= want.yaw * k; want.pitch -= want.pitch * k; want.zoom += (1 - want.zoom) * k;
      vel.yaw = vel.pitch = 0;
    }
    const ke = still ? 1 : 1 - Math.exp(-dt * 10);
    view.yaw += (want.yaw - view.yaw) * ke; view.pitch += (want.pitch - view.pitch) * ke; view.zoom += (want.zoom - view.zoom) * ke;
    pushNow += (pushGoal - pushNow) * (1 - Math.exp(-dt * 1.1));
    const yaw = V.yaw + view.yaw + tilt.yaw, pitch = V.pitch + view.pitch + tilt.pitch + rise(view.yaw);
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
    // glide back to the default view and stay there (the key moments)
    hold: (on = true) => { held = !!on; },
    push: (k = 1) => { pushGoal = Math.max(0, Math.min(1, k)); },
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
    const hit = ray.intersectObjects(t.objs, true)[0];
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
