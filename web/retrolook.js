// The retro look: one kit every game scene's 3D layer is drawn with, so they
// share the world map's DNA (low-poly, nostalgic, early-2000s console) and
// each still gets its own mood from a config.
//
//   const st = await retroStage(hostEl, MOOD);   // a canvas filling hostEl
//   st.scene.add(...); st.onFrame((t, dt) => ...); st.dispose();
//
// What it does, all of it tunable per scene (see the MOOD shape below):
// - lighting: a warm key, a cool coloured fill/rim, a low ambient tinted to
//   the mood. Nothing neutral white.
// - fog in the scene's colour, so the back of the room melts away.
// - glow: a cheap bloom that only catches what's bright (emissive things:
//   candles, the crystal ball, lamps, stars), not the lit surfaces.
// - the render: the 3D scene is drawn at a low internal resolution and
//   upscaled crisply (nearest), then graded (warm, a limited palette with a
//   little ordered dithering), vignetted and given a faint grain. Only the 3D
//   layer: the game's UI is DOM on top and stays sharp.
// - helpers for the low-poly look: flat (faceted) materials, soft ambient
//   occlusion baked into vertex colours, blob shadows, small nearest-filtered
//   textures, drifting dust motes, flickering lights, a breathing camera.
// - performance: a weak phone (or ?retro=low) gets a lower resolution and no
//   bloom, and if frames run slow anyway it steps down by itself.
import * as THREE from "https://esm.sh/three@0.160.0";

const params = new URLSearchParams(globalThis.location?.search ?? "");
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export { THREE };

// a mood: everything a scene can set (defaults are a neutral night)
export const DEFAULT_MOOD = {
  scale: 0.5, maxW: 400,                          // internal resolution: a fraction of CSS px (the map's 0.5), capped
  bg: 0x0c0a1a,
  fog: { color: 0x1a1430, near: 4, far: 12 },
  ambient: { sky: 0x3a3060, ground: 0x140c18, intensity: 0.55 },
  key: { color: 0xffb066, intensity: 1.6, pos: [-2.5, 3.5, 3] },
  fill: { color: 0x6a4cff, intensity: 0.9, pos: [3, 2, -2] },
  bloom: { threshold: 0.72, strength: 0.9 },
  grade: { tint: [1.06, 0.98, 0.9], sat: 0.92, contrast: 1.06, lift: 0.025 },
  levels: 28, dither: 1, vignette: 0.42, grain: 0.035,
};

// low on weak phones: fewer cores / little memory, or asked for
export function retroTier() {
  const q = params.get("retro");
  if (q === "low" || q === "high") return q;
  const mem = navigator.deviceMemory ?? 4, cores = navigator.hardwareConcurrency ?? 4;
  return mem <= 3 || cores <= 4 ? "low" : "high";
}

const FS_QUAD = new THREE.BufferGeometry();
FS_QUAD.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
FS_QUAD.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

// bright pass: only what's near white survives (lit surfaces stay below it)
const BRIGHT = `uniform sampler2D tex; uniform float threshold; varying vec2 vUv;
void main(){ vec3 c = texture2D(tex, vUv).rgb; float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.2, l), 1.0); }`;
// 9-tap gaussian, one direction per pass
const BLUR = `uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
void main(){ vec3 s = texture2D(tex, vUv).rgb * 0.227;
  s += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * 0.316;
  s += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(s, 1.0); }`;
// the final look: bloom in, grade, vignette, grain, a limited palette with
// ordered (Bayer) dithering, then to sRGB
const FINAL = `uniform sampler2D tex; uniform sampler2D bloom; uniform float bloomOn, strength;
uniform vec3 tint; uniform float sat, contrast, lift, levels, dither, vignette, grain, time; uniform vec2 res;
varying vec2 vUv;
float bayer(vec2 p){ vec2 q = mod(floor(p), 4.0);
  float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  int i = int(q.y * 4.0 + q.x); float v = 0.;
  for (int k = 0; k < 16; k++) if (k == i) v = m[k];
  return v / 16.0 - 0.5; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture2D(tex, vUv).rgb;
  if (bloomOn > 0.5) c += texture2D(bloom, vUv).rgb * strength;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));                       // linear -> display
  c *= tint;
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, sat);
  c = (c - 0.5) * contrast + 0.5 + lift;
  vec2 d = vUv - 0.5; c *= 1.0 - vignette * dot(d, d) * 2.2;
  c += (hash(vUv * res + time) - 0.5) * grain;
  c = floor(c * levels + 0.5 + bayer(vUv * res) * dither) / levels;  // the limited palette
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`;

