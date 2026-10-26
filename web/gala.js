// The Art Gallery's room: Seoul's most exclusive secret masquerade, a
// candlelit gala at night. Dark red damask walls and wood wainscot, heavy
// velvet curtains over tall windows, a crystal chandelier, gold candle
// sconces, a dark polished wood floor, the big gold frame centred on the
// back wall with the player's photo in it and the two title plaques under
// it; masked guests with champagne by the walls.
//
// How it's drawn: camera mapping (projroom.js), like the Prophet's rooftop
// and the Boss's basement: simple shapes painted with the approved picture
// from its own camera, so the default view IS the picture. The paint
// (plate.webp) is the picture widened to a square (outpainted: more curtains
// and windows each side, for looking around), with a clean plate where
// Bunny, the guests, the chandelier, the photo, the plaques and the dialog
// box were. What moves or stands in the room is its own layer on top:
//   - the guests: cut-outs of the picture's guests standing at their own
//     depth, turned to the camera as it orbits (a slight sway; a tap: they
//     raise their glasses, guests_*_toast.webp),
//   - the chandelier: a cut-out hanging from the ceiling at its depth,
//   - the photo: a plane in the frame's opening (cover-fit),
//   - the drape: red velvet over the frame that slides off on the unveil,
//   - the spotlight on the frame, the candle flames' glow (they flicker).
// Walls the picture never saw (the sides) take tiles of it: damask above,
// wainscot below, a curtained window and two sconces.
//
//   const room = await galaRoom(stage);   // after retroStage(..., { encoded: true })
//   room.photo(url); room.drape(true|false, { instant }); room.spot(0..1);
//   room.plaqueRects() -> [{ left, top, width, height }, ...] (CSS px, for the DOM plaques)
//   room.targets / room.update(t, dt) / room.poke(kind, obj) / room.dispose()
import { THREE } from "./retrolook.js";
import { projRoom, loadTex } from "./projroom.js";
import { encode, softDot } from "./npcstage.js";

const ART = new URL("./games/artgallery/gala/", import.meta.url).href;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// the picture's camera, solved from it (the floor line, the wainscot's top,
// the floor boards' vanishing point): 1.29 m up, a hair down, 46° vertical
// field at 9:16; the back wall 6.1 m away
export const PROJ = { pos: [0, 1.286, 3.135], pitch: 0.017, fov: 46, aspect: 9 / 16 };
// the paint is that picture widened to a square: the same camera, aspect 1
const PROJ_W = { ...PROJ, aspect: 1 };
const PIC_W = 9 / 16;
// the room: back wall, half width, front wall, ceiling
export const BACK = -3.0;
const RW = 3.6, RF = 3.6, RH = 3.6;

// a point seen at (fx, fy) of the approved picture (0..1 from its top left)
const cam9 = new THREE.PerspectiveCamera(PROJ.fov, PROJ.aspect, 0.05, 60);
cam9.position.set(...PROJ.pos);
cam9.lookAt(PROJ.pos[0], PROJ.pos[1] - Math.sin(PROJ.pitch), PROJ.pos[2] - Math.cos(PROJ.pitch));
cam9.updateMatrixWorld(); cam9.updateProjectionMatrix();
const rayAt = (fx, fy) => new THREE.Vector3(fx * 2 - 1, 1 - fy * 2, 0.5).unproject(cam9).sub(cam9.position).normalize();
// …on the plane z = z
export const picZ = (fx, fy, z) => { const d = rayAt(fx, fy); return cam9.position.clone().addScaledVector(d, (z - cam9.position.z) / d.z); };
// …on the floor
export const picFloor = (fx, fy) => { const d = rayAt(fx, fy); return cam9.position.clone().addScaledVector(d, -cam9.position.y / d.y); };

