// A player's full 3D character in a box, alive (the animated build: swagger
// idle, blinks, a walk on request): drag to spin (it keeps drifting a little
// after you let go), pinch or wheel to zoom, double-tap to reset. Used by
// the profile card and the style screen. Shows the player's pixel sprite
// until 3D is ready, and keeps it if 3D can't run here.
//
//   const v = mountCharView(box, avatar, { zoom: true, stage: true });
//   v.setAvatar(next)      // swap the outfit in place, with a little reaction
//   v.setWalking(true)     // preview the walk cycle on the spot
//   v.reset()              // back to the starting angle and zoom
//   v.dispose()
// stage: a glowing platform under the feet and a soft spotlight cone (the
// style screen); the box's own CSS paints the backdrop.
import { spriteFor, silhouetteFor } from "./charsprite.js";

export function mountCharView(box, avatar, { zoom = false, yaw: yaw0 = 0.35, stage = false, onSwap = null, onReady = null } = {}) {
  let disposed = false, api = null, pending = avatar, walking = false;
  const sprite = sh => { if (!disposed && box.isConnected && !box.querySelector("canvas")) { box.querySelector(".cv-spr")?.remove(); box.insertAdjacentHTML("afterbegin", `<div class="cv-spr" style="background-image:url(${sh.url})"></div>`); } };
  sprite(silhouetteFor(avatar));
  spriteFor(avatar).then(sprite);
  const view = {
    setAvatar(a) { pending = a; api?.swap(a); },
    setWalking(on) { walking = !!on; },
    reset() { api?.reset(); },
    dispose() { disposed = true; api?.dispose(); },
  };
  start().catch(e => console.warn("[charview] 3D preview unavailable", e));
  return view;

  async function start() {
    const THREE = await import("https://esm.sh/three@0.160.0");
    const A = await import("./avatar3.js");
    if (!A.makeHumanCharacter || disposed || !box.isConnected) return;
    // the living build; the static one if the rig can't load here
    let ch = await (A.makeAnimatedCharacter ?? A.makeHumanCharacter)(pending ?? {})
      .catch(() => A.makeHumanCharacter(pending ?? {}));
    await ch.ready;
    if (disposed || !box.isConnected) { ch.dispose?.(); return; }
    let shown = pending;
    const w = box.clientWidth, h = box.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdce8ff, 0x2a3570, 1.7));
    const key = new THREE.DirectionalLight(0xfff3dc, 1.7); key.position.set(5, 16, 14); scene.add(key);
    const rim = new THREE.DirectionalLight(stage ? 0xffc83d : 0x4de8c8, stage ? 1.0 : 1.2); rim.position.set(-10, 8, -12); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, w / h, 1, 200);
    const DIST0 = 34;
    let dist = DIST0;
    const place = () => { cam.position.set(0, 9 - (DIST0 - dist) * 0.06, dist); cam.lookAt(0, 7.2 + (DIST0 - dist) * 0.05, 0); };
    place();
    scene.add(ch.group);
    const extras = stage ? buildStage(THREE, scene) : null;
    box.querySelector(".cv-spr")?.remove();
    box.prepend(renderer.domElement);
    let yaw = yaw0, vel = 0, raf = 0, idle = 0, lastTap = 0;
    const ptrs = new Map();
    let pinch0 = null;
    box.addEventListener("pointerdown", e => {
      if (e.target.closest("button")) return; // the stage's own controls
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      box.setPointerCapture?.(e.pointerId);
      if (ptrs.size === 2 && zoom) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), dist }; }
      const now = performance.now();
      if (ptrs.size === 1 && now - lastTap < 300) api.reset();
      lastTap = now;
    });
    box.addEventListener("pointermove", e => {
      const prev = ptrs.get(e.pointerId); if (!prev) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size >= 2 && pinch0) {
        const [a, b] = [...ptrs.values()];
        dist = Math.max(16, Math.min(46, pinch0.dist * pinch0.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))));
        place(); idle = 0;
      } else if (ptrs.size === 1) { vel = (e.clientX - prev.x) * 0.012; yaw += vel; idle = 0; }
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    if (zoom) box.addEventListener("wheel", e => { e.preventDefault(); dist = Math.max(16, Math.min(46, dist * (e.deltaY > 0 ? 1.08 : 1 / 1.08))); place(); }, { passive: false });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
      renderer.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix();
    }) : null;
    ro?.observe(box);
    await renderer.compileAsync?.(scene, cam); // no first-frame shader stall
    if (disposed || !box.isConnected) { ch.dispose?.(); renderer.dispose(); return; }
    const t0 = performance.now();
    const tick = () => {
      if (disposed || !box.isConnected) { api.dispose(); return; }
      if (!ptrs.size) { vel *= 0.92; yaw += vel; if (++idle > 90) yaw += 0.004; }
      ch.group.rotation.y = yaw;
      const t = (performance.now() - t0) / 1000;
      ch.walking = walking;
      ch.tick?.(t);
      extras?.tick(t);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    let swapping = null;
    api = {
      async swap(a) {
        if (JSON.stringify(a) === JSON.stringify(shown)) return;
        shown = a;
        const token = swapping = {};
        // same rig, new outfit: rebuild in place (no new skeleton per tap)
        if (ch.setConfig) { ch.setConfig(a ?? {}); await ch.ready; }
        else {
          const next = await A.makeHumanCharacter(a ?? {});
          await next.ready;
          if (disposed || swapping !== token) { next.dispose?.(); return; }
          scene.remove(ch.group); ch.dispose?.();
          ch = next; scene.add(ch.group);
        }
        if (disposed || swapping !== token) return;
        ch.react?.("smile", 1.1);
        extras?.flash();
        onSwap?.();
      },
      reset() { yaw = yaw0; vel = 0; dist = DIST0; place(); },
      dispose() { cancelAnimationFrame(raf); ro?.disconnect(); ch.dispose?.(); extras?.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); },
    };
    if (pending !== shown) api.swap(pending);
    tick();
    onReady?.();
  }
}

