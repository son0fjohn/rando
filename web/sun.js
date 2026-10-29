// Where the sun is, for the place the map shows: altitude and azimuth from
// latitude, longitude and the moment (the astronomer's formulas suncalc
// uses: mean anomaly, ecliptic longitude, declination, hour angle). A moment
// is a moment everywhere — UTC in, so the phone's clock and time zone don't
// matter: at 12:30 in Seoul the sun is high over Seoul whatever the phone
// thinks the hour is. No three.js, no DOM: the map, daylight.js and the
// tests read it.
const rad = Math.PI / 180;
const E = rad * 23.4397;                       // the Earth's tilt

// days since J2000.0 (2000-01-01 12:00 UTC)
const toDays = date => date.getTime() / 86400000 - 10957.5;

// the sun's place in the sky: altitude over the horizon and azimuth, both in
// degrees. azimuth is suncalc's (from south, positive toward the west);
// bearing is the compass one (from north, clockwise: 90 east, 270 west)
export function sunPosition(lat, lng, date = sunNow()) {
  const d = toDays(date), lw = rad * -lng, phi = rad * lat;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;    // ecliptic longitude
  const dec = Math.asin(Math.sin(L) * Math.sin(E));
  const ra = Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / rad;
  return { altitude: alt, azimuth: az, bearing: ((az + 180) % 360 + 360) % 360 };
}

// the sun's altitude over the horizon, in degrees (negative: below)
export const sunAltitude = (lat, lng, date = sunNow()) => sunPosition(lat, lng, date).altitude;

// the way to the sun as a unit vector in the map's frame (x east, y up,
// z south: the map's north is -z)
export function sunVector(lat, lng, date = sunNow()) {
  const { altitude, bearing } = sunPosition(lat, lng, date);
  const a = altitude * rad, b = bearing * rad;
  return [Math.cos(a) * Math.sin(b), Math.sin(a), -Math.cos(a) * Math.cos(b)];
}

// the map's light, 0 (night) to 1 (day): full day with the sun 6° up,
// full night at civil dusk (6° under), a smooth blend between — golden
// hour and dusk live in that band
export const lightFor = a => { const t = Math.min(1, Math.max(0, (a + 6) / 12)); return t * t * (3 - 2 * t); };
export const lightAt = (lat, lng, date = sunNow()) => lightFor(sunAltitude(lat, lng, date));

// the band a light is in, for the tests and the dev chip's label
export const phaseOf = t => t >= 0.98 ? "day" : t <= 0.02 ? "night" : t >= 0.5 ? "golden" : "dusk";

// "now" for the sun. The real moment, unless a test asks for another one:
// ?sunat=<ISO moment> starts the sun's clock there, ?sunspeed=N runs it N
// times faster (a sunset in a minute), globalThis.__sunClock = () => ms
// pins it frame by frame. Only the light reads this clock.
const Q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
const AT0 = Q?.get("sunat") ? Date.parse(Q.get("sunat")) : NaN;
const SPEED = Number(Q?.get("sunspeed")) || 1;
const WALL0 = Date.now();
export const sunClockFast = () => typeof globalThis.__sunClock === "function" || SPEED !== 1;
export function sunNow() {
  if (typeof globalThis.__sunClock === "function") return new Date(globalThis.__sunClock());
  if (!Number.isFinite(AT0) && SPEED === 1) return new Date();
  return new Date((Number.isFinite(AT0) ? AT0 : WALL0) + (Date.now() - WALL0) * SPEED);
}

// The baked shadows' sweep (STYLE.md 5.6) for a sun { altitude, bearing },
// as a world x,z offset per unit of k (k = min(52, 6 + 0.95 h)): away from
// the sun, longer as it sinks (the classic length at 59° up, 0.6× to 2.2×
// of it), in steps (10° round, a tenth of the length) so the map only
// re-sweeps them every half hour or so. No sun (night, a forced light):
// the classic sweep, (−0.52, 0.34).
export const SHADOW_CLASSIC = [-0.52, 0.34];
export function shadowSweep(sun) {
  if (!sun) return SHADOW_CLASSIC;
  const b = Math.round(sun.bearing / 10) * 10 * rad, alt = Math.max(10, sun.altitude) * rad;
  const len = Math.round(Math.min(2.2, Math.max(0.6, Math.tan(59 * rad) / Math.tan(alt))) * 10) / 10 * Math.hypot(...SHADOW_CLASSIC);
  return [-Math.sin(b) * len, Math.cos(b) * len];
}

// The place's own wall clock, for anything that shows a time of day (the
// light itself never needs one: it's the sun's real position). A small
// lookup of the zones the map is used in (their IANA names, so summer time
// is right, from the browser's own time-zone data: no network), else the
// longitude's nautical zone (UTC + round(lng / 15) h: within half an hour
// of the sun, no summer time).
const ZONES = [            // [south, west, north, east, zone]: first match wins
  [33.0, 124.0, 38.7, 129.6, "Asia/Seoul"], [37.0, 129.6, 37.9, 132.0, "Asia/Seoul"],
  [24.0, 122.9, 45.6, 146.0, "Asia/Tokyo"],
  [49.0, -120.0, 60.0, -110.0, "America/Edmonton"],    // Alberta: Calgary, Edmonton
  [48.3, -139.1, 60.0, -120.0, "America/Vancouver"],
];
export function zoneAt(lat, lng) {
  for (const [s, w, n, e, z] of ZONES) if (lat >= s && lat <= n && lng >= w && lng <= e) return z;
  return null;
}
export function localClock(lat, lng, date = sunNow()) {
  const zone = zoneAt(lat, lng);
  if (zone) {
    try {
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const h = +p.find(x => x.type === "hour").value, m = +p.find(x => x.type === "minute").value;
      return { zone, h, m, text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
    } catch {}
  }
  const off = Math.round(lng / 15), t = new Date(date.getTime() + off * 3600000);
  const h = t.getUTCHours(), m = t.getUTCMinutes();
  return { zone: `UTC${off >= 0 ? "+" : ""}${off}`, h, m, text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}
