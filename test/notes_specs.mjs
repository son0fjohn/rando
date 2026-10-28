// Notes, the pure parts, in node: the text filter (web/notefilter.js), the
// snapping, distances, the public-places rule and the lifespan maths
// (web/notegeo.js), and the JPEG metadata reader (web/noteimage.js).
// The SQL side: test/notes_sql.mjs. The real thing on the app page: test/notes_rec.mjs.
//   node test/notes_specs.mjs
import { checkNote, serverProblem, tokens, squash } from "../web/notefilter.js";
import { snap, distM, inRange, placeVerdict, spotFor, lifeEnd, isLandmark, NOTE_SPOTS, CELL_M } from "../web/notegeo.js";
import { hasMetadata, withExifGps, fitSize, stripSegments } from "../web/noteimage.js";

let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else fails++; console.log(`${c ? "  ✓" : "  ✗"} ${m}`); };
const head = t => console.log(`\n${t}`);
const why = (t, o) => checkNote(t, o).why;

head("The text filter: blocked (EN + KO)");
for (const [t, w] of [
  ["call me 010-1234-5678", "phone"], ["+82 10 1234 5678", "phone"], ["(555) 123-4567 anytime", "phone"], ["０１０１２３４５６７８", "phone"],
  ["mail me mina@gmail.com", "email"], ["mina (at) gmail (dot) com", "email"], ["MINA@NAVER.COM", "email"], ["mina＠gmail.com", "email"],
  ["n i g g e r", "slur"], ["you f4gg0t", "slur"], ["nigggggger", "slur"], ["retards everywhere", "slur"], ["re\u200Btard", "slur"],
  ["짱 깨 꺼져", "slur"], ["틀딱들 많네", "slur"], ["병신같은 곳", "slur"],
  ["Jake Miller is a creep", "name"], ["ask Dr. Kim", "name"], ["김민수씨 여기 자주 와요", "name"], ["박지영 대리 최악", "name"],
  ["works at Samsung", "company"], ["Acme Inc sucks", "company"], ["카카오 다니는 사람", "company"], ["(주)한빛 직원들", "company"], ["㈜한빛", "company"],
  ["", "empty"], ["   ", "empty"], ["x".repeat(201), "long"],
]) ok(why(t) === w, `${JSON.stringify(t.length > 40 ? t.slice(0, 40) + "…" : t)} -> ${w}${why(t) !== w ? ` (got ${why(t)})` : ""}`);

head("The text filter: fine");
for (const t of ["best tteokbokki on this street!!", "spicy raccoon in nigeria", "open 11-23, cash only", "meet at 7:30", "room 404", "2026년 10월 28일",
  "이번주 금요일 파티", "정말로 언니 최고", "good coffee @ the corner", "the sunset from here 🌇", "Lotte World Tower at night", "a cocktail named Apple Pie",
  "x".repeat(200), "Grand Ole Opry forever"]) ok(why(t, { allow: ["Lotte World Tower"] }) === null, `${JSON.stringify(t.length > 40 ? t.slice(0, 40) + "…" : t)} is fine`);
ok(why("Lotte World Tower at night") === "company" && why("Lotte World Tower at night", { allow: ["Lotte World Tower"] }) === null, "a spot's own name is allowed there (Lotte at Lotte World Tower)");
ok(serverProblem("Jake Miller") === null && serverProblem("works at Samsung") === null, "names and companies are the phone's check only (the server checks phone / email / slurs)");
ok(tokens("F4gg0t").join() === "faggot" && squash("n.i.g.g.e.r") === "nigger", "leetspeak and separators are undone (tokens, squash)");

head("Snapping and distances");
{
  const p = { lat: 37.5347123, lng: 126.9945678 }, s = snap(p.lat, p.lng);
  ok(distM(p, s) <= CELL_M * Math.SQRT1_2 + 0.01 && (s.lat !== p.lat || s.lng !== p.lng), `a spot snaps to its 20 m cell's centre (${distM(p, s).toFixed(1)} m away)`);
  ok(JSON.stringify(snap(s.lat, s.lng)) === JSON.stringify(s), "snapping twice = once");
  const n = { lat: p.lat + 1e-6, lng: p.lng + 1e-6 };
  ok(JSON.stringify(snap(n.lat, n.lng)) === JSON.stringify(s), "a step to the side lands in the same cell");
  const cells = new Set();
  for (let k = 0; k < 50; k++) { const q = snap(p.lat + k * 2 / 110540, p.lng); cells.add(`${q.lat},${q.lng}`); }
  ok(cells.size >= 4 && cells.size <= 6, `walking 100 m north crosses ~5 cells (${cells.size})`);
  ok(snap(91, 0) === null && snap(NaN, 1) === null, "nonsense positions don't snap");
  const a = { lat: 37.5347, lng: 126.9945 };
  ok(Math.abs(distM(a, { lat: a.lat + 80 / 110540, lng: a.lng }) - 80) < 0.01, "80 m north is 80 m");
  ok(inRange(a, { lat: a.lat, lng: a.lng + 70 / (111320 * Math.cos(a.lat * Math.PI / 180)) }) && !inRange(a, { lat: a.lat + 90 / 110540, lng: a.lng }), "in range at 70 m, not at 90 m");
  ok(spotFor(NOTE_SPOTS.find(x => x.id === "bolero"))?.id === "bolero" && spotFor({ lat: 0, lng: 0 }) === null, "spotFor finds the spot under a note, none in the sea");
}