// a glowing gold platform with a slow shimmer ring, and a soft spotlight
// cone from above; flash() pulses both when something is equipped
function buildStage(THREE, scene) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.9, 0.5, 48),
    new THREE.MeshBasicMaterial({ color: 0x1a2a5c }));
  disc.position.y = -0.25;
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"), gr = x.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,200,61,0.9)"); gr.addColorStop(0.45, "rgba(255,200,61,0.35)"); gr.addColorStop(1, "rgba(255,200,61,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(13, 13),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.75, 0.09, 8, 72),
    new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.9 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.01;
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uK: { value: 0.1 } },
    // brighter toward the floor, and soft at the cone's edges (facing ratio)
    vertexShader: `varying float vy; varying float vf;
      void main(){ vy = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vf = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK; varying float vy; varying float vf;
      void main(){ float k = uK * (1.0 - vy) * (0.3 + 0.7 * (1.0 - vy)) * pow(vf, 2.2);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.8) * k, 1.0); }`,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 6.2, 26, 40, 1, true), coneMat);
  cone.position.y = 12.5;
  g.add(disc, glow, ring, cone);
  scene.add(g);
  let flashAt = -10;
  return {
    flash() { flashAt = performance.now() / 1000; },
    tick(t) {
      const f = Math.max(0, 1 - (performance.now() / 1000 - flashAt) / 0.6);
      ring.material.opacity = 0.7 + 0.2 * Math.sin(t * 2.2) + 0.3 * f;
      glow.scale.setScalar(1 + 0.04 * Math.sin(t * 1.6) + 0.12 * f);
      coneMat.uniforms.uK.value = 0.1 + 0.12 * f;
    },
    dispose() {
      scene.remove(g);
      g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      glowTex.dispose();
    },
  };
}
