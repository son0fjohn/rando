// Camera mapping: a room made of real low-poly geometry, painted by
// projecting an approved picture from the camera that took it. From that
// camera the room IS the picture; look around and the same paint sits on
// the 3D shapes. Where the camera couldn't see a surface (behind things,
// past the picture's edges) it falls back to a plain tile or colour with a
// simple soft light. The paint carries its own light, so these surfaces are
// unlit, and the stage must be encoded (retrolook `encoded: true`): the
// picture's pixels go straight to the screen.
//
// Used by the rooms behind the game hosts: rooftop.js (Side Quest),
// basement.js (the Ritual).
//
// Layers (optional): give the room an empty-room picture too (`shell`: the
// same picture with the furniture taken out) and paint the room's shell
// (walls, floor, ceiling, what stands against them) from it with
// paint(c, { shell: true }). The shell's depth maps leave the furniture
// out, so looking around, nothing of a table or a cup is ever smeared on
// the wall or the floor behind it: those surfaces show the empty room, and
// the furniture's paint lands on the furniture only.
//
//   const pr = projRoom(stage, PROJ, plateTexture, { shell: emptyTexture, sides: [{ PROJ: orbitProj(PROJ, 2.5, -0.79), plate: left }, ...] });
//   pr.add(new THREE.BoxGeometry(1, 1, 1), pr.paint(0x808080), x, y, z);
//   pr.add(wallGeo, pr.paint(0x808080, { shell: true }), x, y, z);
//   pr.refreshDepth();   // once everything static is added
import { THREE } from "./retrolook.js";

const MAXD = 40;   // distances are packed as d / MAXD