export async function retroStage(host, mood = {}) {
  const M = { ...DEFAULT_MOOD, ...mood, fog: { ...DEFAULT_MOOD.fog, ...mood.fog }, ambient: { ...DEFAULT_MOOD.ambient, ...mood.ambient },
    key: { ...DEFAULT_MOOD.key, ...mood.key }, fill: { ...DEFAULT_MOOD.fill, ...mood.fill }, grade: { ...DEFAULT_MOOD.grade, ...mood.grade },
    bloom: mood.bloom === false ? false : { ...DEFAULT_MOOD.bloom, ...mood.bloom } };
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no WebGL");
  let tier = retroTier();
  // never below ~0.36: under that a face in the scene turns to mush
  const FLOOR = 0.36;
  let scale = Math.max(FLOOR, tier === "low" ? M.scale * 0.8 : M.scale), bloomOn = tier !== "low" && !!M.bloom;

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;     // the final pass converts itself
  const canvas = renderer.domElement;
  canvas.className = "retro-canvas";
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", imageRendering: "pixelated", display: "block" });
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(M.bg);
  scene.fog = new THREE.Fog(M.fog.color, M.fog.near, M.fog.far);
  const camera = new THREE.PerspectiveCamera(32, 9 / 16, 0.1, 60);
  // the mood's light rig
  const hemi = new THREE.HemisphereLight(M.ambient.sky, M.ambient.ground, M.ambient.intensity);
  const key = new THREE.DirectionalLight(M.key.color, M.key.intensity); key.position.set(...M.key.pos);
  const fill = new THREE.DirectionalLight(M.fill.color, M.fill.intensity); fill.position.set(...M.fill.pos);
  scene.add(hemi, key, fill);

  const rtOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true };
  const rtScene = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const rtA = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const rtB = rtA.clone();
  const post = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(FS_QUAD); quad.frustumCulled = false; post.add(quad);
  const mat = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
  const brightM = mat(BRIGHT, { tex: { value: null }, threshold: { value: M.bloom ? M.bloom.threshold : 1 } });
  const blurM = mat(BLUR, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
  const finalM = mat(FINAL, {
    tex: { value: rtScene.texture }, bloom: { value: rtA.texture }, bloomOn: { value: 0 }, strength: { value: M.bloom ? M.bloom.strength : 0 },
    tint: { value: new THREE.Vector3(...M.grade.tint) }, sat: { value: M.grade.sat }, contrast: { value: M.grade.contrast }, lift: { value: M.grade.lift },
    levels: { value: M.levels }, dither: { value: M.dither }, vignette: { value: M.vignette }, grain: { value: tier === "low" ? 0 : M.grain },
    time: { value: 0 }, res: { value: new THREE.Vector2(4, 4) },
  });
  const pass = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(post, postCam); };

  let W = 4, H = 4;
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const w = Math.max(64, Math.round(Math.min(r.width * scale, M.maxW)));
    const h = Math.max(64, Math.round(w * r.height / r.width));
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    if (w === W && h === H) return;          // setting a canvas's size clears it: only on a real change
    W = w; H = h;
    renderer.setSize(W, H, false);
    rtScene.setSize(W, H);
    rtA.setSize(W >> 1, H >> 1); rtB.setSize(W >> 1, H >> 1);
    finalM.uniforms.res.value.set(W, H);
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  resize();

  const frameFns = new Set();
  let raf = 0, last = performance.now(), t0 = last, slow = 0, frames = 0, alive = true, paused = false;
  function draw(now) {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    for (const fn of frameFns) fn(t, dt);
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    if (bloomOn) {
      brightM.uniforms.tex.value = rtScene.texture; pass(brightM, rtA);
      blurM.uniforms.tex.value = rtA.texture; blurM.uniforms.dir.value.set(1 / (W >> 1), 0); pass(blurM, rtB);
      blurM.uniforms.tex.value = rtB.texture; blurM.uniforms.dir.value.set(0, 1 / (H >> 1)); pass(blurM, rtA);
    }
    finalM.uniforms.bloomOn.value = bloomOn ? 1 : 0;
    finalM.uniforms.time.value = reduce() ? 0 : (t % 10);
    pass(finalM, null);
    // slow frames for a couple of seconds: drop the bloom, then the resolution
    frames++;
    if (dt > 0.034) slow++;
    if (frames >= 90) {
      if (slow > 45) { if (bloomOn) bloomOn = false; else if (scale > FLOOR) { scale = Math.max(FLOOR, scale * 0.85); resize(); } }
      frames = 0; slow = 0;
    }
    if (!paused) raf = requestAnimationFrame(draw);
  }
  const vis = () => { paused = document.hidden; if (!paused && !raf && alive) { last = performance.now(); raf = requestAnimationFrame(draw); } };
  document.addEventListener("visibilitychange", vis);
  raf = requestAnimationFrame(draw);

  return {
    THREE, scene, camera, renderer, canvas, mood: M, lights: { hemi, key, fill },
    get tier() { return tier; },
    onFrame(fn) { frameFns.add(fn); return () => frameFns.delete(fn); },
    // move the canvas into another host (a panel rebuilt around it)
    attach(el) {
      if (!el || canvas.parentNode === el) return;
      el.appendChild(canvas); ro.disconnect(); host = el; ro.observe(el); resize();
      if (alive) { cancelAnimationFrame(raf); raf = 0; draw(performance.now()); }   // a frame at the new size right away
    },
    // a 3D point (and a world-space radius) -> a DOMRect-like box on screen
    rectOf(obj, radius = 0.1) {
      const r = canvas.getBoundingClientRect(), p = new THREE.Vector3();
      obj.getWorldPosition(p);
      const c = p.clone().project(camera), e = p.clone().add(new THREE.Vector3(radius, 0, 0)).project(camera);
      const x = r.left + (c.x + 1) / 2 * r.width, y = r.top + (1 - c.y) / 2 * r.height;
      const rad = Math.abs(e.x - c.x) / 2 * r.width;
      return { left: x - rad, top: y - rad, width: rad * 2, height: rad * 2 };
    },
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
      scene.traverse(o => { o.geometry?.dispose?.(); for (const m of [].concat(o.material ?? [])) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose?.(); } });
      [rtScene, rtA, rtB].forEach(r => r.dispose());
      [brightM, blurM, finalM].forEach(m => m.dispose());
      renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    },
  };
}

