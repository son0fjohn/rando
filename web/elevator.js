// Manhunt's room: the inside of a brushed-steel elevator. Scratched steel
// walls, a steel handrail round the back and the side, a ceiling light
// panel, a red LED floor counter up on the back wall, a little red glow on
// the side wall. The Hunter leans on the back rail (hunter.js).
//
// How it's drawn: camera mapping (projroom.js), like the Ritual's basement:
// the cabin's walls, floor, ceiling and rails painted with the approved
// picture from its own camera (games/manhunt/elevator/plate.webp: the
// picture with him, his reflections and the dialog box taken out), so from
// the default view the room IS the picture. Walls the picture never saw
// take its own steel as a tile. The picture's camera stands well back (a
// long lens), so the cabin is built big enough that the look-around (±40°)
// stays inside it.
//
// Life on top of the paint: the floor counter is a live LED panel (it
// counts the floors down, or shows the round's clock), the light panel
// flickers now and then (and on a tap), and the doors: two steel leaves in
// front of the camera that slide shut and open (the elevator arriving).
//
//   const room = await elevatorRoom(stage);   // after retroStage(..., { encoded: true })
//   room.counter("B2") / room.flicker() / room.doors(open, { instant }) / room.update(t, dt)
//   room.targets  // [{ kind: "panel" | "light" | "counter", objs }]
import { THREE } from "./retrolook.js";
import { projRoom, loadTex } from "./projroom.js";
import { encode } from "./npcstage.js";

const ART = new URL("./games/manhunt/elevator/", import.meta.url).href;

// The picture's camera, solved from it (the two walls' vanishing points:
// the rails and the floor lines; the rails' height, the floor's corner).
// The cabin's own frame: the back wall is z = 0, the side wall x = 0, the
// corner where they meet is the picture's far corner; the room is turned so
// the camera looks down -z in the world (CABIN_TURN).
export const CABIN_TURN = 0.925;
export const PROJ = { pos: [-0.1817, 1.62, 3.9714], pitch: 0.1117, fov: 40.8, aspect: 9 / 16 };
// the cabin, in its own frame (metres): back wall z = 0, side wall x = 0
const CW = 4.0, CD = 3.6, CH = 2.48, RAIL = 0.87;
// the LED counter's corners on the back wall, where the picture has it
const COUNTER = { x0: -1.06, x1: -0.63, y0: 2.18, y1: 2.39 };
// cabin frame -> world
export const cabinToWorld = (x, y, z) => {
  const c = Math.cos(CABIN_TURN), s = Math.sin(CABIN_TURN);
  return new THREE.Vector3(x * c + z * s, y, -x * s + z * c);
};

