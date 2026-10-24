// The Ritual's room: a plain gray basement. A metal shelf with cardboard
// boxes and a yellow bin on the left, a gray door on the right, a table lamp
// on the left edge, a gray folding table across the bottom with a battered
// cardboard box full of colourful capsules, a glass ashtray and a paper
// coffee cup on it, and the folding chair The Boss sits in.
//
// How it's drawn: camera mapping (projroom.js), like Side Quest's rooftop
// room: simple low-poly shapes painted with the approved picture from its
// own camera, so from the default view the room IS the picture. Where The
// Boss, the crystal ball (gone from the final look) and the dialog box were,
// a clean plate is used. Walls the picture never saw fall back to the
// picture's own concrete, and a second shelf, stacked boxes and a fuse box
// finish the sides.
//
// Small life: a very subtle lamp flicker, a slow haze drifting through the
// light; a tap on the lamp flickers it, a tap on the box rattles it (the
// scene does the capsules), a tap on the cup is the scene's (he sips).
//
//   const room = await basementRoom(stage);   // after retroStage(..., { encoded: true })
//   room.targets / room.update(t, dt) / room.poke(kind) / room.box / room.cup / room.lampFade(a)
import { THREE } from "./retrolook.js";
import { projRoom, loadTex, orbitProj } from "./projroom.js";
import { encode, softDot } from "./npcstage.js";

const ART = new URL("./games/ritual/basement/", import.meta.url).href;
// the picture's camera, solved from it (door, floor line, table edge, the
// shelf): where it stands, how far it looks down, its vertical fov at 9:16
export const PROJ = { pos: [0, 1.53, 2.77], pitch: 0.2007, fov: 39.4, aspect: 9 / 16 };
// the side views (left.webp, right.webp): the same room from the camera
// orbited round the table to the left and the right (the look-around's orbit)
export const SIDE_L = orbitProj(PROJ, 3.0, -0.785), SIDE_R = orbitProj(PROJ, 3.0, 0.785);
// the folding table: top height, centre, size (metres), a slight turn
export const TABLE = { y: 0.74, x: 0, z: 0.0, w: 1.3, d: 1.0, ry: -0.06 };
// the capsule box on it (front face, size), the cup, the ashtray, the lamp
export const BOX = { x: 0.115, z: -0.28, w: 0.56, d: 0.34, h: 0.24 };
export const CUP = { x: 0.414, z: 0.133, h: 0.2 };
export const ASHTRAY = { x: -0.267, z: -0.06 };
export const LAMP = { x: -0.48, z: 0.3 };
// where the chair is in the picture (he sits on its right-hand part)
export const CHAIR = { x: -0.2, z: -0.72, seatY: 0.46 };
// the room box: half width, back wall, front wall, ceiling
const RW = 3.2, RB = -5.32, RF = 3.6, RH = 2.75;