// ---------------------------------------------------------------- the look
// a faceted, vertex-lit material (Lambert, flat normals), vertex colours on
export const flat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors: !!o.vc, ...o, vc: undefined });

// soft ambient occlusion baked into vertex colours: darker low down (where
// things meet the floor), in creases facing down, and toward a centre line
export function bakeAO(mesh, { floor = 0, reach = 0.6, strength = 0.55, under = 0.25 } = {}) {
  mesh.updateMatrixWorld(true);
  mesh.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal;
    if (!pos) return;
    const col = new Float32Array(pos.count * 3), v = new THREE.Vector3(), n = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const base = g.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const h = Math.max(0, Math.min(1, (v.y - floor) / reach));
      let ao = 1 - strength * (1 - h) * (1 - h);
      if (nor) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); ao *= 1 - under * Math.max(0, -n.y); }
      const b = base ? [base.getX(i), base.getY(i), base.getZ(i)] : [1, 1, 1];
      col[i * 3] = b[0] * ao; col[i * 3 + 1] = b[1] * ao; col[i * 3 + 2] = b[2] * ao;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    for (const m of [].concat(o.material)) { m.vertexColors = true; m.needsUpdate = true; }
  });
  return mesh;
}

// a soft dark blob on the floor under a character or prop
let blobTex = null;
export function blobShadow(w = 1, d = 0.6, opacity = 0.5) {
  if (!blobTex) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.55, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false, color: 0x000000 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.renderOrder = 1;
  return m;
}

// textures: small and crisp. Downscale anything bigger than `max` and
// filter nearest (the console look), no mipmaps
export function pixelTex(tex, max = 256) {
  const img = tex.image;
  if (img && (img.width > max || img.height > max)) {
    const k = max / Math.max(img.width, img.height), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    tex.image = c;
  }
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  return tex;
}
export function pixelModel(root, max = 256) {
  root.traverse(o => { for (const m of [].concat(o.material ?? [])) for (const k of ["map", "emissiveMap"]) if (m[k]) pixelTex(m[k], max); });
  return root;
}
// glTF PBR materials -> the faceted Lambert look (keeps the colour map)
export function lambertize(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material = [].concat(o.material).map(m => new THREE.MeshLambertMaterial({ map: m.map ?? null, color: m.color ?? 0xffffff, flatShading: true, transparent: m.transparent, opacity: m.opacity, side: m.side }));
    if (o.material.length === 1) o.material = o.material[0];
  });
  return root;
}