export async function elevatorRoom(stage) {
  const { scene } = stage;
  const plate = await loadTex(`${ART}plate.webp`);
  const cabin = new THREE.Group(); cabin.rotation.y = CABIN_TURN; scene.add(cabin);
  const pr = projRoom(stage, PROJ, plate, { lightDir: [0.1, 0.9, 0.3] });
  const { paint, add, crop } = pr;
  const tile = (...r) => { const t = crop(...r); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const steel = tile(0.1, 0.3, 0.36, 0.52), floorT = tile(0.55, 0.92, 0.95, 0.99);
  const wallM = (w, h) => paint(new THREE.Color().setScalar(1.05), { map: steel, repeat: [w / 1.1, h / 1.6] });
  const P = (w, h) => new THREE.PlaneGeometry(w, h);
  const A = (geo, m, x, y, z, ry = 0, rx = 0, rz = 0) => add(geo, m, x, y, z, ry, rx, rz, cabin);

  // ---- the box
  A(P(CW, CD), paint(new THREE.Color(0.95, 0.92, 0.88), { map: floorT, repeat: [CW / 0.8, CD / 0.8] }), -CW / 2, 0, CD / 2, 0, -Math.PI / 2);
  A(P(CW, CD), paint(0x5a5550), -CW / 2, CH, CD / 2, 0, Math.PI / 2);
  A(P(CW, CH), wallM(CW, CH), -CW / 2, CH / 2, 0);                       // the back wall (the picture's left wall)
  A(P(CD, CH), wallM(CD, CH), 0, CH / 2, CD / 2, -Math.PI / 2);          // the side wall (the picture's right wall)
  A(P(CD, CH), wallM(CD, CH), -CW, CH / 2, CD / 2, Math.PI / 2);
  A(P(CW, CH), wallM(CW, CH), -CW / 2, CH / 2, CD, Math.PI);
  // the steel's panel seams (they read in the picture; these carry them round the sides)
  const seamM = paint(0x2e2a26);
  for (const x of [-1.21, -2.4, -3.4]) A(new THREE.BoxGeometry(0.012, CH, 0.01), seamM, x, CH / 2, 0.005);
  for (const z of [1.3, 2.5]) A(new THREE.BoxGeometry(0.01, CH, 0.012), seamM, -0.005, CH / 2, z);
  // ---- the handrails: steel tubes on short posts, round the back and the side
  const railM = paint(new THREE.Color(0.78, 0.76, 0.72), { map: steel, repeat: [6, 1] });
  const tube = (len) => new THREE.CylinderGeometry(0.022, 0.022, len, 10);
  A(tube(CW - 0.25), railM, -CW / 2 - 0.08, RAIL, 0.07, 0, 0, Math.PI / 2);
  A(tube(CD - 0.35), railM, -0.07, RAIL, CD / 2 + 0.05, 0, Math.PI / 2, 0);
  for (const x of [-0.3, -1.6, -2.9]) A(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6), railM, x, RAIL, 0.035, 0, Math.PI / 2, 0);
  for (const z of [0.3, 1.6, 2.9]) A(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6), railM, -0.035, RAIL, z, 0, 0, Math.PI / 2);
  // ---- the ceiling light panel (painted; the glow on top of it flickers)
  const light = A(new THREE.BoxGeometry(0.9, 0.02, 0.9), paint(0xf4ead8), -0.55, CH - 0.01, 0.48);
  const glowM = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), glowM); glow.rotation.x = Math.PI / 2; glow.position.set(-0.55, CH - 0.022, 0.48); cabin.add(glow);
  // ---- the LED floor counter: its housing is in the picture; the digits are live
  const ledCv = document.createElement("canvas"); ledCv.width = 256; ledCv.height = 112;
  const ledTex = new THREE.CanvasTexture(ledCv); ledTex.colorSpace = THREE.SRGBColorSpace;
  const ledM = new THREE.MeshBasicMaterial({ map: ledTex, transparent: true, depthWrite: false });
  ledM.onBeforeCompile = encode;
  const C = COUNTER, cw = C.x1 - C.x0, ch = C.y1 - C.y0;
  const led = new THREE.Mesh(new THREE.PlaneGeometry(cw * 0.86, ch * 0.62), ledM);
  led.position.set((C.x0 + C.x1) / 2 + cw * 0.03, (C.y0 + C.y1) / 2, 0.012); cabin.add(led);
  const ledHit = A(new THREE.BoxGeometry(cw, ch, 0.03), paint(0x302c2a), (C.x0 + C.x1) / 2, (C.y0 + C.y1) / 2, 0.006);
  let ledText = "", ledBlink = 0;
  function counter(text) {
    if (text === ledText) return;
    ledText = String(text ?? "");
    const x = ledCv.getContext("2d");
    x.clearRect(0, 0, 256, 112);
    x.fillStyle = "rgba(20,4,4,.92)"; x.fillRect(0, 0, 256, 112);
    // the dim unlit segments behind, then the lit ones
    x.font = "bold 92px 'DSEG7 Classic', 'Courier New', ui-monospace, monospace";
    x.textAlign = "right"; x.textBaseline = "middle";
    x.fillStyle = "rgba(120,20,16,.35)"; x.fillText("888", 244, 60);
    x.shadowColor = "rgba(255,60,40,.9)"; x.shadowBlur = 14;
    x.fillStyle = "#ff3a2a"; x.fillText(ledText.slice(-3), 244, 60);
    x.shadowBlur = 0;
    ledTex.needsUpdate = true;
  }
  counter("198");
  // ---- the doors: two leaves just in front of the camera, sliding apart
  // (they're in the world, not the cabin: they always frame the camera)
  const doorTex = tile(0.12, 0.2, 0.34, 0.6);
  const doorM = new THREE.MeshLambertMaterial({ map: doorTex, color: 0xb8b2aa }); doorM.onBeforeCompile = encode;
  const doorG = new THREE.Group(); scene.add(doorG);
  const leaves = [-1, 1].map(s => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.02), doorM);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.6, 0.025), new THREE.MeshBasicMaterial({ color: 0x1a1816 }));
    edge.position.x = -s * 0.244; m.add(edge);
    m.userData.side = s; doorG.add(m); return m;
  });
  let doorOpen = 1, doorWant = 1;
  function doors(open, { instant = false } = {}) { doorWant = open ? 1 : 0; if (instant) doorOpen = doorWant; }
  // ---- flicker
  let flickT = 9, nextFlick = 6 + Math.random() * 8;
  const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let level = 1;
  const painted = pr.statics.map(o => o.material);
  const cam = stage.camera;
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3();
  function update(t, dt) {
    const still = reduce();
    flickT += dt; nextFlick -= dt;
    if (nextFlick < 0) { nextFlick = 10 + Math.random() * 14; if (!still) flickT = 0; }
    // the light: a stutter (two quick dips) after a flick, otherwise steady
    level = flickT < 0.7 && !still ? (Math.floor(flickT * 18) % 4 === 1 ? 0.55 : flickT < 0.35 ? 0.82 : 0.95) : 1;
    for (const m of painted) m.uniforms?.mul.value.setScalar(level);
    glowM.opacity = 0.18 * level;
    // the counter blinks while the doors move (the car arriving)
    ledBlink += dt;
    ledM.opacity = doorOpen > 0.02 && doorOpen < 0.98 ? (Math.sin(ledBlink * 14) > 0 ? 1 : 0.4) : 1;
    // the doors: in front of the camera, facing it, sliding apart
    doorOpen += (doorWant - doorOpen) * Math.min(1, dt * (doorWant ? 2.6 : 3.4));
    cam.getWorldDirection(fwd);
    doorG.position.copy(cam.position).addScaledVector(fwd, 0.62);
    doorG.quaternion.copy(cam.quaternion);
    const k = 1 - (1 - doorOpen) ** 2;
    for (const m of leaves) m.position.set(m.userData.side * (0.25 + k * 0.52), 0, 0);
    doorG.visible = doorOpen < 0.995;
  }
  pr.refreshDepth();
  return {
    pr, cabin, update, counter, doors,
    flicker() { flickT = 0; },
    get level() { return level; },
    get doorOpen() { return doorOpen; },
    targets: [{ kind: "light", objs: [light] }, { kind: "counter", objs: [ledHit, led] }],
    poke(kind) { if (kind === "light") flickT = 0; },
    dispose() { pr.dispose(); steel.dispose(); floorT.dispose(); doorTex.dispose(); ledTex.dispose(); },
  };
}
