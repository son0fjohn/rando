// Players' own 3D characters as still pictures for the game scenes (Side
// Quest's crystal ball, the Ritual's capsules, a performer on stage): the
// real avatar (avatar3.js, the cel shader every character uses), posed with
// a smile and rendered with a light that matches the scene's painted one:
// a warm key from the upper left and the front, a soft fill, a coloured rim.
// The scenes are painted / pre-rendered like the Art Gallery's, so the
// players are pre-rendered the same way and drop into them as cutouts.
//
//   renderLook(avatar, { frame: "head" | "full", rim })  -> Promise<url>
//
// One offscreen renderer, one render at a time, cached per look + frame
// (memory, and sessionStorage across reloads). Never rejects: if 3D can't
// run here the picture is a plain silhouette in the player's own skin and
// hair colours (a shape, never a pixel sprite).
const VERSION = 1;
const SIZE = { head: [256, 256], full: [360, 540] };
const mem = new Map();
let R = null, chain = Promise.resolve();

const lookKey = (a, frame, rim) => `v${VERSION}:${frame}:${rim}:` + ["skin", "hair", "hairColor", "face", "iris", "top", "bottom", "shoes", "head", "facewear", "neck"].map(k => a?.[k] ?? "").join("|");

// one light for every scene, so one render serves them all
const RIM = 0xffc83d;
export function renderLook(avatar, { frame = "head", rim = RIM } = {}) {
  const key = lookKey(avatar ?? {}, frame, rim);
  if (!mem.has(key)) {
    let cached = null;
    try { cached = sessionStorage.getItem("rando-look:" + key); } catch {}
    const job = cached ? Promise.resolve(cached) : (chain = chain.then(() => render(avatar ?? {}, frame, rim)).catch(e => {
      console.warn("[charrender] 3D render failed, using a silhouette", e?.message ?? e);
      return silhouette(avatar ?? {}, frame);
    })).then(url => {
      try { if (url && !url.startsWith("data:image/svg")) sessionStorage.setItem("rando-look:" + key, url); } catch {}
      return url;
    });
    mem.set(key, job);
  }
  return mem.get(key);
}
// render looks ahead of time (the party lobby does, for everyone in it), so
// the game scenes never wait on one: one at a time, in idle moments, since
// the first render loads three.js and the models and each one blocks a frame
let warming = Promise.resolve();
const queued = new Set();
const idle = () => new Promise(r => (globalThis.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 200)));
export function warmLooks(avatars, frames = ["head", "full"]) {
  for (const frame of frames) for (const a of avatars) {
    const k = lookKey(a ?? {}, frame, RIM);
    if (mem.has(k) || queued.has(k)) continue;
    queued.add(k);
    warming = warming.then(idle).then(() => renderLook(a, { frame }));
  }
  return warming;
}

async function rig() {
  if (R) return R;
  const THREE = await import("https://esm.sh/three@0.160.0");
  const A = await import("./avatar3.js");
  if (!A.makeHumanCharacter) throw new Error("no avatar renderer here");
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // the scenes' painted light: warm key from the upper left and the front,
  // a cool soft fill from below, a rim from behind in the scene's colour
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3a3050, 1.5));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.0); key.position.set(-8, 14, 16); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc83d, 1.1); rim.position.set(10, 8, -12); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(24, 1, 1, 200);
  R = { THREE, A, renderer, scene, cam, rim };
  return R;
}

async function render(avatar, frame, rimHex) {
  const { THREE, A, renderer, scene, cam, rim } = await rig();
  const ch = await A.makeHumanCharacter(A.normalizeAvatar3(avatar));
  await Promise.race([ch.ready ?? Promise.resolve(), new Promise(r => setTimeout(r, 15000))]);
  ch.setExpression?.("smile");
  const [w, h] = SIZE[frame] ?? SIZE.head;
  renderer.setSize(w, h, false);
  rim.color.setHex(rimHex);
  ch.group.rotation.y = frame === "head" ? 0.22 : 0.3;
  scene.add(ch.group);
  ch.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(ch.group), size = box.getSize(new THREE.Vector3());
  const H = size.y, top = box.max.y;
  if (frame === "head") {
    // the big chibi head: about the top third
    const cy = top - H * 0.19, r = H * 0.22;
    cam.fov = 24; cam.aspect = w / h; cam.updateProjectionMatrix();
    const d = r / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.08;
    cam.position.set(0, cy + r * 0.05, d); cam.lookAt(0, cy, 0);
  } else {
    const cy = box.min.y + H * 0.5;
    cam.fov = 24; cam.aspect = w / h; cam.updateProjectionMatrix();
    const d = (H * 0.55) / Math.tan((cam.fov * Math.PI / 180) / 2);
    cam.position.set(0, cy + H * 0.04, d); cam.lookAt(0, cy, 0);
  }
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  scene.remove(ch.group);
  ch.dispose?.();
  return url;
}

// no 3D here: a soft rounded silhouette in the player's colours
function silhouette(a, frame) {
  const skin = { 1: "#eec49c", 2: "#cdaa93", 3: "#c0875b", 4: "#9b6341", 5: "#593c2c" }[String(a.skin ?? "").replace(/\D/g, "")] ?? "#d9b090";
  const hair = { black: "#353439", brown: "#735246", yellow: "#e1b97a", red: "#ce373a", white: "#e1d2c8", pink: "#e98fb5", blue: "#4a6fd0" }[a.hairColor] ?? "#3a3036";
  const [w, h] = SIZE[frame] ?? SIZE.head;
  const head = frame === "head"
    ? `<circle cx="${w / 2}" cy="${h * 0.54}" r="${w * 0.38}" fill="${skin}"/><path d="M${w * 0.12} ${h * 0.5} a${w * 0.38} ${w * 0.4} 0 0 1 ${w * 0.76} 0 q-${w * 0.38} -${h * 0.12} -${w * 0.76} 0z" fill="${hair}"/>`
    : `<circle cx="${w / 2}" cy="${h * 0.24}" r="${w * 0.24}" fill="${skin}"/><path d="M${w * 0.26} ${h * 0.22} a${w * 0.24} ${w * 0.25} 0 0 1 ${w * 0.48} 0 q-${w * 0.24} -${h * 0.08} -${w * 0.48} 0z" fill="${hair}"/><rect x="${w * 0.3}" y="${h * 0.44}" width="${w * 0.4}" height="${h * 0.38}" rx="${w * 0.12}" fill="#5b5f72"/><rect x="${w * 0.33}" y="${h * 0.8}" width="${w * 0.34}" height="${h * 0.14}" rx="${w * 0.05}" fill="#2c2f3a"/>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${head}</svg>`)}`;
}
