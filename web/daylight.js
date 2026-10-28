// Day and night for the app's glass. One number, --day on the page root:
// 0 at night, 1 by day, in between at sunrise and sunset. Every glass panel
// and button reads it through the tokens in theme.css (dark navy glass with
// white text at night, light frosted glass with navy text by day), so they
// all follow the map's light together.
//
// Where it comes from:
// - a dev override (?light=day|night|sunset|sunrise|0..1, or the dev chip,
//   ?dev=1, which remembers it on this phone and reloads so the map follows);
// - else a map that was told what to be (?mode=day|night, or the first
//   open's night flyover): exactly that;
// - else the clock: night until 6:00, brightening to day by 7:00, day until
//   18:30, dimming to night by 19:30, re-read every minute. The map picks its
//   palette from the same clock when it loads (night from 19:00 to 6:30).
// No three.js here: tests read it.

const DEV_KEY = "rando-light";
const NAMED = { night: 0, day: 1, sunset: 0.5, sunrise: 0.5 };

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the clock's light for an hour of the day (0..24, fractional)
export function dayness(h) {
  return h < 12 ? smooth(6, 7, h) : 1 - smooth(18.5, 19.5, h);
}
const hourOf = d => d.getHours() + d.getMinutes() / 60;

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

let current = null, timer = null;
export function setDay(v) {
  v = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  if (v === current) return;
  current = v;
  const root = document.documentElement;
  root.style.setProperty("--day", String(v));
  root.classList.toggle("is-day", v >= 0.5);
}
export const getDay = () => current ?? 0;

// called once by the map with what it chose: { night, forced }
export function startDaylight({ night, forced }) {
  clearInterval(timer);
  const ov = lightOverride();
  if (ov != null) return setDay(ov);
  if (forced) return setDay(night ? 0 : 1);
  const tick = () => setDay(dayness(hourOf(new Date())));
  tick();
  timer = setInterval(tick, 60000);
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
