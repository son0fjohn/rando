// Where the sun is, for the place the map shows: altitude from latitude,
// longitude and the moment (the astronomer's formulas suncalc uses: mean
// anomaly, ecliptic longitude, declination, hour angle). A moment is a
// moment everywhere — UTC in, so the phone's clock and time zone don't
// matter: at 12:30 in Seoul the sun is high over Seoul whatever the phone
// thinks the hour is. No three.js, no DOM: the map, daylight.js and the
// tests read it.
const rad = Math.PI / 180;
const E = rad * 23.4397;                       // the Earth's tilt

// days since J2000.0 (2000-01-01 12:00 UTC)
const toDays = date => date.getTime() / 86400000 - 10957.5;

// the sun's altitude over the horizon, in degrees (negative: below)
export function sunAltitude(lat, lng, date = new Date()) {
  const d = toDays(date), lw = rad * -lng, phi = rad * lat;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;    // ecliptic longitude
  const dec = Math.asin(Math.sin(L) * Math.sin(E));
  const ra = Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
}

// the map's light, 0 (night) to 1 (day): full day with the sun 6° up,
// full night at civil dusk (6° under), a smooth blend between — golden
// hour and dusk live in that band
export function lightAt(lat, lng, date = new Date()) {
  const a = sunAltitude(lat, lng, date);
  const t = Math.min(1, Math.max(0, (a + 6) / 12));
  return t * t * (3 - 2 * t);
}

// the band a light is in, for the tests and the dev chip's label
export const phaseOf = t => t >= 0.98 ? "day" : t <= 0.02 ? "night" : t >= 0.5 ? "golden" : "dusk";
