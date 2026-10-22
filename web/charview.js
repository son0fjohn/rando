// A player's full 3D character in a box: soft light with an aqua rim, drag to
// spin (it keeps drifting a little after you let go), pinch or wheel to zoom.
// Used by the profile card and the style screen. Shows the player's pixel
// sprite until 3D is ready, and keeps it if 3D can't run here.
//
//   const v = mountCharView(box, avatar, { zoom: true });
//   v.setAvatar(next)   // swap the outfit in place (style screen)
//   v.dispose()
import { spriteFor, silhouetteFor } from "./charsprite.js";

export function mountCharView(box, avatar, { zoom = false, yaw: yaw0 = 0.35 } = {}) {
  let disposed = false, api = null, pending = avatar;
  const sprite = sh => { if (!disposed && box.isConnected && !box.querySelector("canvas")) { box.querySelector(".cv-spr")?.remove(); box.insertAdjacentHTML("afterbegin", `<div class="cv-spr" style="background-image:url(${sh.url})"></div>`); } };
  sprite(silhouetteFor(avatar));
  spriteFor(avatar).then(sprite);
  const view = {
    setAvatar(a) { pending = a; api?.swap(a); },
    dispose() { disposed = true; api?.dispose(); },
  };
  start().catch(e => console.warn("[charview] 3D preview unavailable", e));
  return view;

  async function start() {
    const THREE = await import("https://esm.sh/three@0.160.0");
    const A = await import("./avatar3.js");
    if (!A.makeHumanCharacter || disposed || !box.isConnected) return;
    let ch = await A.makeHumanCharacter(pending ?? {});
    await ch.ready;
    if (disposed || !box.isConnected) { ch.dispose?.(); return; }
    let shown = pending;
    const w = box.clientWidth, h = box.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a3f7a, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(6, 14, 18); scene.add(key);
    const rim = new THREE.DirectionalLight(0x4de8c8, 1.2); rim.position.set(-10, 8, -12); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, w / h, 1, 200);
    let dist = 34;
    const place = () => { cam.position.set(0, 9 - (34 - dist) * 0.06, dist); cam.lookAt(0, 7.2 + (34 - dist) * 0.05, 0); };
    place();
    scene.add(ch.group);
    box.querySelector(".cv-spr")?.remove();
    box.prepend(renderer.domElement);
    let yaw = yaw0, vel = 0, raf = 0, idle = 0;
    const ptrs = new Map();
    let pinch0 = null;
    box.addEventListener("pointerdown", e => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      box.setPointerCapture?.(e.pointerId);
      if (ptrs.size === 2 && zoom) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), dist }; }
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
    const tick = () => {
      if (disposed || !box.isConnected) { api.dispose(); return; }
      if (!ptrs.size) { vel *= 0.92; yaw += vel; if (++idle > 90) yaw += 0.006; }
      ch.group.rotation.y = yaw;
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    let swapping = null;
    api = {
      async swap(a) {
        if (JSON.stringify(a) === JSON.stringify(shown)) return;
        shown = a;
        const token = swapping = {};
        const next = await A.makeHumanCharacter(a ?? {});
        await next.ready;
        if (disposed || swapping !== token) { next.dispose?.(); return; }
        scene.remove(ch.group); ch.dispose?.();
        ch = next; scene.add(ch.group);
      },
      dispose() { cancelAnimationFrame(raf); ro?.disconnect(); ch.dispose?.(); renderer.dispose(); renderer.forceContextLoss?.(); },
    };
    if (pending !== shown) api.swap(pending);
    tick();
  }
}