// where things are in the picture (fractions of it), measured
const FRAME_OPEN = { fx: [0.354, 0.655], fy: [0.214, 0.452] };   // the photo's opening
const FRAME_OUT = { fx: [0.262, 0.742], fy: [0.157, 0.502] };    // the gold frame's outside
const PLAQUES = [{ fx: [0.353, 0.663], fy: [0.551, 0.614] }, { fx: [0.353, 0.663], fy: [0.623, 0.687] }];
const FLAMES = [[0.139, 0.247], [0.228, 0.247], [0.772, 0.247], [0.859, 0.247]];   // the sconces' candles
// the cut-outs (assets.py): their rectangles in the picture, the feet's row
const CUTS = {
  l: { fx: [-0.1126, 0.1915], fy: [0.4004, 0.7671], feet: 0.7652, tap: "guestL" },
  r: { fx: [0.7384, 1.0811], fy: [0.406, 0.7685], feet: 0.7671, tap: "guestR" },
};
const CHAND = { fx: [0.2695, 0.7311], fy: [0.0, 0.1573], z: -0.9 };
// the chandelier's candle flames, as fractions of its cut-out
const CHAND_FLAMES = [[0.13, 0.05], [0.19, 0.24], [0.4, 0.03], [0.6, 0.03], [0.81, 0.24], [0.87, 0.05]];
export const FRAME_CENTRE = picZ(0.508, 0.333, BACK + 0.05);

