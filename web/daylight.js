// Day and night for the app's glass. One number, --day on the page root:
// 0 at night, 1 by day, in between at sunrise and sunset. Every glass panel
// and button reads it through the tokens in theme.css (dark navy glass with
// white text at night, light frosted glass with navy text by day), so they
// all follow the map's light together.
//
// Where it comes from:
// - a dev override (?light=day|night|sunset|sunrise|0..1, or the dev chip,
//   ?dev=1, which remembers it on this phone and reloads so the map follows);
// - else a map that was told what to be (?mode=day|night, the tests): that;
// - else the real sun over the place the map shows (sun.js: altitude from
//   lat/lng and the moment, so Seoul is lit by Seoul's sun and Calgary by
//   Calgary's whatever the phone's clock says): the map works it out as it
//   draws (world3d.js applyLight) and hands it here, so sunrise and sunset
//   blend live while the app is open.
// No three.js here: tests read it.

const DEV_KEY = "rando-light";
const NAMED = { night: 0, day: 1, sunset: 0.5, sunrise: 0.5 };

import { lightAt, sunNow, localClock, phaseOf } from "./sun.js";

const parse = v => {
  if (v == null || v === "" || v === "auto") return null;
  if (v in NAMED) return NAMED[v];
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
};

// the dev override, if any: the URL's first, then the dev chip's
export function lightOverride() {
  try {
    const q = new URLSearchParams(location.search).get("light");
    if (q != null) return parse(q);
    return parse(localStorage.getItem(DEV_KEY));
  } catch { return null; }
}

let current = null, fixed = null, chip = null, chipMode = "auto";
export function setDay(v) {
  v = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  if (v === current) return;
  current = v;
  const root = document.documentElement;
  root.style.setProperty("--day", String(v));
  root.classList.toggle("is-day", v >= 0.5);
}
export const getDay = () => current ?? 0;

// called once by the map with what it chose: { night, forced } — a dev
// override or a forced mode pins the light; otherwise the map keeps calling
// sunlight() as it draws
export function startDaylight({ night, forced }) {
  const ov = lightOverride();
  fixed = ov != null ? ov : forced ? (night ? 0 : 1) : null;
  if (fixed != null) setDay(fixed);
}
// the light for the map right now: the pinned one, else the sun's over
// lat/lng; the page's --day follows (and the dev chip shows that place's
// own clock)
export function sunlight(lat, lng, date = sunNow()) {
  const t = fixed ?? lightAt(lat, lng, date);
  setDay(t);
  if (chip) chip.textContent = `☀︎ ${chipMode} · ${localClock(lat, lng, date).text} ${phaseOf(t)}`;
  return t;
}

// the dev chip (?dev=1): Auto → Day → Sunset → Night, remembered on this
// phone; it reloads so the map's palette follows too
function devChip() {
  let on = false;
  try { on = new URLSearchParams(location.search).get("dev") === "1" || localStorage.getItem("rando-dev") === "1"; } catch {}
  if (!on) return;
  const order = ["auto", "day", "sunset", "night"];
  let cur = "auto";
  try { cur = localStorage.getItem(DEV_KEY) || "auto"; } catch {}
  const b = Object.assign(document.createElement("button"), { type: "button", id: "dev-light" });
  b.textContent = `☀︎ ${cur}`;
  chip = b; chipMode = cur;
  b.style.cssText = "position:fixed;left:8px;bottom:calc(env(safe-area-inset-bottom) + 72px);z-index:99999;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.5);background:rgba(0,0,0,.55);color:#fff;font:600 12px/1 -apple-system,system-ui,sans-serif";
  b.onclick = () => {
    const next = order[(order.indexOf(cur) + 1) % order.length];
    try { next === "auto" ? localStorage.removeItem(DEV_KEY) : localStorage.setItem(DEV_KEY, next); localStorage.setItem("rando-dev", "1"); } catch {}
    const u = new URL(location.href); u.searchParams.delete("light"); u.searchParams.delete("mode");
    location.replace(u);
  };
  document.body.appendChild(b);
}
if (typeof document !== "undefined") {
  if (document.body) devChip(); else addEventListener("DOMContentLoaded", devChip, { once: true });
  globalThis.randoLight = v => setDay(parse(String(v)) ?? 0);   // live, glass only: randoLight("sunset")
}