// ---------------------------------------------------------------- ambient life
let moteTex = null;
const softDot = () => {
  if (moteTex) return moteTex;
  const c = document.createElement("canvas"); c.width = c.height = 16;
  const x = c.getContext("2d"), g = x.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 16, 16);
  return (moteTex = new THREE.CanvasTexture(c));
};
// dust motes drifting in the light (additive, they catch the bloom a little)
export function motes(stage, { count = 60, box = [3, 2.5, 2], center = [0, 1.3, 0], color = 0xffd9a0, size = 0.035 } = {}) {
  const pos = new Float32Array(count * 3), seed = [];
  for (let i = 0; i < count; i++) {
    seed.push([Math.random(), Math.random(), Math.random(), 0.3 + Math.random()]);
    pos.set([center[0] + (Math.random() - 0.5) * box[0], center[1] + (Math.random() - 0.5) * box[1], center[2] + (Math.random() - 0.5) * box[2]], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: softDot(), color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  stage.scene.add(p);
  if (!reduce()) stage.onFrame((t, dt) => {
    for (let i = 0; i < count; i++) {
      const s = seed[i];
      let y = pos[i * 3 + 1] + dt * 0.05 * s[3];
      if (y > center[1] + box[1] / 2) y -= box[1];
      pos[i * 3 + 1] = y;
      pos[i * 3] += Math.sin(t * 0.4 + s[0] * 9) * dt * 0.03;
      pos[i * 3 + 2] += Math.cos(t * 0.3 + s[1] * 9) * dt * 0.02;
    }
    g.attributes.position.needsUpdate = true;
  });
  return p;
}
// a flame-like flicker on a light's intensity
export function flicker(stage, light, { base = light.intensity, amount = 0.18, speed = 9 } = {}) {
  const ph = Math.random() * 10;
  if (!reduce()) stage.onFrame(t => { light.intensity = base * (1 - amount / 2 + amount * (0.5 + 0.25 * Math.sin(t * speed + ph) + 0.25 * Math.sin(t * speed * 2.7 + ph * 3))); });
}
// a very subtle sway, as if a handheld camera were breathing
export function breathe(stage, { amp = 0.012, speed = 0.35, target = new THREE.Vector3(0, 1, 0) } = {}) {
  const home = stage.camera.position.clone();
  stage.onFrame(t => {
    if (reduce()) return;
    stage.camera.position.set(home.x + Math.sin(t * speed) * amp * 1.6, home.y + Math.sin(t * speed * 1.3 + 1) * amp, home.z);
    stage.camera.lookAt(target);
  });
  return { home, target };
}

// ---------------------------------------------------------------- stand-ins
// A flat cut-out (a pose, a prop) as a card lit by the room: its own texture
// with a mood ambient, a key light from one side, a coloured rim read off the
// cut-out's edge, an optional glow from below, and a touch of fog.
export function litCardMaterial(mood, { key = mood.key?.color ?? 0xffb070, rim = mood.fill?.color ?? 0x6a6cff, ambient = 0x50407a, side = 1, fog = 0.35 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      map: { value: null }, opacity: { value: 1 },
      ambient: { value: new THREE.Color(ambient) }, key: { value: new THREE.Color(key) }, rim: { value: new THREE.Color(rim) },
      glow: { value: new THREE.Color(0xffd7a0) }, glowAmt: { value: 0 }, keyAmt: { value: 1 }, side: { value: side },
      fogColor: { value: new THREE.Color(mood.fog?.color ?? 0x000000) }, fogAmt: { value: fog },
      texel: { value: new THREE.Vector2(1 / 256, 1 / 256) },
    },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D map; uniform float opacity, glowAmt, keyAmt, side, fogAmt; uniform vec3 ambient, key, rim, glow, fogColor; uniform vec2 texel; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(map, vUv);
        if (c.a * opacity < 0.02) discard;
        float aR = texture2D(map, vUv + vec2(texel.x * 3.0 * side, 0.0)).a, aL = texture2D(map, vUv - vec2(texel.x * 3.0 * side, 0.0)).a;
        float lit = clamp(c.a - aL, 0.0, 1.0), back = clamp(c.a - aR, 0.0, 1.0);
        vec3 col = pow(c.rgb, vec3(2.2));
        float kx = side > 0.0 ? vUv.x : 1.0 - vUv.x;               // the key falls off across the card
        vec3 light = ambient + key * keyAmt * mix(0.55, 0.95, 1.0 - kx) + key * lit * 0.7 + rim * back * 1.5;
        light += glow * glowAmt * smoothstep(0.65, 0.0, vUv.y);    // light from below (a stage, a ball)
        col = mix(col * light, pow(fogColor, vec3(2.2)), fogAmt);
        gl_FragColor = vec4(col, c.a * opacity);
      }`,
  });
}

// The game's own DOM pieces drawn in the 3D room instead. The DOM stays the
// source of truth (its CSS transitions, gravity arcs and timing keep running,
// just hidden); every frame each <img> under `root` hands its box, rotation,
// scale and opacity to a lit card at a fixed distance in front of the camera,
// so the choreography is unchanged and the pieces sit in the room's light.
export function mirrorDom(stage, root, { selector = "img", distance = 3, material = () => litCardMaterial(stage.mood), fog = 0.3 } = {}) {
  const { camera, canvas } = stage;
  if (!camera.parent) stage.scene.add(camera);
  const layer = new THREE.Group();
  camera.add(layer);
  const cards = new Map(), texOf = new Map();
  const geo = new THREE.PlaneGeometry(1, 1);
  // a detached copy of the image: three sizes a texture from img.width, which
  // on a laid-out <img> is its CSS width, not the picture's
  const tex = img => {
    const src = img.currentSrc || img.src;
    if (!src || !img.complete || !img.naturalWidth) return null;
    if (!texOf.has(src)) {
      const t = new THREE.Texture();
      t.colorSpace = THREE.SRGBColorSpace;
      texOf.set(src, t);
      const copy = new Image();
      copy.onload = () => { t.image = copy; t.needsUpdate = true; t.ready = true; };
      copy.src = src;
    }
    const t = texOf.get(src);
    return t.ready ? t : null;
  };
  function chain(el) {
    // opacity, rotation and scale from the element up to the root
    let op = 1, ang = 0, sx = 1, sy = 1;
    for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      op *= parseFloat(cs.opacity);
      if (cs.display === "none") return null;
      if (cs.transform && cs.transform !== "none") { const m = new DOMMatrixReadOnly(cs.transform); ang += Math.atan2(m.b, m.a); sx *= Math.hypot(m.a, m.b); sy *= Math.hypot(m.c, m.d); }
      if (n === root) break;
    }
    return { op, ang, sx, sy };
  }
  const off = stage.onFrame(() => {
    if (!root.isConnected) return;
    const cr = canvas.getBoundingClientRect();
    if (!cr.height) return;
    const k = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / cr.height;   // CSS px -> world at that distance
    const seen = new Set();
    const els = root.querySelectorAll(selector);
    els.forEach((img, i) => {
      const t = tex(img), ch = t && chain(img);
      if (!t || !ch || ch.op < 0.01) return;
      const r = img.getBoundingClientRect();
      if (!r.width) return;
      let card = cards.get(img);
      if (!card) { card = new THREE.Mesh(geo, material(img)); card.material.uniforms.fogAmt.value = fog; layer.add(card); cards.set(img, card); }
      seen.add(img);
      const u = card.material.uniforms;
      if (u.map.value !== t) { u.map.value = t; u.texel.value.set(1 / img.naturalWidth, 1 / img.naturalHeight); }
      u.opacity.value = ch.op;
      // object-fit: contain inside the element's box (poses sit on the box's bottom)
      const bw = img.offsetWidth * ch.sx, bh = img.offsetHeight * ch.sy, ar = img.naturalWidth / img.naturalHeight;
      const fw = Math.min(bw, bh * ar), fh = Math.min(bh, bw / ar);
      const bottom = getComputedStyle(img).objectPosition?.includes("100%");
      let dx = 0, dy = bottom ? (bh - fh) / 2 : 0;
      const ca = Math.cos(ch.ang), sa = Math.sin(ch.ang);
      const cx = r.left + r.width / 2 + dx * ca - dy * sa, cy = r.top + r.height / 2 + dx * sa + dy * ca;
      card.position.set((cx - cr.left - cr.width / 2) * k, -(cy - cr.top - cr.height / 2) * k, -distance + i * 0.0005);
      card.scale.set(fw * k, fh * k, 1);
      card.rotation.z = -ch.ang;
      card.renderOrder = 10 + i;
      card.visible = true;
    });
    for (const [img, card] of cards) if (!seen.has(img)) { card.visible = false; if (!img.isConnected) { card.material.dispose(); layer.remove(card); cards.delete(img); } }
  });
  return {
    cards, layer,
    dispose() { off(); for (const c of cards.values()) c.material.dispose(); for (const t of texOf.values()) t.dispose(); camera.remove(layer); },
  };
}