const VS = `
varying vec3 vWorld; varying vec2 vUv; varying vec3 vNormalW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
// up to three projectors: the approved picture (front) and two side views
// (the same room seen from round the table to the left and the right). The
// front paints whatever it sees head-on; what it sees badly or not at all
// takes the side views', blended by how squarely each sees it; what none
// of them saw falls back.
const FS = `
#include <packing>
uniform sampler2D plate, depth, fbMap, plateL, depthL, plateR, depthR;
uniform mat4 projVP, projVPL, projVPR; uniform vec3 projPos, projPosL, projPosR; uniform vec2 depthTexel; uniform float sides;
uniform vec3 fbColor, mul, lightDir; uniform float useFb, alpha; uniform vec2 fbRepeat;
varying vec3 vWorld; varying vec2 vUv; varying vec3 vNormalW;
float sceneDist(sampler2D dm, vec2 uv) {   // the far-most of 3x3: no thin fallback rims along silhouettes
  float d = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    d = max(d, unpackRGBAToDepth(texture2D(dm, uv + vec2(float(i), float(j)) * depthTexel)));
  return d * ${MAXD.toFixed(1)};
}
// one projector: its colour here, and how much to trust it (0 = it didn't see this)
vec4 seen(sampler2D pl, sampler2D dm, mat4 vp, vec3 pos, vec3 n, out vec3 col) {
  vec4 p = vp * vec4(vWorld, 1.0);
  vec2 uv = (p.xy / p.w) * 0.5 + 0.5;
  col = vec3(0.0);
  if (p.w <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  float vis = step(distance(vWorld, pos), sceneDist(dm, uv) * 1.004 + 0.025);
  float edge = smoothstep(0.0, 0.04, min(uv.x, 1.0 - uv.x)) * smoothstep(0.0, 0.04, min(uv.y, 1.0 - uv.y));
  float facing = abs(dot(n, normalize(pos - vWorld)));
  vec4 tx = texture2D(pl, uv);   // a side view's alpha masks out what it can't place (the table and its things)
  col = tx.rgb;
  return vec4(vis, vis * edge * facing * tx.a, facing, 0.0);
}
void main() {
  vec3 n = normalize(vNormalW);
  vec3 cf, cl, cr;
  vec4 f = seen(plate, depth, projVP, projPos, n, cf);
  // where the picture can't help: a tile or a colour, with a simple soft light from above the room
  float lit = 0.62 + 0.38 * max(dot(n, lightDir), 0.0);
  vec3 fb = (useFb > 0.5 ? texture2D(fbMap, vUv * fbRepeat).rgb * fbColor : fbColor) * lit;
  vec3 c = f.x > 0.5 ? cf : fb;
  if (sides > 0.5) {
    vec4 l = seen(plateL, depthL, projVPL, projPosL, n, cl), r = seen(plateR, depthR, projVPR, projPosR, n, cr);
    float ws = l.y + r.y;
    vec3 side = ws > 0.02 ? (cl * l.y + cr * r.y) / ws : fb;
    // the front wins wherever it saw the surface (the default view stays the picture);
    // only what it saw almost edge-on, or not at all, takes the side views
    float k = f.x * max(smoothstep(0.02, 0.08, f.z), step(ws, 0.02));
    c = mix(ws > 0.02 ? side : fb, cf, k);
  }
  gl_FragColor = vec4(c * mul, alpha);   // display-ready already (an encoded stage)
}`;
const DEPTH_FS = `
#include <packing>
uniform vec3 projPos; varying vec3 vWorld; varying vec2 vUv; varying vec3 vNormalW;
void main() { gl_FragColor = packDepthToRGBA(min(distance(vWorld, projPos) / ${MAXD.toFixed(1)}, 0.999)); }`;

// a texture used as is (the stage is encoded); tiles repeat
export const loadTex = (url, repeat = false) => new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
  t.colorSpace = THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.generateMipmaps = repeat; t.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  res(t);
}, undefined, rej));

// a side view's camera: the picture's camera orbited `yaw` round the point
// `dist` in front of it (the same orbit as npcstage.js's look-around)
export function orbitProj(PROJ, dist, yaw) {
  const [x, y, z] = PROJ.pos, p = PROJ.pitch;
  const T = [x, y - dist * Math.sin(p), z - dist * Math.cos(p)];
  return { ...PROJ, pos: [T[0] + dist * Math.sin(yaw) * Math.cos(p), T[1] + dist * Math.sin(p), T[2] + dist * Math.cos(yaw) * Math.cos(p)], target: T };
}

// PROJ: the picture's camera (pos, pitch or target, vertical fov, aspect); plate: its texture;
// sides: [{ PROJ, plate }, { PROJ, plate }] the views from round the left and the right
export function projRoom(stage, PROJ, plate, { lightDir = [-0.25, 0.85, 0.46], depthSize = [376, 672], sides = null, shell = null } = {}) {
  const { scene, renderer } = stage;
  const [DW, DH] = depthSize;
  const projector = P => {
    const cam = new THREE.PerspectiveCamera(P.fov, P.aspect, 0.05, 60);
    cam.position.set(...P.pos);
    if (P.target) cam.lookAt(...P.target);
    else cam.lookAt(P.pos[0], P.pos[1] - Math.sin(P.pitch), P.pos[2] - Math.cos(P.pitch));
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const mk = () => new THREE.WebGLRenderTarget(DW, DH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    // rt: what it saw of everything; srt: of the shell alone (the layers)
    return { cam, rt: mk(), srt: shell ? mk() : null, vp: new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), pos: cam.position.clone() };
  };
  const front = projector(PROJ), proj = front.cam;
  const L = sides ? projector(sides[0].PROJ) : front, R = sides ? projector(sides[1].PROJ) : front;
  const shared = {
    plate: { value: plate }, depth: { value: front.rt.texture }, projVP: { value: front.vp }, projPos: { value: front.pos },
    plateL: { value: sides?.[0].plate ?? plate }, depthL: { value: L.rt.texture }, projVPL: { value: L.vp }, projPosL: { value: L.pos },
    plateR: { value: sides?.[1].plate ?? plate }, depthR: { value: R.rt.texture }, projVPR: { value: R.vp }, projPosR: { value: R.pos },
    sides: { value: sides ? 1 : 0 },
    depthTexel: { value: new THREE.Vector2(1 / DW, 1 / DH) }, lightDir: { value: new THREE.Vector3(...lightDir).normalize() },
  };
  // the shell's projectors: the empty room, and depth maps without the furniture
  const shellU = shell ? {
    ...shared, plate: { value: shell }, depth: { value: front.srt.texture }, depthL: { value: L.srt.texture }, depthR: { value: R.srt.texture },
  } : shared;
  const depthPos = { value: front.pos };
  const depthMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: DEPTH_FS, uniforms: { projPos: depthPos }, side: THREE.DoubleSide });
  // a projected material; the fallback is a colour, or a tile (times that colour)
  const paint = (fb = 0x2a2030, { map = null, repeat = [1, 1], side = THREE.FrontSide, shell: isShell = false } = {}) => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side, userData: { shell: isShell && !!shell },
    uniforms: { ...(isShell ? shellU : shared), fbMap: { value: map }, useFb: { value: map ? 1 : 0 }, fbRepeat: { value: new THREE.Vector2(...repeat) },
      fbColor: { value: fb?.isColor ? fb : new THREE.Color(fb) }, mul: { value: new THREE.Vector3(1, 1, 1) }, alpha: { value: 1 } },
  });
  const statics = [];
  const add = (geo, m, x, y, z, ry = 0, rx = 0, rz = 0, parent = scene) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); statics.push(o); return o;
  };
  // a piece of the picture as its own little texture (for walls it never saw)
  const crop = (x0, y0, x1, y1) => {
    const im = plate.image, c = document.createElement("canvas");
    const w = Math.max(8, Math.round((x1 - x0) * im.width)), h = Math.max(8, Math.round((y1 - y0) * im.height));
    c.width = w; c.height = h; c.getContext("2d").drawImage(im, x0 * im.width, y0 * im.height, w, h, 0, 0, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
  };
  // the projector's view of the room: what it saw is painted, the rest falls back
  function refreshDepth() {
    const vis = new Map();
    scene.traverse(o => { if (o.isMesh || o.isSprite || o.isPoints) { vis.set(o, o.visible); o.visible = statics.includes(o); } });
    const prevTarget = renderer.getRenderTarget(), prevOverride = scene.overrideMaterial, prevBg = scene.background;
    scene.overrideMaterial = depthMat; scene.background = null;
    for (const P of sides ? [front, L, R] : [front]) {
      depthPos.value = P.pos;
      renderer.setRenderTarget(P.rt); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(scene, P.cam);
      if (!P.srt) continue;
      // the shell alone: the furniture isn't there to hide anything
      for (const o of statics) o.visible = !!o.material.userData?.shell;
      renderer.setRenderTarget(P.srt); renderer.clear(); renderer.render(scene, P.cam);
      for (const o of statics) o.visible = true;
    }
    renderer.setRenderTarget(prevTarget); scene.overrideMaterial = prevOverride; scene.background = prevBg;
    for (const [o, v] of vis) o.visible = v;
  }
  return {
    proj, paint, add, statics, crop, refreshDepth,
    // a point on the plane z = z, seen at (fx, fy) of the picture (0..1 from the top left)
    onPlane: (fx, fy, z) => {
      const v = new THREE.Vector3(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(proj);
      const d = v.sub(proj.position).normalize();
      return proj.position.clone().addScaledVector(d, (z - proj.position.z) / d.z);
    },
    // fade a group of painted meshes (0..1), e.g. something standing in the way
    fade(objs, a) { for (const o of objs) { const m = o.material; m.uniforms.alpha.value = a; m.transparent = a < 0.99; m.depthWrite = a > 0.98; } },
    sideCams: sides ? [L.cam, R.cam] : [],
    dispose() {
      for (const P of new Set([front, L, R])) { P.rt.dispose(); P.srt?.dispose(); }
      depthMat.dispose(); plate.dispose(); shell?.dispose(); sides?.forEach(v => v.plate.dispose());
    },
  };
}
