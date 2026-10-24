// Side Quest's room: a rooftop room (옥탑방) at night that teens have taken
// over. Graffiti and taped-up posters on every wall, string lights along the
// top, a TV glowing on the left, a couch with a big teddy bear, a sticker-
// covered fridge, a shelf of plants and junk, the door open onto the rooftop
// (laundry line, the city, a tower far off), and a low table covered in
// cans, chips, polaroids, a handheld, a controller, a laptop, a bowl of chips.
//
// How it's drawn: camera mapping (projroom.js): real low-poly geometry
// (walls, couch, teddy, TV, fridge, shelf, the door frame and the rooftop
// outside, the table and everything on it) painted with the approved
// picture from the default camera. Where the Prophet, the ball and the
// dialog box were in the picture, a clean plate (the same room with them
// painted out) is used, so they're never painted onto the room.
//
// The paint carries its own light, so these surfaces are unlit; only the
// lamp shade, the TV and the string lights get a little life on top. The
// Prophet himself is lit live by lights placed where the picture's are
// (rooftopLights).
//
//   const room = await rooftopRoom(stage);   // after retroStage(..., { encoded: true })
//   room.onTap / room.targets / room.lamp / room.update(t, dt) / room.refreshDepth()
import { THREE } from "./retrolook.js";
import { projRoom, loadTex, orbitProj } from "./projroom.js";

const ART = new URL("./games/sidequest/rooftop/", import.meta.url).href;
// the default camera, solved from the picture: where it stands, how far it
// looks down, its vertical field of view at 9:16
export const PROJ = { pos: [0, 1.02, 2.59], pitch: 0.204, fov: 46, aspect: 9 / 16 };
// the side views (left.webp, right.webp): the same room from the camera
// orbited round the table to the left and the right (the look-around's orbit)
export const SIDE_L = orbitProj(PROJ, 2.5, -0.785), SIDE_R = orbitProj(PROJ, 2.5, 0.785);
// the low table: top height, centre, size (metres)
export const TABLE = { y: 0.42, x: 0, z: 0.29, w: 1.06, d: 1.06 };
// the room box: half width, back wall, front wall, ceiling
const RW = 2.6, RB = -3.3, RF = 3.4, RH = 2.32;