export async function basementRoom(stage) {
  const { scene } = stage;
  const [plate, empty, left, right] = await Promise.all([loadTex(`${ART}plate.webp`), loadTex(`${ART}empty.webp`), loadTex(`${ART}left.webp`), loadTex(`${ART}right.webp`)]);
  // two layers: the room's shell is painted from the empty room (empty.webp:
  // the picture with the table, chair, lamp and what's on the table taken
  // out), the furniture from the picture itself, so looking around nothing
  // of the furniture is ever smeared on the floor or the wall behind it
  const pr = projRoom(stage, PROJ, plate, { shell: empty, lightDir: [-0.35, 0.85, 0.4], sides: [{ PROJ: SIDE_L, plate: left }, { PROJ: SIDE_R, plate: right }] });
  const { paint, add, crop } = pr;
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const PL = (w, h) => new THREE.PlaneGeometry(w, h);
  const CY = (rt, rb, h, n = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, n, 1, open);
  // the picture's own concrete, as a tile for the walls it never saw
  const tile = (...r) => { const t = crop(...r); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const concrete = tile(0.5, 0.12, 0.64, 0.34);   // the plain wall between the shelf and the door
  // …and for the sides of things it never saw: its cardboard, its table top
  const cardboard = tile(0.42, 0.52, 0.74, 0.585), steel = tile(0.42, 0.615, 0.64, 0.665);
  const wallM = (w, h) => paint(new THREE.Color().setScalar(1.2), { map: concrete, repeat: [w / 0.9, h / 1.2], shell: true });   // × the fallback's soft shade
  // the shell (walls, floor, ceiling, the door and what stands against the walls)…
  const grayM = c => paint(new THREE.Color(c), { shell: true });
  // a tile of the picture, times a tint (1 = as is), on the shell or the furniture
  const tileM = (map, k = 1, rep = [1, 1], shell = true) => paint(new THREE.Color().setScalar(k), { map, repeat: rep, shell });
  // …and the furniture (painted from the picture; where it never saw a side, a tile of it)
  const propM = (c, o = {}) => paint(new THREE.Color(c), o);

  // ---- the box: floor, ceiling, walls; a bulkhead along the top right of the back wall
  add(PL(RW * 2, RF - RB), grayM(0x6e6a68), 0, 0, (RF + RB) / 2, 0, -Math.PI / 2);
  add(PL(RW * 2, RF - RB), tileM(concrete, 1.05, [RW * 2 / 0.9, (RF - RB) / 1.2]), 0, RH, (RF + RB) / 2, 0, Math.PI / 2);
  add(PL(RW * 2, RH), wallM(RW * 2, RH), 0, RH / 2, RB);
  add(PL(RF - RB, RH), wallM(RF - RB, RH), -RW, RH / 2, (RF + RB) / 2, Math.PI / 2);
  add(PL(RF - RB, RH), wallM(RF - RB, RH), RW, RH / 2, (RF + RB) / 2, -Math.PI / 2);
  add(PL(RW * 2, RH), wallM(RW * 2, RH), 0, RH / 2, RF, Math.PI);
  add(B(RW, RH - 2.17, 0.4), tileM(concrete, 1.15, [RW / 0.9, 1]), RW / 2, (RH + 2.17) / 2, RB + 0.2);
  for (const [w, x, z, ry] of [[RW * 2, 0, RB + 0.02, 0], [RF - RB, -RW + 0.02, (RF + RB) / 2, Math.PI / 2], [RF - RB, RW - 0.02, (RF + RB) / 2, Math.PI / 2]])
    add(B(w, 0.08, 0.03), grayM(0x3a3636), x, 0.04, z, ry);   // skirting

  // ---- the door (back wall, right): frame, slab, its small window, the knob
  const DX = 1.06;
  add(B(0.85, 2.03, 0.08), grayM(0x3a3d42), DX, 1.015, RB + 0.04);
  add(B(0.74, 1.96, 0.05), grayM(0x40444a), DX, 0.98, RB + 0.09);
  add(B(0.24, 0.47, 0.02), grayM(0x26282c), 1.093, 1.46, RB + 0.12);
  add(new THREE.SphereGeometry(0.035, 10, 8), grayM(0x8a8c90), 1.34, 0.97, RB + 0.15);

  // ---- the metal shelf (back wall, left): boards, posts, boxes, the yellow bin
  const shelf = new THREE.Group(); shelf.position.set(-1.5, 0, RB + 0.27); scene.add(shelf);
  const cardOf = c => (c === 0x8a6a48 || c === 0x7a5c3e ? tileM(cardboard, c === 0x8a6a48 ? 1.05 : 0.88) : grayM(c));
  const sAdd = (geo, c, x, y, z) => add(geo, cardOf(c), x, y, z, 0, 0, 0, shelf);
  for (const x of [-0.65, 0.65]) for (const z of [-0.22, 0.22]) sAdd(B(0.045, 2.12, 0.045), 0x2e3034, x, 1.06, z);
  for (const y of [0.1, 0.42, 0.88, 1.6]) sAdd(B(1.34, 0.04, 0.48), 0x3a3c40, 0, y, 0);
  sAdd(B(0.62, 0.46, 0.42), 0x8a6a48, 0.32, 1.85, 0); sAdd(B(0.5, 0.4, 0.4), 0x7a5c3e, -0.3, 1.82, 0.01);
  sAdd(B(0.6, 0.44, 0.44), 0xb09a30, 0.3, 1.12, 0); sAdd(B(0.62, 0.04, 0.46), 0xa08c28, 0.3, 1.36, 0);   // the bin and its lid
  sAdd(B(0.5, 0.34, 0.4), 0x7a5c3e, -0.32, 1.07, 0.01);
  sAdd(B(0.58, 0.4, 0.42), 0x7a5c3e, 0.32, 0.64, 0); sAdd(B(0.5, 0.36, 0.4), 0x8a6a48, -0.3, 0.62, 0.01);
  sAdd(B(0.6, 0.3, 0.4), 0x8a6a48, 0, 0.27, 0);
  // the sides (seen looking around): another shelf of boxes, a stack of boxes, a fuse box and its conduit
  const shelf2 = new THREE.Group(); shelf2.position.set(-RW + 0.3, 0, -2.4); shelf2.rotation.y = Math.PI / 2; scene.add(shelf2);
  const s2 = (geo, c, x, y, z) => add(geo, cardOf(c), x, y, z, 0, 0, 0, shelf2);
  for (const x of [-0.65, 0.65]) for (const z of [-0.22, 0.22]) s2(B(0.045, 2.12, 0.045), 0x2e3034, x, 1.06, z);
  for (const y of [0.1, 0.62, 1.14, 1.66]) s2(B(1.34, 0.04, 0.48), 0x3a3c40, 0, y, 0);
  for (const [x, y, c] of [[-0.3, 0.3, 0x7a5c3e], [0.32, 0.32, 0x8a6a48], [-0.32, 0.84, 0x8a6a48], [0.3, 1.34, 0x7a5c3e], [-0.28, 1.86, 0x8a6a48]]) s2(B(0.52, 0.38, 0.4), c, x, y, 0);
  s2(B(0.56, 0.4, 0.44), 0xb09a30, 0.32, 0.84, 0);
  for (const [x, y, z, s, c] of [[RW - 0.45, 0.22, -2.7, 0.5, 0x8a6a48], [RW - 0.42, 0.66, -2.68, 0.42, 0x7a5c3e], [RW - 0.48, 0.2, -2.05, 0.4, 0x7a5c3e], [-RW + 0.4, 0.2, 0.9, 0.4, 0x8a6a48]])
    add(B(s * 1.2, s, s), cardOf(c), x, y, z, 0.1);
  add(B(0.12, 0.56, 0.42), grayM(0x55585c), RW - 0.06, 1.55, -0.9);
  add(B(0.04, 1.2, 0.04), grayM(0x4a4d51), RW - 0.03, 2.4, -0.9);

  // ---- the folding chair he sits in
  const chair = new THREE.Group(); chair.position.set(CHAIR.x, 0, CHAIR.z); scene.add(chair);
  const cAdd = (geo, x, y, z, rx = 0) => add(geo, propM(0x423c3c), x, y, z, 0, rx, 0, chair);
  cAdd(B(0.6, 0.05, 0.44), 0, CHAIR.seatY, 0);
  cAdd(B(0.62, 0.3, 0.04), 0, 0.87, -0.24, -0.1);
  for (const sx of [-1, 1]) { cAdd(B(0.03, 1.02, 0.03), sx * 0.28, 0.5, -0.22, 0.06); cAdd(B(0.03, 0.55, 0.03), sx * 0.28, 0.24, 0.18, -0.2); }

  // ---- the folding table and everything on it
  const T = TABLE, ty = T.y;
  const table = new THREE.Group(); table.position.set(T.x, 0, T.z); table.rotation.y = T.ry; scene.add(table);
  const tAdd = (geo, c, x, y, z, rx = 0) => add(geo, propM(c), x, y, z, 0, rx, 0, table);
  add(B(T.w, 0.05, T.d), tileM(steel, 1, [T.w / 0.35, T.d / 0.35], false), 0, ty - 0.025, 0, 0, 0, 0, table);
  add(B(T.w - 0.06, 0.07, T.d - 0.06), tileM(steel, 0.62, [T.w / 0.35, 1], false), 0, ty - 0.085, 0, 0, 0, 0, table);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tAdd(B(0.035, 0.76, 0.035), 0x3a3533, sx * (T.w / 2 - 0.12), 0.36, sz * 0.24, sz * 0.3);
  for (const sx of [-1, 1]) tAdd(B(0.025, 0.025, 0.5), 0x3a3533, sx * (T.w / 2 - 0.12), 0.3, 0);
  // the capsule box: an open cardboard box; the capsules are a mound in it
  const box = new THREE.Group(); box.position.set(BOX.x, ty, BOX.z); scene.add(box);
  const cardM = tileM(cardboard, 1, [1, 1], false);
  const bw = BOX.w, bd = BOX.d, bh = BOX.h, th = 0.012;
  for (const [w, d, x, z] of [[bw, th, 0, bd / 2], [bw, th, 0, -bd / 2], [th, bd, bw / 2, 0], [th, bd, -bw / 2, 0]]) add(B(w, bh, d), cardM, x, bh / 2, z, 0, 0, 0, box);
  add(B(bw, th, bd), cardM, 0, th / 2, 0, 0, 0, 0, box);
  // the capsules: a heap of little balls (each keeps the picture's paint
  // from the front; their far sides are capsule colours)
  const capCols = [0x5c6a8a, 0x7a5e6c, 0x7a6e52, 0x5c705c, 0x685c82];   // the picture's capsules: soft, not candy
  const capG = new THREE.SphereGeometry(0.046, 10, 7), mound = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    const x = -bw / 2 + 0.05 + i * (bw - 0.1) / 5 + (j % 2) * 0.02, z = -bd / 2 + 0.06 + j * (bd - 0.12) / 2;
    mound.push(add(capG, propM(capCols[(i * 3 + j) % capCols.length]), x, bh - 0.04 + ((i * 7 + j * 3) % 4) * 0.008, z, 0, 0, 0, box));
  }
  // the glass ashtray: an octagon with a shallow well; the paper cup and its lid
  const ash = add(CY(0.105, 0.11, 0.05, 8), propM(0x6a6866), ASHTRAY.x, ty + 0.025, ASHTRAY.z, Math.PI / 8);
  const cup = new THREE.Group(); cup.position.set(CUP.x, ty, CUP.z); scene.add(cup);
  add(CY(0.064, 0.054, CUP.h - 0.03, 14), propM(0x574232), 0, (CUP.h - 0.03) / 2, 0, 0, 0, 0, cup);
  add(CY(0.07, 0.07, 0.03, 14), propM(0x2a2a2c), 0, CUP.h - 0.015, 0, 0, 0, 0, cup);
  // the lamp on the table's left corner: base, stem, a square shade
  const lamp = new THREE.Group(); lamp.position.set(LAMP.x, ty, LAMP.z); scene.add(lamp);
  const lampBase = add(CY(0.075, 0.095, 0.06, 14), propM(0x3a3c40), 0, 0.03, 0, 0, 0, 0, lamp);
  const lampStem = add(CY(0.02, 0.028, 0.22, 10), propM(0x3a3c40), 0, 0.16, 0, 0, 0, 0, lamp);
  const shadeM = paint(0xe4d0b0, { side: THREE.DoubleSide });
  const lampShade = add(CY(0.095, 0.13, 0.23, 4, true), shadeM, 0, 0.375, 0, Math.PI / 4, 0, 0, lamp);
  const lampCap = add(CY(0.095, 0.095, 0.004, 4), shadeM, 0, 0.49, 0, Math.PI / 4, 0, 0, lamp);
  pr.refreshDepth();

  // ---- haze: a few big soft sprites drifting slowly through the light
  const hazeTex = softDot([[0, "rgba(255,255,255,.55)"], [0.5, "rgba(255,255,255,.18)"], [1, "rgba(255,255,255,0)"]]);
  const haze = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, color: 0xd8d4cc, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    s.material.onBeforeCompile = encode;
    s.userData = { x: -1.4 + i * 0.5, y: 1.2 + (i % 3) * 0.35, z: -1.6 - (i % 4) * 0.6, ph: i * 1.7, sp: 0.02 + (i % 3) * 0.008 };
    s.scale.setScalar(1.6 + (i % 3) * 0.5); s.renderOrder = 6; scene.add(s); haze.push(s);
  }

  // a little life: the lamp's flicker, the haze; taps flicker the lamp
  let lampPokeT = 9, boxPokeT = 9;
  const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let lampNow = 1;
  function update(t, dt) {
    const still = reduce();
    lampPokeT += dt; boxPokeT += dt;
    // very subtle: a slow breath of the bulb, now and then a tiny dip; a tap makes it stutter
    const base = still ? 1 : 1 - 0.025 * Math.max(0, Math.sin(t * 0.7) * Math.sin(t * 2.3 + 1)) - (Math.sin(t * 13.1) > 0.995 ? 0.06 : 0);
    const fl = lampPokeT < 0.9 && !still ? (Math.floor(lampPokeT * 16) % 3 === 1 ? 0.5 : 0.8 + 0.2 * Math.random()) : base;
    lampNow = fl;
    shadeM.uniforms.mul.value.setScalar(fl);
    for (const s of haze) {
      const u = s.userData;
      const x = u.x + (still ? 0 : Math.sin(t * u.sp + u.ph) * 0.5), y = u.y + (still ? 0 : Math.sin(t * u.sp * 1.3 + u.ph) * 0.12);
      s.position.set(x, y, u.z);
      s.material.opacity = 0.035 + 0.02 * Math.sin(t * 0.21 + u.ph);
    }
    // the box shivers when it's rattled
    const k = boxPokeT < 0.5 && !still ? Math.sin(boxPokeT * 60) * 0.006 * (1 - boxPokeT / 0.5) : 0;
    box.position.x = BOX.x + k; box.rotation.y = k * 1.5;
  }

  return {
    pr, update, lamp, box, mound, cup, chair, ash,
    get lampLevel() { return lampNow; },
    // looking round from the left the lamp stands in front of him: fade it (0..1)
    lampFade(a) { pr.fade([lampBase, lampStem, lampShade, lampCap], a); },
    targets: [{ kind: "lamp", objs: [lampBase, lampStem, lampShade, lampCap] }, { kind: "box", objs: [box] }, { kind: "cup", objs: [cup] }],
    poke(kind) { if (kind === "lamp") lampPokeT = 0; if (kind === "box") boxPokeT = 0; },
    dispose() { pr.dispose(); concrete.dispose(); cardboard.dispose(); steel.dispose(); hazeTex.dispose(); },
  };
}
