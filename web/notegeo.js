// Notes on the map, the pure geometry (no DOM, no three.js): node specs, the
// SQL test and the stub server share it with web/notes.js.
//
//   snap(lat, lng)            -> the ~20 m cell's centre. A note is pinned there,
//                               and a reader's position is snapped the same way
//                               ON THE PHONE before it goes to the server (which
//                               snaps it again: migrations/019_notes.sql
//                               note_snap, the same maths)
//   distM(a, b)               -> metres between two spots (the app's flat-earth
//                               metres, like world3d's geoPos)
//   inRange(me, note)         -> within RANGE_M (80 m): open, vote, react
//   placeVerdict(...)         -> may a note be left in this cell? Public places
//                               only: never on a house or an apartment block
//   NOTE_SPOTS / spotFor()    -> the places the app already knows (the NPC
//                               spots, the venues and landmarks of
//                               data/heroes.json): a note within SPOT_M of
//                               one is a "spot note" (a longer life, its
//                               votes count more toward a landmark)

export const CELL_M = 20;        // the snap grid
export const RANGE_M = 80;       // how close you must be to open / vote / react
export const SPOT_M = 60;        // a note this close to a spot belongs to it
const M_LAT = 110540, M_LNG = 111320;
const RAD = Math.PI / 180;
const r6 = x => Math.round(x * 1e6) / 1e6;

// rows of CELL_M metres from the equator; columns of CELL_M metres along the
// row's own latitude, so a cell is ~20 x 20 m anywhere (and snapping twice
// is snapping once)
export function snap(lat, lng) {
  lat = Number(lat); lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  const dLat = CELL_M / M_LAT;
  const sLat = r6((Math.floor(lat / dLat) + 0.5) * dLat);
  const dLng = CELL_M / (M_LNG * Math.cos(sLat * RAD));
  const sLng = r6((Math.floor(lng / dLng) + 0.5) * dLng);
  return { lat: sLat, lng: sLng };
}

export function distM(a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot((a.lat - b.lat) * M_LAT, (a.lng - b.lng) * M_LNG * k);
}
export const inRange = (me, note) => !!me && !!note && distM(me, note) <= RANGE_M;

// a spot near (lat, lng) on the local metre plane, x east, y north
export function toLocal(origin, lat, lng) {
  return [(lng - origin.lng) * M_LNG * Math.cos(origin.lat * RAD), (lat - origin.lat) * M_LAT];
}

// ---------------------------------------------------------------- spots
// The places the app already knows. world3d.js ARCH_NPC_DEFS (the mascots'
// venues) and web/data/heroes.json (venues and landmarks), copied here so
// node, the SQL test and the stub read one list; the SQL's note_spots rows
// must match it, and it must cover both sources (test/notes_sql.mjs checks).
// Party beacons aren't spots: parties live in no table, so the server
// couldn't know them.
export const NOTE_SPOTS = [
  { id: "arch-chill", name: "Ikovox Cafe", lat: 37.5349347, lng: 126.9920648 },
  { id: "arch-chaos", name: "Grand Ole Opry", lat: 37.534086, lng: 126.996588 },
  { id: "arch-sporty", name: "Namsan 산스장", lat: 37.5496508, lng: 126.9933311 },
  { id: "hamilton-hotel", name: "Hamilton Hotel", lat: 37.534673, lng: 126.994076 },
  { id: "itaewon-crossing-east", name: "Itaewon Crossing", lat: 37.53455, lng: 126.99465 },
  { id: "itaewon-station", name: "Itaewon Station", lat: 37.534473, lng: 126.993752 },
  { id: "grand-ole-opry", name: "Grand Ole Opry", lat: 37.534086, lng: 126.996588 },
  { id: "jacks-bar", name: "Jack's Bar", lat: 37.535095, lng: 126.992379 },
  { id: "soap", name: "Soap", lat: 37.533878, lng: 126.99492 },
  { id: "danco", name: "Danco", lat: 37.534967, lng: 126.994581 },
  { id: "waikiki", name: "Waikiki", lat: 37.534966, lng: 126.994781 },
  { id: "agave", name: "Agave", lat: 37.53506, lng: 126.994291 },
  { id: "waikiki-beach-pub", name: "Waikiki Beach Pub", lat: 37.534855, lng: 126.993249 },
  { id: "bolero", name: "Bolero", lat: 37.534805, lng: 126.9985 },
  { id: "grainhaus", name: "Grainhaus", lat: 37.533733, lng: 126.99602 },
  { id: "lotte-world-tower", name: "Lotte World Tower", lat: 37.512559, lng: 127.102543 },
  { id: "n-seoul-tower", name: "N Seoul Tower", lat: 37.551169, lng: 126.988227 },
  { id: "coex", name: "COEX", lat: 37.5116, lng: 127.059 },
  { id: "gangnam-station", name: "Gangnam Station", lat: 37.497942, lng: 127.027621 },
  { id: "calgary-tower", name: "Calgary Tower", lat: 51.044344, lng: -114.063123 },
  { id: "muttart-conservatory", name: "Muttart Conservatory", lat: 53.535694, lng: -113.477306 },
  { id: "rogers-place", name: "Rogers Place", lat: 53.546944, lng: -113.497778 },
];
// the nearest spot within SPOT_M of a (snapped) note, or null
export function spotFor(p, spots = NOTE_SPOTS) {
  let best = null, bd = SPOT_M;
  for (const s of spots) { const d = distM(p, s); if (d <= bd) { bd = d; best = s; } }
  return best;
}

