// Who hears a line in the map's plaza chat (backend.js `pubchat`): the AREA.
// Itaewon's fixed launch zones are one plaza; anywhere else a line stays in
// its ~2.2 km auto-zone cell (migrations/008), the same cell presence snaps
// you to. A message's zone is set by the server from the sender's presence
// row (migrations/007), so its area can't be claimed. Pure (no DOM, no
// network): test/specs.js checks it.
//
//   areaOfZone("hamilton-alley")        -> "itaewon"
//   areaOfZone("auto_51p04_-114p08")    -> "auto_51p04_-114p08"
//   areaAt(lat, lng, zones)             -> the area there, worked out on the phone
//   inArea(msg, area)                   -> does this phone's feed show it

export const PLAZA = "itaewon";
export const SNAP_MAX_METERS = 3000;   // within this of a fixed zone you're in it
export const CELL_DEG = 0.02;          // the auto-zone grid (~2.2 km)

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// the coarse cell a position rounds to (what ensure_auto_zone accepts)
export function cellOf(lat, lng) {
  return { lat: Number((Math.round(lat / CELL_DEG) * CELL_DEG).toFixed(6)), lng: Number((Math.round(lng / CELL_DEG) * CELL_DEG).toFixed(6)) };
}

// the id ensure_auto_zone gives a cell: 'auto_' || replace(lat::text, '.', 'p') || '_' || replace(lng::text, '.', 'p')
// (Postgres prints a float8 the shortest way, as JavaScript does)
export function autoZoneId(cellLat, cellLng) {
  return `auto_${String(cellLat).replace(".", "p")}_${String(cellLng).replace(".", "p")}`;
}

// the on-device snap: the nearest fixed zone within reach, else the cell
export function snap(lat, lng, zones) {
  let best = null, bestD = Infinity;
  for (const z of zones) {
    if (z.kind === "auto") continue;
    const d = haversine(lat, lng, z.lat, z.lng);
    if (d < bestD) { best = z; bestD = d; }
  }
  if (best && bestD <= SNAP_MAX_METERS) return { zone: best };
  return { cell: cellOf(lat, lng) };
}

export function areaOfZone(zoneId) {
  return typeof zoneId === "string" && zoneId.startsWith("auto_") ? zoneId : PLAZA;
}

export function areaAt(lat, lng, zones) {
  const s = snap(lat, lng, zones);
  return s.zone ? PLAZA : autoZoneId(s.cell.lat, s.cell.lng);
}

export function inArea(msg, area) {
  return !!msg && !!area && areaOfZone(msg.zone_id) === area;
}