export async function rooftopRoom(stage) {
  const { scene } = stage;
  const [plate, left, right, wallTile, rugTile] = await Promise.all([loadTex(`${ART}plate.webp`), loadTex(`${ART}left.webp`), loadTex(`${ART}right.webp`),
    loadTex(`${ART}wall.webp`, true), loadTex(`${ART}rug.webp`, true)]);
  const pr = projRoom(stage, PROJ, plate, { sides: [{ PROJ: SIDE_L, plate: left }, { PROJ: SIDE_R, plate: right }] });
  const { proj, paint, add, statics, crop, refreshDepth } = pr;
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const PL = (w, h) => new THREE.PlaneGeometry(w, h);
  const wallM = (repeat) => paint(new THREE.Color().setRGB(1.55, 1.3, 1.55), { map: wallTile, repeat });
  // ---- the room box: floor (the rug), ceiling, walls; the back wall has the doorway
  const DX0 = 0.53, DX1 = 1.345, DTOP = 1.9;   // the doorway
  add(PL(RW * 2, RF - RB), paint(0x9a8080, { map: rugTile, repeat: [5, 6] }), 0, 0, (RF + RB) / 2, 0, -Math.PI / 2);
  add(PL(RW * 2, RF - RB), paint(0x2c2230), 0, RH, (RF + RB) / 2, 0, Math.PI / 2);
  const rep = (w, h) => [w / 3.1, h / 0.77];
  add(PL(DX0 + RW, RH), wallM(rep(DX0 + RW, RH)), (DX0 - RW) / 2, RH / 2, RB);
  add(PL(RW - DX1, RH), wallM(rep(RW - DX1, RH)), (DX1 + RW) / 2, RH / 2, RB);
  add(PL(DX1 - DX0, RH - DTOP), wallM(rep(DX1 - DX0, RH - DTOP)), (DX0 + DX1) / 2, (RH + DTOP) / 2, RB);
  add(PL(RF - RB, RH), wallM(rep(RF - RB, RH)), -RW, RH / 2, (RF + RB) / 2, Math.PI / 2);
  add(PL(RF - RB, RH), wallM(rep(RF - RB, RH)), RW, RH / 2, (RF + RB) / 2, -Math.PI / 2);
  add(PL(RW * 2, RH), wallM(rep(RW * 2, RH)), 0, RH / 2, RF, Math.PI);
  // the door frame (blue-painted), the doorway's reveal
  const frameM = paint(0x3a5aa0);
  add(B(0.06, DTOP, 0.16), frameM, DX0, DTOP / 2, RB + 0.02); add(B(0.06, DTOP, 0.16), frameM, DX1, DTOP / 2, RB + 0.02);
  add(B(DX1 - DX0 + 0.06, 0.06, 0.16), frameM, (DX0 + DX1) / 2, DTOP, RB + 0.02);
  // ---- outside: the rooftop, its parapet, the city far off (laundry and sky are in the backdrop's paint)
  add(PL(9, 9), paint(0x2a2e48), 1.5, 0, RB - 4.5, 0, -Math.PI / 2);
  add(B(9, 0.8, 0.2), paint(0x34385a), 1.5, 0.4, -6.1);
  add(PL(30, 16), paint(0x1a2050, { side: THREE.DoubleSide }), 2, 5, -14);

  // ---- along the back: TV on its cabinet (left), the couch with the teddy, the fridge, the shelf
  const tv = add(B(0.78, 0.6, 0.07), paint(0x1a1830), -1.14, 1.34, -2.74);
  const tvScreen = add(PL(0.72, 0.53), paint(0x3a70c0), -1.14, 1.34, -2.703);
  add(B(0.95, 1.0, 0.42), paint(0x3a2838), -1.14, 0.5, -2.98);
  const couchM = paint(0x5a4a68);
  add(B(1.8, 0.4, 0.72), couchM, -0.6, 0.2, -2.02);           // seat
  add(B(1.8, 0.66, 0.22), couchM, -0.6, 0.72, -2.3);          // back
  add(B(0.18, 0.62, 0.72), couchM, -1.41, 0.31, -2.02); add(B(0.18, 0.62, 0.72), couchM, 0.21, 0.31, -2.02);   // arms
  const bearM = paint(0x8a5a38);
  add(new THREE.SphereGeometry(0.21, 12, 9), bearM, -0.64, 0.6, -1.98);       // the bear: body, head, ears, paws
  add(new THREE.SphereGeometry(0.15, 12, 9), bearM, -0.64, 0.9, -2.02);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.05, 8, 6), bearM, -0.64 + s * 0.11, 1.02, -2.04);
    add(new THREE.SphereGeometry(0.08, 8, 6), bearM, -0.64 + s * 0.21, 0.58, -1.9);
    add(new THREE.SphereGeometry(0.085, 8, 6), bearM, -0.64 + s * 0.12, 0.44, -1.8);
  }
  add(B(0.42, 1.3, 0.55), paint(0xc8c0c8), 0.2, 0.65, -2.98);          // the fridge
  const shelfM = paint(0x5a3828);
  add(B(0.6, 0.03, 0.26), shelfM, -0.37, 1.3, -3.17); add(B(0.6, 0.03, 0.26), shelfM, -0.37, 1.56, -3.17); add(B(0.6, 0.03, 0.26), shelfM, -0.37, 1.82, -3.17);
  add(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 8), paint(0x6a4a30), -0.55, 1.88, -3.15);    // a plant pot
  add(new THREE.SphereGeometry(0.11, 8, 6), paint(0x3a6040), -0.55, 2.0, -3.15);

  // ---- the low table and everything on it
  const T = TABLE, ty = T.y;
  const woodM = paint(0x5a3a30);
  add(B(T.w, 0.06, T.d), woodM, T.x, ty - 0.03, T.z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(B(0.08, ty - 0.06, 0.08), woodM, T.x + sx * (T.w / 2 - 0.08), (ty - 0.06) / 2, T.z + sz * (T.d / 2 - 0.08));
  const can = (r, h) => new THREE.CylinderGeometry(r, r, h, 12);
  add(can(0.034, 0.125), paint(0x3a80c0), -0.245, ty + 0.0625, 0.64);      // the blue can
  add(can(0.034, 0.125), paint(0x7a3a90), 0.155, ty + 0.0625, 0.54);       // the purple can
  add(can(0.03, 0.15), paint(0xd0b040), 0.34, ty + 0.03, 0.2, 0.3, 0, Math.PI / 2);    // lying cans
  add(can(0.032, 0.12), paint(0xb0b0b8), -0.46, ty + 0.032, 0.3, 1.2, 0, Math.PI / 2);
  add(can(0.032, 0.12), paint(0xa0a0a8), -0.38, ty + 0.032, 0.36, 0.5, 0, Math.PI / 2);
  add(B(0.18, 0.07, 0.11), paint(0xc04030), -0.13, ty + 0.04, 0.52, 0.25);  // the chips bag
  add(B(0.21, 0.025, 0.09), paint(0x202028), -0.31, ty + 0.0125, 0.72, 0.05);   // the handheld
  add(B(0.17, 0.014, 0.08), paint(0x9090a0), -0.43, ty + 0.007, 0.54, 0.1);   // a phone
  for (const [x, z, r] of [[-0.115, 0.742, 0.2], [0, 0.63, -0.1], [0.107, 0.642, 0.05], [-0.027, 0.768, -0.25]])
    add(B(0.085, 0.004, 0.1), paint(0xe0e0e0), x, ty + 0.002, z, r);      // polaroids
  add(B(0.17, 0.04, 0.09), paint(0x202028), 0.26, ty + 0.02, 0.69, -0.1);    // the controller
  const lapM = paint(0x606878);
  add(B(0.34, 0.02, 0.24), lapM, 0.26, ty + 0.01, 0.46, -0.45);             // the laptop: base, lid (stickers on its back)
  add(B(0.34, 0.24, 0.012), lapM, 0.42, ty + 0.13, 0.4, -0.45 - Math.PI / 2 + 0.6, -0.2);
  add(new THREE.CylinderGeometry(0.11, 0.07, 0.07, 14, 1, true), paint(0x3050a0, { side: THREE.DoubleSide }), 0.45, ty + 0.035, 0.57);   // the bowl
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), paint(0xd0a040), 0.45, ty + 0.06, 0.57);   // its chips

  // ---- the lamp on the table's left corner
  const lamp = new THREE.Group(); lamp.position.set(-0.5, ty, 0.42); scene.add(lamp);
  const lampBase = add(new THREE.CylinderGeometry(0.06, 0.08, 0.05, 12), paint(0x403030), 0, 0.025, 0, 0, 0, 0, lamp);
  const lampStem = add(new THREE.CylinderGeometry(0.015, 0.02, 0.16, 8), paint(0x403030), 0, 0.13, 0, 0, 0, 0, lamp);
  const shadeM = paint(0xf0d8b0, { side: THREE.DoubleSide });
  const lampShade = add(new THREE.CylinderGeometry(0.09, 0.13, 0.21, 16, 1, true), shadeM, 0, 0.31, 0, 0, 0, 0, lamp);

  // ---- string lights: the paint has the bulbs; small glows twinkle on them
  const glowTex = new THREE.CanvasTexture((() => {
    const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"), g = x.createRadialGradient(16, 16, 1, 16, 16, 16);
    g.addColorStop(0, "rgba(255,230,170,1)"); g.addColorStop(0.35, "rgba(255,200,120,.35)"); g.addColorStop(1, "rgba(255,180,100,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return c;
  })());
  const bulbs = [];
  for (const [fx, fy] of BULBS) {
    const p = pr.onPlane(fx, fy, RB + 0.03);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(p); s.scale.setScalar(0.07); s.userData.ph = Math.random() * 6.3; scene.add(s); bulbs.push(s);
  }

  // ---- the side walls and corners (the picture never saw them): posters,
  // tags, more string lights, crates, a beanbag, a mattress, a speaker
  const posterAt = (tx, x, y, z, w, h, ry) => add(PL(w, h), paint(new THREE.Color().setRGB(1.25, 1.15, 1.25), { map: tx }), x, y, z, ry);
  const P_CAT = crop(0.475, 0.055, 0.545, 0.155), P_FIG = crop(0.615, 0.05, 0.69, 0.14), P_PLANET = crop(0.54, 0.115, 0.6, 0.18);
  const P_TAG = crop(0.195, 0.0, 0.31, 0.06), P_TAG2 = crop(0.0, 0.06, 0.24, 0.105), P_TAG3 = crop(0.955, 0.3, 1.0, 0.46);
  posterAt(P_CAT, -RW + 0.01, 1.45, -1.6, 0.42, 0.6, Math.PI / 2); posterAt(P_TAG, -RW + 0.01, 1.9, -0.4, 0.9, 0.48, Math.PI / 2);
  posterAt(P_FIG, -RW + 0.01, 1.4, 0.7, 0.42, 0.55, Math.PI / 2); posterAt(P_TAG2, -RW + 0.01, 1.0, 1.8, 1.4, 0.6, Math.PI / 2);
  posterAt(P_PLANET, RW - 0.01, 1.5, -1.5, 0.4, 0.45, -Math.PI / 2); posterAt(P_TAG3, RW - 0.01, 1.2, -0.3, 0.5, 1.6, -Math.PI / 2);
  posterAt(P_CAT, RW - 0.01, 1.45, 0.9, 0.42, 0.6, -Math.PI / 2); posterAt(P_TAG, RW - 0.01, 1.95, 2.2, 0.9, 0.48, -Math.PI / 2);
  posterAt(P_TAG2, 0, 1.3, RF - 0.01, 1.6, 0.7, Math.PI); posterAt(P_FIG, 1.2, 1.4, RF - 0.01, 0.42, 0.55, Math.PI);
  const boxM = c => paint(new THREE.Color(c));
  add(B(0.5, 0.42, 0.45), boxM(0x8a6040), -RW + 0.3, 0.21, -0.6, 0.1); add(B(0.42, 0.34, 0.4), boxM(0x7a5236), -RW + 0.3, 0.59, -0.62, -0.15);
  add(B(0.36, 0.3, 0.36), boxM(0x9a6a44), -RW + 0.32, 0.15, 0.0, 0.3);
  const bean = add(new THREE.SphereGeometry(0.42, 14, 10), boxM(0x5a2e6a), -1.7, 0.22, 1.4); bean.scale.set(1, 0.55, 1);
  add(B(0.95, 0.16, 1.9), boxM(0x6a5a78), RW - 0.55, 0.08, 1.2); add(B(0.9, 0.06, 1.2), boxM(0x8a3a5a), RW - 0.56, 0.18, 1.5, 0.05);   // a floor mattress, a blanket
  add(new THREE.SphereGeometry(0.15, 10, 8), boxM(0xd8d0d8), RW - 0.5, 0.25, 0.42);                  // its pillow
  add(B(0.26, 0.5, 0.24), boxM(0x2a2430), RW - 0.25, 0.25, -0.9, -0.3);                            // a speaker
  add(B(0.5, 0.35, 0.4), boxM(0x7a5236), RW - 0.3, 0.17, -2.2, 0.2);
  const bulbGeo = new THREE.SphereGeometry(0.018, 6, 5), bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0 });
  const sideBulb = (x, y, z) => {
    const b = new THREE.Mesh(bulbGeo, bulbMat); b.position.set(x, y, z); scene.add(b);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z); s.scale.setScalar(0.12); s.userData.ph = Math.random() * 6.3; scene.add(s); bulbs.push(s);
  };
  for (let i = 0; i <= 10; i++) { const z = RB + 0.3 + i * (RF - RB - 0.6) / 10, sag = 0.06 * Math.sin((i % 2) * Math.PI / 2 + 0.5);
    sideBulb(-RW + 0.05, RH - 0.15 - sag, z); sideBulb(RW - 0.05, RH - 0.15 - sag, z); }
  for (let i = 0; i <= 8; i++) sideBulb(-RW + 0.3 + i * (RW * 2 - 0.6) / 8, RH - 0.15 - 0.05 * (i % 2), RF - 0.05);

  refreshDepth();

  // a little life: the lamp's glow, the TV, the bulbs; taps flicker them
  let lampPokeT = 9, tvPokeT = 9;
  const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function update(t, dt) {
    const still = reduce();
    lampPokeT += dt; tvPokeT += dt;
    const fl = lampPokeT < 0.9 && !still ? (Math.floor(lampPokeT * 16) % 3 === 1 ? 0.45 : 0.8 + 0.2 * Math.random()) : 1;
    shadeM.uniforms.mul.value.setScalar(fl);
    // the TV: a gentle flicker of the picture, a burst of static when tapped
    const tvk = still ? 1 : 0.94 + 0.06 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
    const st = tvPokeT < 0.6 && !still ? 0.6 + Math.random() * 0.9 : 1;
    tvScreen.material.uniforms.mul.value.set(tvk * st, tvk * st, tvk * (st > 1 ? st : 1));
    for (const b of bulbs) b.material.opacity = still ? 0.25 : 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.7 + b.userData.ph));
  }

  return {
    proj, statics, refreshDepth, update, lamp,
    // looking round from the left the lamp stands in front of the ball: fade it (0..1)
    lampFade(a) { pr.fade([lampBase, lampStem, lampShade], a); },
    targets: [{ kind: "lamp", objs: [lampBase, lampStem, lampShade] }, { kind: "tv", objs: [tv, tvScreen] }],
    poke(kind) { if (kind === "lamp") lampPokeT = 0; if (kind === "tv") tvPokeT = 0; },
    dispose() { pr.dispose(); wallTile.dispose(); rugTile.dispose(); glowTex.dispose(); },
  };
}

// the string-light bulbs in the picture (fractions), along the top of the back wall
const BULBS = [[0.025, 0.025], [0.083, 0.044], [0.146, 0.054], [0.21, 0.04], [0.33, 0.035], [0.39, 0.025], [0.465, 0.03],
  [0.505, 0.036], [0.565, 0.05], [0.64, 0.035], [0.705, 0.02], [0.76, 0.025], [0.82, 0.013], [0.92, 0.013]];
