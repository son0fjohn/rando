// The Art Gallery's room: Seoul's most exclusive secret masquerade, an
// intimate candlelit gallery at night. Dark red damask walls and wood
// wainscot, heavy velvet curtains over tall windows, gold candle sconces, a
// dark polished wood floor, the big gold frame centred on the back wall
// with the player's photo in it, and under it, side by side, the two title
// plaques mounted on the wall. Bunny is the only one here.
//
// How it's drawn: camera mapping (projroom.js), like the Prophet's rooftop
// and the Boss's basement: simple shapes painted with the approved picture
// from its own camera, so the default view IS the picture. The paint
// (plate.webp) is the picture widened to a square (outpainted: more curtains
// and windows each side, for looking around), with a clean plate where
// Bunny, the picture's guests and chandelier (not in this room), the photo,
// the plaques and the dialog box were. What moves or stands in the room is
// its own layer on top:
//   - the photo: a plane in the frame's opening (cover-fit),
//   - the drape: red velvet over the frame that slides off on the unveil,
//   - the title plaques: 3D, on the wall under the frame, side by side: a
//     thin gold frame round a cream card, the text drawn sharp on a canvas
//     (a gold "TITLE I" tab, the title in italic serif, wrapped and shrunk
//     to fit); a velvet cover each that comes off after the frame's; tapped
//     to vote: a soft gold glow and a wax seal with a gold check; the
//     result lights the winner and dims the other,
//   - the spotlight on the frame, the candle flames' glow (they flicker).
// Walls the picture never saw (the sides) take tiles of it: damask above,
// wainscot below, a curtained window and two sconces.
//
//   const room = await galaRoom(stage);   // after retroStage(..., { encoded: true })
//   room.photo(url); room.drape(true|false, { instant }); room.spot(0..1);
//   room.plaque(i, { label, title, by, votes, win })   // what plaque i says (redrawn when it changes)
//   room.plaqueState({ covered, picked, top, instant }) // velvet on / my vote (0|1|null) / the winner (0|1|null)
//   room.plaqueRects() -> [{ left, top, width, height }, ...] (CSS px: where they are on screen)
//   room.showPlaques(false)                            // none on the wall (the Art Gallery floats its titles in front)
//   room.targets (taps: "frame", "candle", "plaque0", "plaque1") / room.update(t, dt) / room.poke(kind, point) / room.dispose()
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
const RW = 5.4, RF = 3.6, RH = 3.6;

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
// the plaques: side by side under the frame, on the wainscot
// (a little right of the frame's middle: Bunny stands at its left)
export const PLAQUES = [{ fx: [0.343, 0.553], fy: [0.548, 0.672] }, { fx: [0.567, 0.777], fy: [0.548, 0.672] }];
const FLAMES = [[0.139, 0.247], [0.228, 0.247], [0.772, 0.247], [0.859, 0.247]];   // the sconces' candles
const SCONCES = [{ fx: [0.105, 0.262], fy: [0.205, 0.335] }, { fx: [0.738, 0.895], fy: [0.205, 0.335] }];   // the back wall's two, to tap
export const FRAME_CENTRE = picZ(0.508, 0.333, BACK + 0.05);