head("Public places only");
{
  const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  ok(placeVerdict({ buildings: [] }).ok, "an empty street: fine");
  ok(placeVerdict({ buildings: [{ ring: sq(0, 0, 15), kind: "h" }] }).why === "residential", "on a house (h): refused");
  ok(placeVerdict({ buildings: [{ ring: sq(0, 0, 30), kind: "a" }] }).why === "residential", "on an apartment block (a): refused");
  ok(placeVerdict({ buildings: [{ ring: sq(0, 0, 15), kind: "res" }] }).why === "residential", "on Itaewon's hand-made res building: refused");
  ok(placeVerdict({ buildings: [{ ring: sq(0, 0, 15), kind: "c" }] }).ok && placeVerdict({ buildings: [{ ring: sq(0, 0, 15), kind: "shop" }] }).ok, "a shop / commercial building: fine (a public venue)");
  ok(placeVerdict({ buildings: [{ ring: sq(-9, 0, 4), kind: "h" }, { ring: sq(9, 0, 4), kind: "h" }] }).ok, "the street between two houses: fine");
  ok(placeVerdict({ buildings: [{ ring: [[-20, -20], [20, -20], [20, -1], [-20, -1]], kind: "a" }, { ring: [[-20, 1], [20, 1], [20, 20], [-20, 20]], kind: "a" }] }).why === "residential",
    "a yard boxed in by apartment blocks (most of the cell): refused");
  ok(placeVerdict({ buildings: [], areas: [{ ring: sq(0, 0, 50), kind: "residential" }] }).why === "residential", "inside a residential land-use area: refused");
  ok(placeVerdict({ buildings: [{ ring: sq(0, 0, 50), kind: "park" }], areas: [{ ring: sq(0, 0, 80), kind: "residential" }] }).ok, "a public building inside it: fine");
  ok(placeVerdict({ buildings: [{ ring: sq(6, 6, 2.5), kind: "h" }] }, [6, 6]).why === "residential", "the phone itself inside a house (even if the cell's centre isn't): refused");
}

head("Lifespan and landmarks (the labels; the SQL counts)");
{
  const t0 = Date.UTC(2026, 9, 1), now = t0 + 3600e3;
  ok(lifeEnd(t0, 0, false, now) === t0 + 7 * 864e5 && lifeEnd(t0, 0, true, now) === t0 + 10 * 864e5, "7 days, 10 at a spot");
  ok(lifeEnd(t0, 3, false, now) === t0 + 10 * 864e5 && lifeEnd(t0, -2, false, now) === t0 + 5 * 864e5, "±1 day per weighted net vote");
  ok(lifeEnd(t0, -9, false, now) === now, "never past now");
  ok(!isLandmark(24) && isLandmark(25) && isLandmark(20, true) && !isLandmark(19, true), "a landmark at 25 net (20 at a spot: ×1.25)");
}

head("JPEG metadata (noteimage.js hasMetadata)");
{
  // a minimal JPEG's segments as a canvas writes them: SOI, APP0 JFIF, DQT, SOS … EOI
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xdb, 0, 4, 0, 1, 0xff, 0xda, 0, 2, 0x12, 0x34, 0x47, 0x50, 0x53, 0xff, 0xd9]);
  const clean = hasMetadata(jfif);
  ok(clean.jpeg && !clean.any, "a canvas-style JPEG (APP0 JFIF only): no metadata");
  const dirty = hasMetadata(withExifGps(jfif));
  ok(dirty.app1 && dirty.exif && dirty.gps && dirty.any, "the same with a hand-built EXIF APP1 + GPS block: APP1, Exif and GPS all found");
  ok(!hasMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])).jpeg, "not a JPEG: says so");
  const icc = Uint8Array.from([...jfif.subarray(0, 20), 0xff, 0xe2, 0, 6, 0x49, 0x43, 0x43, 0x5f, ...jfif.subarray(20)]);
  ok(hasMetadata(icc).other.includes("APP2"), "a browser encoder's APP2 (its sRGB ICC profile) is seen");
  const st = stripSegments(withExifGps(icc));
  ok(!hasMetadata(st).any && st.length === jfif.length && st.every((v, k) => v === jfif[k]), "stripSegments drops APP1 (EXIF + GPS) and APP2, keeps APP0 and the image data byte for byte");
  ok(JSON.stringify(fitSize(4032, 3024)) === "[1280,960]" && JSON.stringify(fitSize(800, 600)) === "[800,600]", "1280 px on the long side at most, never upscaled");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
