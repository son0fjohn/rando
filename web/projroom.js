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
//   const pr = projRoom(stage, PROJ, plateTexture);
//   pr.add(new THREE.BoxGeometry(1, 1, 1), pr.paint(0x808080), x, y, z);
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
const FS = `
#include <packing>
uniform sampler2D plate, depth, fbMap;
uniform mat4 projVP; uniform vec3 projPos; uniform vec2 depthTexel;
uniform vec3 fbColor, mul, lightDir; uniform float useFb, alpha; uniform vec2 fbRepeat;
varying vec3 vWorld; varying vec2 vUv; varying vec3 vNormalW;
float sceneDist(vec2 uv) {   // the far-most of 3x3: no thin fallback rims along silhouettes
  float d = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    d = max(d, unpackRGBAToDepth(texture2D(depth, uv + vec2(float(i), float(j)) * depthTexel)));
  return d * ${MAXD.toFixed(1)};
}
void main() {
  vec4 p = projVP * vec4(vWorld, 1.0);
  vec3 n = p.xyz / p.w;
  vec2 uv = n.xy * 0.5 + 0.5;
  float inside = step(0.0, p.w) * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float vis = 0.0;
  if (inside > 0.5) {
    float d = distance(vWorld, projPos);
    vis = step(d, sceneDist(uv) * 1.004 + 0.025);
  }
  // where the picture can't help: a tile or a colour, with a simple soft light from above the room
  float lit = 0.62 + 0.38 * max(dot(normalize(vNormalW), lightDir), 0.0);
  vec3 fb = (useFb > 0.5 ? texture2D(fbMap, vUv * fbRepeat).rgb * fbColor : fbColor) * lit;
  vec3 c = vis > 0.5 ? texture2D(plate, uv).rgb : fb;
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

// PROJ: the picture's camera (pos, pitch, vertical fov, aspect); plate: its texture
export function projRoom(stage, PROJ, plate, { lightDir = [-0.25, 0.85, 0.46], depthSize = [376, 672] } = {}) {
  const { scene, renderer } = stage;
  const proj = new THREE.PerspectiveCamera(PROJ.fov, PROJ.aspect, 0.05, 60);
  proj.position.set(...PROJ.pos);
  proj.lookAt(PROJ.pos[0], PROJ.pos[1] - Math.sin(PROJ.pitch), PROJ.pos[2] - Math.cos(PROJ.pitch));
  proj.updateMatrixWorld(); proj.updateProjectionMatrix();
  const projVP = new THREE.Matrix4().multiplyMatrices(proj.projectionMatrix, proj.matrixWorldInverse);
  const [DW, DH] = depthSize;
  const depthRT = new THREE.WebGLRenderTarget(DW, DH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const shared = {
    plate: { value: plate }, depth: { value: depthRT.texture }, projVP: { value: projVP }, projPos: { value: proj.position.clone() },
    depthTexel: { value: new THREE.Vector2(1 / DW, 1 / DH) }, lightDir: { value: new THREE.Vector3(...lightDir).normalize() },
  };
  const depthMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: DEPTH_FS, uniforms: { projPos: shared.projPos }, side: THREE.DoubleSide });
  // a projected material; the fallback is a colour, or a tile (times that colour)
  const paint = (fb = 0x2a2030, { map = null, repeat = [1, 1], side = THREE.FrontSide } = {}) => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side,
    uniforms: { ...shared, fbMap: { value: map }, useFb: { value: map ? 1 : 0 }, fbRepeat: { value: new THREE.Vector2(...repeat) },
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
    renderer.setRenderTarget(depthRT); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(scene, proj);
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
    dispose() { depthRT.dispose(); depthMat.dispose(); plate.dispose(); },
  };
}