export async function galaRoom(stage) {
  const { scene, camera } = stage;
  const L = new THREE.TextureLoader();
  const img = f => new Promise((res, rej) => L.load(`${ART}${f}`, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
  const [plate, chandT, gl, glT, gr, grT] = await Promise.all([loadTex(`${ART}plate.webp`), img("chandelier.webp"), img("guests_l.webp"), img("guests_l_toast.webp"), img("guests_r.webp"), img("guests_r_toast.webp")]);
  const pr = projRoom(stage, PROJ_W, plate, { lightDir: [0.1, 0.8, 0.6], depthSize: [672, 672] });
  const { paint, add, crop } = pr;
  // a piece of the picture (fractions of the 9:16 picture) as a repeating tile
  const tile = (x0, y0, x1, y1) => { const t = crop(0.5 + (x0 - 0.5) * PIC_W, y0, 0.5 + (x1 - 0.5) * PIC_W, y1); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const damask = tile(0.27, 0.53, 0.33, 0.53 + 0.034);      // wall between the frame's edge and the sconce
  const wains = tile(0.36, 0.57, 0.64, 0.7);                  // the centre wainscot panel
  const boards = tile(0.32, 0.86, 0.68, 0.98);                // the floor
  const folds = crop(0.035, 0.25, 0.1, 0.62); folds.wrapS = folds.wrapT = THREE.RepeatWrapping;   // the left curtain's folds
  const sheerT = crop(0.07, 0.3, 0.2, 0.6); sheerT.wrapS = sheerT.wrapT = THREE.RepeatWrapping;      // the window's sheers
  const tileM = (map, k, rep) => paint(new THREE.Color().setScalar(k), { map, repeat: rep });
  const PL = (w, h) => new THREE.PlaneGeometry(w, h);
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const chairY = picZ(0.5, 0.535, BACK).y;                    // the wainscot's top on the back wall

  // ---- the room's shell
  const D = RF - BACK;
  add(PL(RW * 2, D), tileM(boards, 1.0, [RW * 2 / 1.1, D / 0.9]), 0, 0, (RF + BACK) / 2, 0, -Math.PI / 2);
  add(PL(RW * 2, D), paint(0x24110f), 0, RH, (RF + BACK) / 2, 0, Math.PI / 2);
  add(PL(RW * 2, RH), tileM(damask, 1, [RW * 2 / 0.5, RH / 0.5]), 0, RH / 2, BACK);
  for (const s of [-1, 1]) {
    // the side walls: damask above the wainscot, panels below, skirting
    add(PL(D, RH - chairY), tileM(damask, 0.9, [D / 0.5, (RH - chairY) / 0.5]), s * RW, (RH + chairY) / 2, (RF + BACK) / 2, -s * Math.PI / 2);
    add(PL(D, chairY), tileM(wains, 0.85, [D / 1.6, 1]), s * RW, chairY / 2, (RF + BACK) / 2, -s * Math.PI / 2);
    add(B(0.04, 0.05, D), paint(0x3a1a12), s * (RW - 0.02), chairY, (RF + BACK) / 2);
    // a tall curtained window on each side wall, like the back wall's
    const wz = -1.2;
    add(B(0.03, 2.5, 1.2), tileM(sheerT, 0.95, [1, 1]), s * (RW - 0.02), 1.55, wz);
    for (const dz of [-0.75, 0.75]) add(B(0.12, 2.9, 0.42), tileM(folds, 0.9, [1, 1]), s * (RW - 0.08), 1.6, wz + dz);
    add(B(0.16, 0.36, 1.95), tileM(folds, 0.8, [2, 0.4]), s * (RW - 0.1), 3.05, wz);
  }
  add(PL(RW * 2, RH), tileM(damask, 0.8, [RW * 2 / 0.5, RH / 0.5]), 0, RH / 2, RF, Math.PI);
  pr.refreshDepth();

  // ---- glow: candle flames, the frame's spotlight (additive, on top of the paint)
  const glowT = softDot([[0, "rgba(255,240,200,1)"], [0.25, "rgba(255,190,110,.55)"], [1, "rgba(255,140,60,0)"]]);
  const glowM = (o = 0.6) => { const m = new THREE.SpriteMaterial({ map: glowT, color: 0xffffff, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); m.onBeforeCompile = encode; return m; };
  const flames = [];
  const flame = (p, size, parent = scene) => {
    const s = new THREE.Sprite(glowM(0.5)); s.position.copy(p); s.scale.setScalar(size); s.renderOrder = 7; parent.add(s);
    s.userData = { base: size, ph: Math.random() * 10, poke: 9 }; flames.push(s); return s;
  };
  for (const [fx, fy] of FLAMES) flame(picZ(fx, fy, BACK + 0.12), 0.16);

  // the side walls' sconces: a gold backplate, two candles, their flames
  const gold = new THREE.MeshLambertMaterial({ color: 0xb8862e, emissive: 0x2a1804 }); gold.onBeforeCompile = encode;
  const wax = new THREE.MeshLambertMaterial({ color: 0xf2e6cc, emissive: 0x3a2a14 }); wax.onBeforeCompile = encode;
  const sconces = [];
  for (const s of [-1, 1]) for (const z of [-2.2, -0.2]) {
    const g = new THREE.Group(); g.position.set(s * (RW - 0.03), 2.05, z); g.rotation.y = -s * Math.PI / 2; scene.add(g);
    const plateM = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.32, 8), gold); plateM.scale.z = 0.3; g.add(plateM);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.03), gold); arm.position.set(0, -0.05, 0.1); g.add(arm);
    for (const dx of [-0.15, 0.15]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.025, 0.04, 8), gold); cup.position.set(dx, -0.03, 0.1); g.add(cup);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), wax); c.position.set(dx, 0.07, 0.1); g.add(c);
      g.updateMatrixWorld(true);
      flame(new THREE.Vector3(dx, 0.17, 0.1).applyMatrix4(g.matrixWorld), 0.14);
    }
    sconces.push(g);
  }

  // the spotlight on the frame: a warm soft light over it and a faint cone
  // from the ceiling; it snaps on with the unveil
  const spotT = softDot([[0, "rgba(255,236,200,.95)"], [0.5, "rgba(255,210,150,.35)"], [1, "rgba(255,190,120,0)"]]);
  const fo = picZ(FRAME_OUT.fx[0], FRAME_OUT.fy[0], BACK + 0.14), fo2 = picZ(FRAME_OUT.fx[1], FRAME_OUT.fy[1], BACK + 0.14);
  const fw = fo2.x - fo.x, fh = fo.y - fo2.y, fc = new THREE.Vector3((fo.x + fo2.x) / 2, (fo.y + fo2.y) / 2, BACK + 0.14);
  const spotM = new THREE.MeshBasicMaterial({ map: spotT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  spotM.onBeforeCompile = encode;
  // (just in front of the wall's paint, behind the photo: it lights the frame, not the picture in it)
  const spotGlow = new THREE.Mesh(PL(fw * 1.7, fh * 1.45), spotM); spotGlow.position.set(fc.x, fc.y, BACK + 0.015); spotGlow.renderOrder = 0.5; scene.add(spotGlow);
  const coneTex = (() => { const c = document.createElement("canvas"); c.width = 4; c.height = 64; const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, "rgba(255,225,170,.0)"); g.addColorStop(0.3, "rgba(255,225,170,.5)"); g.addColorStop(1, "rgba(255,225,170,.9)"); x.fillStyle = g; x.fillRect(0, 0, 4, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const coneM = new THREE.MeshBasicMaterial({ map: coneTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  coneM.onBeforeCompile = encode;
  const coneTop = new THREE.Vector3(fc.x, RH - 0.02, BACK + 1.6);
  const coneLen = coneTop.distanceTo(fc);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.04, fw * 0.62, coneLen, 20, 1, true), coneM);
  cone.position.copy(coneTop).add(fc).multiplyScalar(0.5);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), fc.clone().sub(coneTop).normalize());
  cone.renderOrder = 6; scene.add(cone);
  // the spot's own lamp on the ceiling
  const lampM = new THREE.MeshLambertMaterial({ color: 0x2a2420, emissive: 0x000000 }); lampM.onBeforeCompile = encode;
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.16, 10), lampM); lamp.position.copy(coneTop).y -= 0.06;
  lamp.quaternion.copy(cone.quaternion); scene.add(lamp);

  // ---- the photo, in the frame's opening (cover-fit)
  const po = picZ(FRAME_OPEN.fx[0], FRAME_OPEN.fy[0], BACK + 0.03), po2 = picZ(FRAME_OPEN.fx[1], FRAME_OPEN.fy[1], BACK + 0.03);
  const pw = po2.x - po.x, ph = po.y - po2.y;
  const photoM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false }); photoM.onBeforeCompile = encode;
  const photoMesh = new THREE.Mesh(PL(pw, ph), photoM);
  photoMesh.position.set((po.x + po2.x) / 2, (po.y + po2.y) / 2, BACK + 0.03); photoMesh.renderOrder = 1; scene.add(photoMesh);
  let photoUrl = null;
  function setPhoto(url) {
    if (url === photoUrl) return;
    photoUrl = url;
    if (!url) { photoM.opacity = 0; return; }
    L.load(url, t => {
      if (photoUrl !== url) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace;
      const ia = t.image.width / t.image.height, fa = pw / ph;
      if (ia > fa) { t.repeat.set(fa / ia, 1); t.offset.set((1 - fa / ia) / 2, 0); } else { t.repeat.set(1, ia / fa); t.offset.set(0, (1 - ia / fa) / 2); }
      photoM.map?.dispose(); photoM.map = t; photoM.needsUpdate = true; photoM.opacity = 1;
    });
  }

  // ---- the drape: red velvet over the whole frame, folds in the cloth; on
  // the unveil it slides down off the frame and is gone
  const velvet = (() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 256; const x = c.getContext("2d");
    for (let i = 0; i < 256; i++) { const k = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(i / 256 * Math.PI * 14 + Math.sin(i / 19) * 1.3), 1.6); x.fillStyle = `rgb(${Math.round(120 * k)},${Math.round(14 * k)},${Math.round(26 * k)})`; x.fillRect(i, 0, 1, 256); }
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, "rgba(0,0,0,.35)"); g.addColorStop(0.25, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.25)"); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dw = fw * 1.08, dh = fh * 1.08;
  const drapeG = new THREE.PlaneGeometry(dw, dh, 28, 10);
  { const p = drapeG.attributes.position; for (let i = 0; i < p.count; i++) { const u = p.getX(i) / dw + 0.5, v = p.getY(i) / dh + 0.5; p.setZ(i, Math.sin(u * Math.PI * 14 + Math.sin(u * 7)) * 0.025 * (0.4 + 0.6 * (1 - v))); } drapeG.computeVertexNormals(); }
  const drapeM = new THREE.MeshLambertMaterial({ map: velvet, color: 0xffffff, transparent: true, opacity: 1 }); drapeM.onBeforeCompile = encode;
  const drapeMesh = new THREE.Mesh(drapeG, drapeM);
  const drapeHome = new THREE.Vector3(fc.x, fc.y + fh * 0.02, BACK + 0.2);
  drapeMesh.position.copy(drapeHome); drapeMesh.renderOrder = 2; scene.add(drapeMesh);
  let drapeOn = true, drapeT = 1;   // 1 covering, 0 off

  // ---- the chandelier: its cut-out hanging from the ceiling at its depth,
  // turned to the camera; a chain up to the ceiling
  const cut = (tex, rect, z, order = 3) => {
    const a = picZ(rect.fx[0], rect.fy[0], z), b = picZ(rect.fx[1], rect.fy[1], z);
    const w = b.x - a.x, h = a.y - b.y;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.04, depthWrite: true, fog: false }); m.onBeforeCompile = encode;
    const mesh = new THREE.Mesh(PL(w, h), m); mesh.position.y = h / 2; mesh.renderOrder = order;
    const g = new THREE.Group(); g.position.set((a.x + b.x) / 2, b.y, z); g.add(mesh); scene.add(g);
    g.userData = { yaw0: Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z), w, h };
    return { g, mesh, m };
  };
  const chand = cut(chandT, CHAND, CHAND.z, 4);
  chand.m.alphaTest = 0.02; chand.m.depthWrite = false;
  const chainTop = RH, chainBot = chand.g.position.y + chand.g.userData.h;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, chainTop - chainBot, 6), gold); chain.position.set(chand.g.position.x, (chainTop + chainBot) / 2, CHAND.z); scene.add(chain);
  for (const [u, v] of CHAND_FLAMES) flame(new THREE.Vector3((u - 0.5) * chand.g.userData.w, chand.g.userData.h * (1 - v), 0.02), 0.11, chand.g);

  // ---- the guests: each pair a cut-out at their own depth (their feet on the
  // floor), turned to the camera as it orbits; a slight sway; a tap: a toast
  const guests = Object.entries(CUTS).map(([k, r]) => {
    const feet = picFloor((r.fx[0] + r.fx[1]) / 2, r.feet);
    const c = cut(k === "l" ? gl : gr, { fx: r.fx, fy: [r.fy[0], r.fy[1]] }, feet.z, 3);
    // the cut-out's bottom on the floor at the feet's row
    c.g.position.y = picZ(0.5, r.fy[1], feet.z).y;
    const tm = new THREE.MeshBasicMaterial({ map: k === "l" ? glT : grT, transparent: true, opacity: 0, alphaTest: 0.04, depthWrite: false, fog: false }); tm.onBeforeCompile = encode;
    const toast = new THREE.Mesh(c.mesh.geometry, tm); toast.position.copy(c.mesh.position); toast.renderOrder = 3.5; c.g.add(toast);
    c.g.userData.kind = r.tap; c.g.userData.ph = k === "l" ? 0.4 : 2.1;
    return { ...c, toast, tm, kind: r.tap, pokeT: 9 };
  });

  // ---- life: candles flicker, the guests sway, the cut-outs face the camera
  let spotNow = 0, spotWant = 0, spotPokeT = 9;
  const camAt = new THREE.Vector3();
  function update(t, dt) {
    const still = reduce();
    camera.getWorldPosition(camAt);
    for (const s of flames) {
      const u = s.userData; u.poke += dt;
      const f = still ? 1 : 0.86 + 0.08 * Math.sin(t * 7.3 + u.ph) + 0.06 * Math.sin(t * 17.1 + u.ph * 2);
      const pk = u.poke < 1.1 && !still ? (Math.floor(u.poke * 14) % 3 === 0 ? 0.35 : 1.25) : 1;
      s.material.opacity = 0.5 * f * pk;
      s.scale.setScalar(u.base * (0.94 + 0.06 * f) * (pk > 1 ? 1.15 : 1));
    }
    for (const c of [chand, ...guests]) c.g.rotation.y = Math.atan2(camAt.x - c.g.position.x, camAt.z - c.g.position.z) - c.g.userData.yaw0;
    for (const gst of guests) {
      gst.pokeT += dt;
      gst.g.rotation.z = still ? 0 : Math.sin(t * 0.6 + gst.g.userData.ph) * 0.006;
      // the toast: crossfade to the glasses-up picture, hold, back
      const k = gst.pokeT < 2.4 ? Math.min(1, gst.pokeT / 0.22, (2.4 - gst.pokeT) / 0.3) : 0;
      gst.tm.opacity = k; gst.m.opacity = 1 - k * 0.999; gst.m.transparent = true;
    }
    // the spotlight: eases to where it's wanted; a tap stutters it
    spotPokeT += dt;
    spotNow += (spotWant - spotNow) * Math.min(1, dt * (spotWant > spotNow ? 18 : 3));
    const sk = spotPokeT < 0.9 && !still ? (Math.floor(spotPokeT * 15) % 3 === 1 ? 0.25 : 1.1) : 1;
    spotM.opacity = 0.34 * spotNow * sk; coneM.opacity = 0.012 * spotNow * sk;
    lampM.emissive.setRGB(0.35 * spotNow * sk, 0.28 * spotNow * sk, 0.18 * spotNow * sk);
    // the drape: slides down off the frame and fades as it goes
    drapeT += ((drapeOn ? 1 : 0) - drapeT) * Math.min(1, dt * (drapeOn ? 6 : 1.8));
    const off = 1 - drapeT;
    drapeMesh.position.set(drapeHome.x, drapeHome.y - off * dh * 1.05, drapeHome.z + off * 0.12);
    drapeMesh.scale.y = 1 - off * 0.25;
    drapeM.opacity = Math.min(1, drapeT * 2.2);
    drapeMesh.visible = drapeM.opacity > 0.01;
  }

  return {
    pr, update, chand, guests, sconces, flames, photoMesh, drapeMesh,
    photo: setPhoto,
    drape(on, { instant = false } = {}) { drapeOn = !!on; if (instant) drapeT = on ? 1 : 0; },
    spot(v) { spotWant = Math.max(0, Math.min(1, v)); },
    get drapeLevel() { return drapeT; },
    // the title plaques, where they hang under the frame, on screen (CSS px)
    plaqueRects() {
      const r = stage.canvas.getBoundingClientRect(), v = new THREE.Vector3();
      return PLAQUES.map(p => {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const fx of p.fx) for (const fy of p.fy) {
          v.copy(picZ(fx, fy, BACK + 0.02)).project(camera);
          const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
      });
    },
    targets: [
      { kind: "frame", objs: [photoMesh, drapeMesh] },
      { kind: "candle", objs: [...flames, ...sconces] },
      ...guests.map(g => ({ kind: g.kind, objs: [g.mesh] })),
    ],
    poke(kind, obj) {
      if (kind === "frame") spotPokeT = 0;
      if (kind === "candle") {
        // the nearest flame to the tap flickers (all of a sconce's, near enough)
        const p = obj ?? null;
        let best = null, bd = 1e9;
        for (const s of flames) { const w = s.getWorldPosition(new THREE.Vector3()); const d = p ? w.distanceTo(p) : 0; if (d < bd) { bd = d; best = s; } }
        for (const s of flames) if (s === best || (p && s.getWorldPosition(new THREE.Vector3()).distanceTo(p) < 0.35)) s.userData.poke = 0;
      }
      for (const g of guests) if (g.kind === kind) g.pokeT = 0;
    },
    dispose() { pr.dispose(); for (const t of [damask, wains, boards, folds, sheerT, chandT, gl, glT, gr, grT, glowT, spotT, coneTex, velvet]) t.dispose(); photoM.map?.dispose(); },
  };
}