// ---------------------------------------------------------------- public places only
// Building kinds that are someone's home: the procedural city's h (house) and
// a (apartments) (citygen.js / cityomt.js / bake_city_tiles.py); Itaewon's
// hand-made buildings.json marks them cls "res". A land-use area of kind
// "residential" counts too (the baked data has none yet; ready if it comes).
export const HOME_KINDS = new Set(["h", "a", "res", "residential", "house", "apartments"]);
export const isHome = kind => HOME_KINDS.has(kind);

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The cell's 9 sample points (its centre and 8 round it, 7 m out) are each a
// home (inside a home's footprint, or in a residential area and in no other
// building) or not. A note is refused when the centre is a home, or most of
// the cell is (5 of 9: the yard between two apartment towers), or when the
// phone itself stands inside a home (`raw`, never sent). Streets, parks,
// plazas, shops, offices and civic buildings are all fine.
//   shapes: { buildings: [{ ring: [[x, y] metres from the cell centre], kind }],
//             areas: [{ ring, kind }] }
export function placeVerdict(shapes, raw = null) {
  const bs = shapes?.buildings ?? [], as = shapes?.areas ?? [];
  const at = (x, y) => {
    for (const b of bs) if (pointInRing(x, y, b.ring)) return isHome(b.kind) ? "home" : "public";
    for (const a of as) if (isHome(a.kind) && pointInRing(x, y, a.ring)) return "home";
    return "open";
  };
  const S = [[0, 0]];
  for (let k = 0; k < 8; k++) S.push([7 * Math.cos(k * Math.PI / 4), 7 * Math.sin(k * Math.PI / 4)]);
  const kinds = S.map(([x, y]) => at(x, y));
  const homes = kinds.filter(k => k === "home").length;
  if (raw && at(raw[0], raw[1]) === "home") return { ok: false, why: "residential", homes };
  if (kinds[0] === "home" || homes >= 5) return { ok: false, why: "residential", homes };
  return { ok: true, why: null, homes };
}

// ---------------------------------------------------------------- lifespan (mirrors the SQL; for labels only)
export const NOTE_RULES = {
  LIFE_DAYS: 7, SPOT_LIFE_DAYS: 10,       // a new note's life; a spot note's
  DAY_PER_VOTE: 1,                        // each weighted net vote: ±1 day (never past now)
  LANDMARK: 25, SPOT_VOTE_MUL: 1.25,      // weighted net (×1.25 at a spot) to become a permanent landmark
  PER_DAY: 5,                             // notes per player per UTC day
  COIN_EVERY: 5, COINS_PER_DAY: 10,       // 1 coin per 5 weighted net upvotes, 10 a day at most
  TEXT_MAX: 200, CAPTION_MAX: 60,
};
export function lifeEnd(createdMs, net, spot = false, nowMs = Date.now()) {
  const base = createdMs + ((spot ? NOTE_RULES.SPOT_LIFE_DAYS : NOTE_RULES.LIFE_DAYS) + net * NOTE_RULES.DAY_PER_VOTE) * 864e5;
  return Math.max(nowMs, base);
}
export const isLandmark = (net, spot = false) => net * (spot ? NOTE_RULES.SPOT_VOTE_MUL : 1) >= NOTE_RULES.LANDMARK;
