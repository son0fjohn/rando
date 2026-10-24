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
  const C = ["#ffc83d", "#ff5d8a", "#3ee0d0", "#ffffff", "#ff8a3d", "#8ab4ff"];
  for (let i = 0; i < n; i++) {
    const b = document.createElement("i");
    b.style.cssText = `--x:${(Math.random() * 2 - 1) * 150}px;--y:${-70 - Math.random() * 150}px;--r:${Math.random() * 720 - 360}deg;background:${C[i % C.length]};animation-delay:${Math.random() * 70}ms`;
    box.appendChild(b);
  }
  host.appendChild(box);
  setTimeout(() => box.remove(), 1700);
}