export async function galaRoom(stage) {
  const { scene, camera } = stage;
  const L = new THREE.TextureLoader();
  const plate = await loadTex(`${ART}plate.webp`);
  const pr = projRoom(stage, PROJ_W, plate, { lightDir: [0.1, 0.8, 0.6], depthSize: [672, 672] });
  const { paint, add, crop } = pr;
  // a piece of the picture (fractions of the 9:16 picture) as a repeating tile
  const tile = (x0, y0, x1, y1) => { const t = crop(0.5 + (x0 - 0.5) * PIC_W, y0, 0.5 + (x1 - 0.5) * PIC_W, y1); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  // the wall left of the frame, under the sconce (mirrored, so it tiles without seams)
  const damask = tile(0.15, 0.36, 0.25, 0.52); damask.wrapS = damask.wrapT = THREE.MirroredRepeatWrapping;
  const DMW = 0.1 * 2.93, DMH = 0.16 * 5.2;                     // its size on the wall (m)
  const wains = tile(0.36, 0.57, 0.64, 0.7);                  // the centre wainscot panel
  const boards = tile(0.32, 0.86, 0.68, 0.98);                // the floor
  const folds = crop(0.035, 0.25, 0.1, 0.62); folds.wrapS = folds.wrapT = THREE.RepeatWrapping;   // the left curtain's folds
  const sheerT = crop(0.07, 0.3, 0.2, 0.6); sheerT.wrapS = sheerT.wrapT = THREE.RepeatWrapping;      // the window's sheers
  const tileM = (map, k, rep) => paint(new THREE.Color().setScalar(k), { map, repeat: rep });
  // the ceiling: dark wood coffers
  const coffer = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d");
    x.fillStyle = "#3a1d16"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "#24110d"; x.fillRect(14, 14, 100, 100);
    x.fillStyle = "#2e1611"; x.fillRect(24, 24, 80, 80);
    x.strokeStyle = "#5a3420"; x.lineWidth = 2; x.strokeRect(13, 13, 102, 102);
    // (the paint is display-ready: used as is, like the picture's own tiles)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const PL = (w, h) => new THREE.PlaneGeometry(w, h);
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const chairY = picZ(0.5, 0.535, BACK).y;                    // the wainscot's top on the back wall

  // ---- the room's shell
  const D = RF - BACK;
  add(PL(RW * 2, D), tileM(boards, 1.0, [RW * 2 / 1.1, D / 0.9]), 0, 0, (RF + BACK) / 2, 0, -Math.PI / 2);
  add(PL(RW * 2, D), tileM(coffer, 1, [RW * 2 / 1.2, D / 1.2]), 0, RH, (RF + BACK) / 2, 0, Math.PI / 2);
  // the back wall: damask above the wainscot, panels below (the picture paints the middle)
  add(PL(RW * 2, RH - chairY), tileM(damask, 1, [RW * 2 / DMW, (RH - chairY) / DMH]), 0, (RH + chairY) / 2, BACK);
  add(PL(RW * 2, chairY), tileM(wains, 0.95, [RW * 2 / 1.6, 1]), 0, chairY / 2, BACK);
  // a cornice round the top of the walls, a rail at the wainscot's top
  const corY = RH - 0.16, wood = paint(0x2a130e);
  add(B(RW * 2, 0.32, 0.1), wood, 0, corY, BACK + 0.05);
  add(B(RW * 2, 0.32, 0.1), wood, 0, corY, RF - 0.05);
  for (const s of [-1, 1]) {
    // the side walls: damask above the wainscot, panels below, skirting
    add(PL(D, RH - chairY), tileM(damask, 0.9, [D / DMW, (RH - chairY) / DMH]), s * RW, (RH + chairY) / 2, (RF + BACK) / 2, -s * Math.PI / 2);
    add(PL(D, chairY), tileM(wains, 0.85, [D / 1.6, 1]), s * RW, chairY / 2, (RF + BACK) / 2, -s * Math.PI / 2);
    add(B(0.04, 0.05, D), paint(0x3a1a12), s * (RW - 0.02), chairY, (RF + BACK) / 2);
    add(B(0.1, 0.32, D), wood, s * (RW - 0.05), corY, (RF + BACK) / 2);
    if (RW > 3) add(B(RW - 2.7, 0.05, 0.04), paint(0x3a1a12), s * (RW + 2.7) / 2, chairY, BACK + 0.02);
    // a tall curtained window on each side wall, like the back wall's
    const wz = -1.2;
    add(B(0.03, 2.5, 1.2), tileM(sheerT, 0.95, [1, 1]), s * (RW - 0.02), 1.55, wz);
    for (const dz of [-0.75, 0.75]) add(B(0.12, 2.9, 0.42), tileM(folds, 0.9, [1, 1]), s * (RW - 0.08), 1.6, wz + dz);
    add(B(0.16, 0.36, 1.95), tileM(folds, 0.8, [2, 0.4]), s * (RW - 0.1), 3.05, wz);
  }
  add(PL(RW * 2, RH), tileM(damask, 0.8, [RW * 2 / DMW, RH / DMH]), 0, RH / 2, RF, Math.PI);
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
  const spots = [];
  for (const s of [-1, 1]) {
    for (const z of [-2.2, -0.2]) spots.push([s * (RW - 0.03), z, -s * Math.PI / 2]);
    spots.push([s * 4.1, BACK + 0.03, 0]);                    // and the back wall's, past the picture's edge
  }
  for (const [px, z, ry] of spots) {
    const g = new THREE.Group(); g.position.set(px, 2.05, z); g.rotation.y = ry; scene.add(g);
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
  // the unveil it's lifted up off the frame (gathering as it goes) and is
  // gone; never down over the plaques
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
  // 1 covering, 0 off; eased on the clock, not the frames
  let drapeT = 1, dr = { from: 1, to: 1, at: 0, dur: 1 };

  // ---- the back wall's sconces, to tap (they're in the paint: a hit box each)
  const hitM = new THREE.MeshBasicMaterial({ visible: false });
  const sconceHits = SCONCES.map(r => {
    const a = picZ(r.fx[0], r.fy[0], BACK + 0.1), b = picZ(r.fx[1], r.fy[1], BACK + 0.1);
    const m = new THREE.Mesh(PL(b.x - a.x, a.y - b.y), hitM); m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, BACK + 0.1); scene.add(m); return m;
  });

  // ---- the title plaques: on the wall under the frame, side by side. A thin
  // gold frame round a cream card; the card's text is a canvas drawn at a
  // few times the size it shows, so it stays sharp; a velvet cover each
  const plGlowT = softDot([[0, "rgba(255,214,120,1)"], [0.45, "rgba(255,200,90,.55)"], [1, "rgba(255,180,60,0)"]]);
  // the wax seal: red wax, a ring pressed in it, a gold check
  const sealT = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
    x.translate(128, 128);
    x.beginPath();
    for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, r = 112 + Math.sin(a * 7) * 5 + Math.sin(a * 13 + 1) * 3; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    const g = x.createRadialGradient(-30, -36, 10, 0, 0, 120); g.addColorStop(0, "#c8342c"); g.addColorStop(0.6, "#8e1a1a"); g.addColorStop(1, "#5a0c0e");
    x.fillStyle = g; x.fill();
    x.lineWidth = 7; x.strokeStyle = "rgba(60,4,6,.55)"; x.beginPath(); x.arc(0, 0, 80, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = "rgba(255,150,130,.25)"; x.lineWidth = 3; x.beginPath(); x.arc(-2, -2, 84, Math.PI * 0.9, Math.PI * 1.6); x.stroke();
    x.lineCap = x.lineJoin = "round"; x.lineWidth = 26; x.strokeStyle = "#ffc83d"; x.shadowColor = "rgba(40,0,0,.6)"; x.shadowBlur = 8;
    x.beginPath(); x.moveTo(-44, 2); x.lineTo(-12, 36); x.lineTo(48, -34); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const SERIF = `Georgia, "Times New Roman", "Apple SD Gothic Neo", "Noto Serif KR", serif`;
  const plaques = PLAQUES.map((r, i) => {
    const a = picZ(r.fx[0], r.fy[0], BACK), b = picZ(r.fx[1], r.fy[1], BACK);
    const w = b.x - a.x, h = a.y - b.y, BW = 0.026;
    const g = new THREE.Group(); g.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, BACK + 0.012); scene.add(g);
    // the soft gold glow round it (my vote; the winner)
    const glowM = new THREE.MeshBasicMaterial({ map: plGlowT, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }); glowM.onBeforeCompile = encode;
    const glow = new THREE.Mesh(PL(w * 1.6, h * 2.1), glowM); glow.position.z = 0.002; glow.renderOrder = 0.6; g.add(glow);
    // the gold frame: four thin bevelled bars
    const goldM = new THREE.MeshLambertMaterial({ color: 0xc9973a, emissive: 0x3a2408 }); goldM.onBeforeCompile = encode;
    for (const [bw, bh, x, y] of [[w, BW, 0, (h - BW) / 2], [w, BW, 0, -(h - BW) / 2], [BW, h - BW * 2, -(w - BW) / 2, 0], [BW, h - BW * 2, (w - BW) / 2, 0]]) {
      const m = new THREE.Mesh(B(bw, bh, 0.03), goldM); m.position.set(x, y, 0.015); g.add(m);
    }
    // the card: the text drawn on a canvas
    const cw = w - BW * 2, ch = h - BW * 2;
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = Math.round(1024 * ch / cw);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const cardM = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, fog: false }); cardM.onBeforeCompile = encode;
    const card = new THREE.Mesh(PL(cw, ch), cardM); card.position.z = 0.012; g.add(card);
    // the velvet cover: hangs over it until after the frame's comes off
    const coverM = new THREE.MeshLambertMaterial({ map: velvet, color: 0xffffff, transparent: true, opacity: 1 }); coverM.onBeforeCompile = encode;
    const cover = new THREE.Mesh(PL(w * 1.06, h * 1.12), coverM); cover.position.z = 0.04; cover.renderOrder = 2; g.add(cover);
    // the wax seal: pressed on the top corner of the one you voted for
    const sealM = new THREE.MeshBasicMaterial({ map: sealT, transparent: true, opacity: 0, depthWrite: false, fog: false }); sealM.onBeforeCompile = encode;
    const seal = new THREE.Mesh(PL(h * 0.42, h * 0.42), sealM); seal.position.set(w / 2 - h * 0.12, h / 2 - h * 0.1, 0.05); seal.renderOrder = 2.5; g.add(seal);
    return { g, w, h, cv, tex, card, cardM, goldM, glow, glowM, cover, coverM, seal, sealM, key: "", coverT: 1, cv0: 1, cv1: 1, cvAt: 0, cvDur: 1, sealT: 9, lit: 1 };
  });
  // fit a title in the box: the biggest size from `max` down whose wrapped
  // lines fit, words broken where they don't fit a line at all
  const wrap = (x, text, size, maxW) => {
    x.font = `italic ${size}px ${SERIF}`;
    const lines = [];
    let cur = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const tryL = cur ? `${cur} ${word}` : word;
      if (x.measureText(tryL).width <= maxW) { cur = tryL; continue; }
      if (cur) lines.push(cur);
      cur = "";
      // a word longer than a line: in pieces
      let rest = word;
      while (x.measureText(rest).width > maxW) {
        let n = rest.length - 1;
        while (n > 1 && x.measureText(rest.slice(0, n)).width > maxW) n--;
        lines.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      cur = rest;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  function drawPlaque(p, { label = "", title = "", by = "", votes = "" }) {
    const x = p.cv.getContext("2d"), W = p.cv.width, H = p.cv.height;
    x.clearRect(0, 0, W, H);
    // cream card, a little darker toward the edges, a thin gold line inside
    const bg = x.createRadialGradient(W / 2, H * 0.45, H * 0.1, W / 2, H / 2, W * 0.62);
    bg.addColorStop(0, "#f3e8cd"); bg.addColorStop(1, "#d9c49b");
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.strokeStyle = "#b3873a"; x.lineWidth = 5; x.strokeRect(22, 22, W - 44, H - 44);
    // the gold tab: TITLE I
    x.font = `700 84px ${SERIF}`;
    const tw = x.measureText(label).width + 100, tx = (W - tw) / 2, ty = 44, th = 116;
    const tg = x.createLinearGradient(0, ty, 0, ty + th); tg.addColorStop(0, "#f1c45a"); tg.addColorStop(1, "#b88327");
    x.fillStyle = tg; x.beginPath(); x.roundRect(tx, ty, tw, th, 10); x.fill();
    x.strokeStyle = "#7a5418"; x.lineWidth = 3; x.stroke();
    x.fillStyle = "#3a230c"; x.textAlign = "center"; x.textBaseline = "middle";
    x.letterSpacing = "4px"; x.fillText(label, W / 2, ty + th / 2 + 2); x.letterSpacing = "0px";
    // the result: the author and the votes along the bottom
    const foot = by || votes ? 300 : 0;
    // the title: italic serif, as big as fits
    const top = ty + th + 20, bottom = H - 36 - foot, maxW = W - 110;
    const q = `“${title}”`;
    let size = foot ? 140 : 190, lines;
    for (; size >= 60; size -= 4) { lines = wrap(x, q, size, maxW); if (lines.length * size * 1.14 <= bottom - top) break; }
    x.font = `italic ${size}px ${SERIF}`; x.fillStyle = "#2a1a0e";
    const lh = size * 1.14, y0 = (top + bottom) / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, k) => x.fillText(l, W / 2, y0 + k * lh));
    if (foot) {
      x.strokeStyle = "rgba(122,84,24,.5)"; x.lineWidth = 3; x.beginPath(); x.moveTo(W * 0.3, H - 36 - foot + 6); x.lineTo(W * 0.7, H - 36 - foot + 6); x.stroke();
      x.font = `italic 600 124px ${SERIF}`; x.fillStyle = "#3a230c"; x.fillText(by, W / 2, H - 36 - foot + 92, maxW);
      x.font = `700 118px ${SERIF}`; x.fillStyle = "#7a4c10"; x.fillText(votes, W / 2, H - 36 - foot + 232, maxW);
    }
    p.tex.needsUpdate = true;
  }
  function setPlaque(i, c) {
    const p = plaques[i], key = JSON.stringify(c);
    if (!p || p.key === key) return;
    p.key = key; drawPlaque(p, c);
  }
  // covered: velvet on both; picked: my vote (a glow and the seal); top: the
  // winner, lit up (the other dims)
  const pst = { covered: true, picked: null, top: null };
  function plaqueState({ covered = pst.covered, picked = pst.picked, top = pst.top, instant = false } = {}) {
    const uncover = pst.covered && !covered, now = performance.now();
    plaques.forEach((p, i) => {
      // (on the clock, not the frames: a slow phone still unveils on time)
      const to = covered ? 1 : 0;
      if (instant) Object.assign(p, { coverT: to, cv0: to, cv1: to, cvAt: now, cvDur: 1 });
      else if (uncover) Object.assign(p, { cv0: p.coverT, cv1: 0, cvAt: now + 900 + i * 450, cvDur: 650 });   // after the frame's drape, one then the other
      else if (covered && p.cv1 !== 1) Object.assign(p, { cv0: p.coverT, cv1: 1, cvAt: now, cvDur: 150 });
      if (picked === i && pst.picked !== i) p.sealT = instant ? 9 : 0;
    });
    Object.assign(pst, { covered, picked, top });
  }
  function plaquesUpdate(t, dt, still) {
    plaques.forEach((p, i) => {
      // the cover slides down and fades, after its delay
      const kc = Math.max(0, Math.min(1, (performance.now() - p.cvAt) / p.cvDur));
      p.coverT = p.cv0 + (p.cv1 - p.cv0) * (kc * kc * (3 - 2 * kc));
      const off = 1 - p.coverT;
      p.cover.position.y = -off * p.h * 0.9; p.cover.scale.y = 1 - off * 0.3;
      p.coverM.opacity = Math.min(1, p.coverT * 2.4); p.cover.visible = p.coverM.opacity > 0.01;
      // lit / dimmed: the winner up, the other down
      const lit = pst.top === null ? 0.92 : pst.top === i ? 1.08 : 0.42;
      p.lit += (lit - p.lit) * Math.min(1, dt * 4);
      p.cardM.color.setScalar(p.lit);
      p.goldM.emissive.setRGB(0.23 * p.lit, 0.14 * p.lit, 0.03 * p.lit).multiplyScalar(pst.top === i ? 2.2 : 1);
      p.goldM.color.setRGB(0.79, 0.59, 0.23).multiplyScalar(Math.min(1, p.lit + 0.1));
      // the glow: soft on my vote, warm and full on the winner
      const pulse = still ? 1 : 0.85 + 0.15 * Math.sin(t * 2.4 + i);
      const gw = (pst.top === i ? 0.9 : pst.picked === i && pst.top === null ? 0.55 : 0) * (p.coverT < 0.5 ? 1 : 0);
      p.glowM.opacity += (gw * pulse - p.glowM.opacity) * Math.min(1, dt * 6);
      // the seal: pressed on (big and faint -> its size), stays while it's my vote
      p.sealT += dt;
      const on = pst.picked === i;
      const k = on ? Math.min(1, p.sealT / 0.18) : 0;
      p.sealM.opacity += ((on ? 1 : 0) * (on ? k : 1) - p.sealM.opacity) * (on ? 1 : Math.min(1, dt * 10));
      p.seal.scale.setScalar(on ? 1 + (1 - k) * 0.7 : 1);
      p.seal.rotation.z = -0.18;
    });
  }
  plaques.forEach((p, i) => drawPlaque(p, { label: `TITLE ${["I", "II"][i]}`, title: "" }));
  // a mesh's box on screen (CSS px)
  const screenRect = obj => {
    const r = stage.canvas.getBoundingClientRect(), v = new THREE.Vector3(), bb = new THREE.Box3().setFromObject(obj);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      v.set(x, y, z).project(camera);
      const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  };

  // ---- life: candles flicker, the spotlight, the drape, the plaques
  let spotNow = 0, spotWant = 0, spotPokeT = 9;
  function update(t, dt) {
    const still = reduce();
    for (const s of flames) {
      const u = s.userData; u.poke += dt;
      const f = still ? 1 : 0.86 + 0.08 * Math.sin(t * 7.3 + u.ph) + 0.06 * Math.sin(t * 17.1 + u.ph * 2);
      const pk = u.poke < 1.1 && !still ? (Math.floor(u.poke * 14) % 3 === 0 ? 0.35 : 1.25) : 1;
      s.material.opacity = 0.5 * f * pk;
      s.scale.setScalar(u.base * (0.94 + 0.06 * f) * (pk > 1 ? 1.15 : 1));
    }
    // the spotlight: eases to where it's wanted; a tap stutters it
    spotPokeT += dt;
    spotNow += (spotWant - spotNow) * Math.min(1, dt * (spotWant > spotNow ? 18 : 3));
    const sk = spotPokeT < 0.9 && !still ? (Math.floor(spotPokeT * 15) % 3 === 1 ? 0.25 : 1.1) : 1;
    spotM.opacity = 0.34 * spotNow * sk; coneM.opacity = 0.012 * spotNow * sk;
    lampM.emissive.setRGB(0.35 * spotNow * sk, 0.28 * spotNow * sk, 0.18 * spotNow * sk);
    // the drape: lifted up off the frame, gathering, and fading as it goes
    const kd = Math.max(0, Math.min(1, (performance.now() - dr.at) / dr.dur));
    drapeT = dr.from + (dr.to - dr.from) * (kd * kd * (3 - 2 * kd));
    const off = 1 - drapeT;
    drapeMesh.scale.y = 1 - off * 0.45;
    drapeMesh.position.set(drapeHome.x, drapeHome.y + off * dh * 0.75 + (1 - drapeMesh.scale.y) * dh / 2, drapeHome.z + off * 0.12);
    drapeM.opacity = Math.min(1, drapeT * 2.2);
    drapeMesh.visible = drapeM.opacity > 0.01;
    plaquesUpdate(t, dt, still);
  }

  return {
    pr, update, sconces, flames, photoMesh, drapeMesh, plaques,
    photo: setPhoto,
    drape(on, { instant = false } = {}) {
      const to = on ? 1 : 0;
      if (instant) { drapeT = to; dr = { from: to, to, at: 0, dur: 1 }; }
      else if (dr.to !== to) dr = { from: drapeT, to, at: performance.now(), dur: on ? 250 : 1100 };
    },
    spot(v) { spotWant = Math.max(0, Math.min(1, v)); },
    get drapeLevel() { return drapeT; },
    plaque: setPlaque,
    plaqueState,
    // the plaques on the wall, or not (the Art Gallery floats its titles in front instead)
    showPlaques(on) { plaques.forEach(p => { p.g.visible = !!on; }); },
    // the title plaques, where they are on screen (CSS px)
    plaqueRects: () => plaques.map(p => screenRect(p.card)),
    // what the plaques show, for the tests
    plaqueInfo: () => ({ texts: plaques.map(p => p.key), cover: plaques.map(p => +p.coverT.toFixed(2)), picked: pst.picked, top: pst.top, glow: plaques.map(p => +p.glowM.opacity.toFixed(2)), seal: plaques.map(p => +p.sealM.opacity.toFixed(2)), dim: plaques.map(p => +p.lit.toFixed(2)),
      // when the frame's drape and each cover start coming off (performance.now() ms)
      drapeAt: Math.round(dr.at), coverAt: plaques.map(p => Math.round(p.cvAt)) }),
    targets: [
      { kind: "frame", objs: [photoMesh, drapeMesh] },
      { kind: "candle", objs: [...flames, ...sconces, ...sconceHits] },
      ...plaques.map((p, i) => ({ kind: `plaque${i}`, objs: [p.g] })),
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
    },
    dispose() { pr.dispose(); for (const t of [damask, wains, boards, folds, sheerT, coffer, glowT, spotT, coneTex, velvet, plGlowT, sealT]) t.dispose(); photoM.map?.dispose(); for (const p of plaques) p.tex.dispose(); },
  };
}
