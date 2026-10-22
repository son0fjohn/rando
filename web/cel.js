// One cel shader for every character mesh: body, hair, clothes, shoes,
// accessories. MeshToonMaterial with a shared 3-tone ramp, cool (blue)
// shadows, a soft warm top light and a thin rim — plus, on the body, the
// face texture composited onto the head through the faceUvw attribute
// (u, v, weight; see avatar3.js). Lights come from the scene, so it reads
// the same on the map, the Style screen and in sprites.
import * as THREE from "https://esm.sh/three@0.160.0";

let ramp = null;
function toonRamp() {
  if (ramp) return ramp;
  // 3 tones: shadow, mid, lit. Nearest filtering keeps the steps crisp.
  const d = new Uint8Array([105, 105, 105, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

const SHADOW = new THREE.Color(0x6f7dbd); // what unlit skin/cloth drifts toward
const RIM = new THREE.Color(0xfff1d6);

// opts: { map, color, face: Texture|null, rim (0..1), side,
//   paint: { skin, scalp, tank, shorts } colors for the body's bodyRgn
//   attribute (per-vertex weights of those regions; see avatar3.js), and
//   scalpCut: where the scalp's signed distance (x) is cut, 0.5 = hairline }
export function celMaterial({ map = null, color = 0xffffff, face = null, rim = 0.32, side = THREE.FrontSide, paint = null } = {}) {
  const m = new THREE.MeshToonMaterial({ map, color, gradientMap: toonRamp(), side });
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  const u = {
    uShadow: { value: SHADOW },
    uRim: { value: RIM },
    uRimK: { value: rim },
    uFace: { value: face },
    uFaceOn: { value: face ? 1 : 0 },
    uPaintOn: { value: paint ? 1 : 0 },
    uSkinC: { value: new THREE.Color(paint?.skin ?? 0xffffff) },
    uScalpC: { value: new THREE.Color(paint?.scalp ?? 0x000000) },
    uTankC: { value: new THREE.Color(paint?.tank ?? 0xffffff) },
    uShortsC: { value: new THREE.Color(paint?.shorts ?? 0xffffff) },
    uScalpCut: { value: paint?.scalpCut ?? 0.5 },
    uHide: { value: new THREE.Vector3(...(paint?.hide ?? [0, 0, 0]).map(Number)) },
  };
  m.userData.cel = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 faceUvw; attribute vec4 bodyRgn; attribute float footW;\nvarying vec3 vFace; varying vec4 vRgn; varying float vFoot;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFace = faceUvw; vRgn = bodyRgn; vFoot = footW;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec3 uShadow; uniform vec3 uRim; uniform float uRimK;
uniform sampler2D uFace; uniform float uFaceOn; varying vec3 vFace;
uniform float uPaintOn, uScalpCut; uniform vec3 uSkinC, uScalpC, uTankC, uShortsC, uHide; varying vec4 vRgn; varying float vFoot;
float crisp(float w) { return smoothstep(0.42, 0.58, w); }`)
      // the face is painted into the head's diffuse color before lighting,
      // so it shades exactly like the skin under it
      .replace("#include <map_fragment>", `#include <map_fragment>
if (uPaintOn > 0.5) {
  // under worn clothes: well inside the region (0.9), so the body still
  // fills right up to a garment's edge
  if ((uHide.x > 0.5 && vRgn.z > 0.9) || (uHide.y > 0.5 && vRgn.w > 0.9) || (uHide.z > 0.5 && vFoot > 0.9)) discard;
  // flat cel colors per body region (x scalp, y skin, z tank, w shorts);
  // region edges are iso-lines of the interpolated weights, kept crisp
  diffuseColor.rgb = mix(diffuseColor.rgb, uSkinC, crisp(vRgn.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, uTankC, crisp(vRgn.z));
  diffuseColor.rgb = mix(diffuseColor.rgb, uShortsC, crisp(vRgn.w));
  diffuseColor.rgb = mix(diffuseColor.rgb, uScalpC, smoothstep(uScalpCut - 0.025, uScalpCut + 0.025, vRgn.x));
}
if (uFaceOn > 0.5 && vFace.z > 0.001) {
  vec2 fuv = vFace.xy;
  float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
  vec4 f = texture2D(uFace, fuv);
  diffuseColor.rgb = mix(diffuseColor.rgb, f.rgb, f.a * inside * clamp(vFace.z, 0.0, 1.0));
}`)
      // cool shadows + rim, on the final lit color
      .replace("#include <opaque_fragment>", `{
  float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  float base = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) + 1e-3;
  float shade = clamp(lum / base, 0.0, 1.0);
  outgoingLight = mix(outgoingLight * mix(vec3(1.0), uShadow * 1.25, 0.7), outgoingLight, smoothstep(0.2, 0.6, shade));
  vec3 vdir = normalize(vViewPosition);
  float fres = 1.0 - clamp(dot(normalize(normal), vdir), 0.0, 1.0);
  outgoingLight += uRim * uRimK * smoothstep(0.62, 0.9, fres) * diffuseColor.rgb;
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "cel1";
  return m;
}

// recolor painted regions in place (no rebuild)
export function setPaint(mat, paint) {
  const u = mat?.userData?.cel;
  if (!u) return;
  for (const [k, n] of [["skin", "uSkinC"], ["scalp", "uScalpC"], ["tank", "uTankC"], ["shorts", "uShortsC"]]) {
    if (paint[k] != null) u[n].value.set(paint[k]);
  }
  if (paint.scalpCut != null) u.uScalpCut.value = paint.scalpCut;
  if (paint.hide) u.uHide.value.set(...paint.hide.map(Number));
}

// swap the face texture on a body material (expressions, blink)
export function setFace(mat, tex) {
  const u = mat?.userData?.cel;
  if (!u) return;
  u.uFace.value = tex;
  u.uFaceOn.value = tex ? 1 : 0;
}
