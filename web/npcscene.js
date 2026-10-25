// What the game hosts' scenes (Side Quest's Prophet, the Ritual's Boss)
// share on the DOM side: beats fired off the synced game clock, a card that
// flies out of the scene (FLIP) to where it lives, a confetti puff. Their 3D
// side is npcstage.js.

// beats of a phase, fired once each off the synced game clock (s.left), so a
// stall on the host's phone holds the show instead of letting it run ahead
export class Beats {
  constructor() { this.key = null; this.fired = new Set(); }
  at(key, phaseKey, ms, elapsed, fn) {
    if (this.key !== phaseKey) { this.key = phaseKey; this.fired = new Set(); }
    if (this.fired.has(key) || elapsed < ms) return;
    this.fired.add(key);
    fn(elapsed - ms > 600);
  }
}

const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// a card coming out of the scene: it flies (FLIP) from `from`, a screen rect
// (the capsule, the ball), to where it lives, tilted back and small at first
export function flyFrom(el, from, { ms = 900, tilt = 70, ease = "cubic-bezier(.2,.9,.25,1.12)" } = {}) {
  if (!el || !from) return;
  const to = el.getBoundingClientRect();
  if (!to.width || reduce()) return;
  const dx = (from.left + from.width / 2) - (to.left + to.width / 2), dy = (from.top + from.height / 2) - (to.top + to.height / 2);
  const s = Math.max(0.04, Math.min(from.width / to.width, from.height / to.height));
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px) perspective(600px) rotateX(${tilt}deg) scale(${s})`;
  el.style.opacity = "0.2";
  void el.offsetWidth;
  el.style.transition = `transform ${ms}ms ${ease}, opacity ${Math.round(ms * 0.35)}ms ease-out`;
  el.style.transform = "";
  el.style.opacity = "";
  setTimeout(() => { el.style.transition = ""; }, ms + 50);
}

// a puff of confetti at (x, y) in `host`
export function confetti(host, { n = 26, x = "50%", y = "50%" } = {}) {
  if (!host || reduce()) return;
  const box = document.createElement("div");
  box.className = "np-confetti";
  box.style.left = x; box.style.top = y;
  const C = ["#ffc83d", "#ffe08a", "#3ee0d0", "#ffffff", "#ff8a3d", "#8ab4ff"];
  for (let i = 0; i < n; i++) {
    const b = document.createElement("i");
    b.style.cssText = `--x:${(Math.random() * 2 - 1) * 150}px;--y:${-70 - Math.random() * 150}px;--r:${Math.random() * 720 - 360}deg;background:${C[i % C.length]};animation-delay:${Math.random() * 70}ms`;
    box.appendChild(b);
  }
  host.appendChild(box);
  setTimeout(() => box.remove(), 1700);
}

// ---- the big moments, in screen space: readable whatever the camera is
// doing (players can orbit through all of them). Each one lives in `room`
// (the scene's .np-room), removes itself, and lets taps through to the
// scene; `late` (arrived mid-beat, e.g. a phone that just joined) shows the
// end state without the drama.
const add = (room, cls, html = "") => {
  const el = document.createElement("div");
  el.className = cls; el.innerHTML = html;
  room.appendChild(el);
  return el;
};
// every big moment this phone showed, for the tests (text only; no state)
const moment = (kind, text) => { const m = (globalThis.__npcMoments ??= []); m.push({ kind, text }); if (m.length > 40) m.shift(); };
const gone = (el, ms) => setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 420); }, ms);

// the hit: a flash over the scene (from `from`, a screen rect, if given) and
// a light shake of the whole room
export function impact(room, { color = "rgba(255, 240, 200, .9)", from = null, shakeIt = true } = {}) {
  if (!room) return;
  const r = room.getBoundingClientRect();
  const f = add(room, "np-flash");
  const cx = from ? from.left + from.width / 2 - r.left : r.width / 2, cy = from ? from.top + from.height / 2 - r.top : r.height * 0.45;
  f.style.background = `radial-gradient(circle at ${cx}px ${cy}px, ${color} 0, ${color} 12%, transparent 70%)`;
  setTimeout(() => f.remove(), 700);
  if (shakeIt && !reduce()) { room.classList.remove("np-shake"); void room.offsetWidth; room.classList.add("np-shake"); setTimeout(() => room.classList.remove("np-shake"), 520); }
}

// the chosen name slammed onto the screen in big letters, held, then gone
export function nameSlam(room, name, { ms = 1500, cls = "", late = false } = {}) {
  if (!room) return null;
  room.querySelectorAll(".np-slam").forEach(e => e.remove());
  const el = add(room, `np-slam ${cls}${late ? " late" : ""}`);
  const b = document.createElement("b"); b.textContent = name; el.appendChild(b);
  moment("slam", name);
  // long names shrink to fit
  b.style.fontSize = `${Math.max(34, Math.min(76, Math.round(560 / Math.max(5, [...name].length))))}px`;
  gone(el, ms);
  return el;
}

// on the chosen player's own phone: the whole screen is theirs for a moment
// ("gold": a gold flash, "red": a red spotlight)
export function takeover(room, text, { kind = "gold", ms = 2000, late = false } = {}) {
  if (!room) return null;
  room.querySelectorAll(".np-take").forEach(e => e.remove());
  const el = add(room, `np-take ${kind}${late ? " late" : ""}`);
  const b = document.createElement("b"); b.textContent = text; el.appendChild(b);
  moment(`take-${kind}`, text);
  gone(el, ms);
  return el;
}

// for everyone else: a banner across the top ("[Name] got picked")
export function banner(room, text, { ms = 2400, cls = "" } = {}) {
  if (!room) return null;
  room.querySelectorAll(".np-banner").forEach(e => e.remove());
  const el = add(room, `np-banner ${cls}`);
  el.textContent = text;
  moment("banner", text);
  gone(el, ms);
  return el;
}

// a stamp slammed onto a card, with a little dust puff where it lands
export function stampOn(card, text, { cls = "", late = false } = {}) {
  if (!card) return null;
  card.querySelector(".np-stamp")?.remove();
  const s = document.createElement("div");
  s.className = `np-stamp ${cls}${late ? " late" : ""}`;
  s.textContent = text;
  card.appendChild(s);
  if (!late && !reduce()) {
    const d = document.createElement("div"); d.className = "np-dust";
    for (let i = 0; i < 10; i++) {
      const p = document.createElement("i");
      const a = (i / 10) * Math.PI * 2;
      p.style.cssText = `--x:${Math.cos(a) * (40 + Math.random() * 30)}px;--y:${Math.sin(a) * (14 + Math.random() * 12)}px;animation-delay:${120 + Math.random() * 60}ms`;
      d.appendChild(p);
    }
    s.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }
  return s;
}

// a countdown in big letters (3, 2, 1, GO): show(step) puts up one step
export function countdown(room) {
  let el = null;
  return {
    show(text, { go = false } = {}) {
      if (!room) return;
      el?.remove();
      el = add(room, `np-count${go ? " go" : ""}`);
      const b = document.createElement("b"); b.textContent = text; el.appendChild(b);
      const mine = el;
      setTimeout(() => mine.remove(), go ? 900 : 620);
    },
    clear() { el?.remove(); el = null; },
  };
}
