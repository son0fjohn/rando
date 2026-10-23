// The NPC scenes of the party games, built the way the Art Gallery is: a
// painted portrait backdrop, the NPC as pre-rendered pose cutouts that
// crossfade with a springy bump, props as cutout sprites, and the game UI
// sitting in the room (cards on the wall) instead of a flat card over it.
// Side Quest (the wizard) and Humiliation Ritual (the clown) both use it.
//
// Everything in a scene's NPC group is placed in that group's own units (the
// pose cutouts are 600x800 canvases), so a prop that sits in a hand stays in
// the hand on every phone. Motion is CSS transitions plus a few tweens here:
// thrown things fly real gravity arcs and land on a given frame; a prop that
// becomes UI flies (FLIP) from where it is in the scene to where the UI card
// lives, as the same element.

// a box in group units -> CSS percent position
export const at = (G, x, y, w, h) => `left:${(x / G.w * 100).toFixed(3)}%;top:${(y / G.h * 100).toFixed(3)}%;width:${(w / G.w * 100).toFixed(3)}%;height:${(h / G.h * 100).toFixed(3)}%`;

// the pose cutouts, stacked; one is .on at a time
export const posesHtml = (dir, poses, on) => poses.map(p => `<img class="np-pose ${p === on ? "on" : ""}" data-pose="${p}" src="${dir}${p}.webp" alt="" draggable="false">`).join("");
export function setPose(root, name, { bump = true } = {}) {
  if (!root) return;
  let changed = false;
  root.querySelectorAll(".np-pose").forEach(i => { const on = i.dataset.pose === name; if (on !== i.classList.contains("on")) changed = true; i.classList.toggle("on", on); });
  if (changed && bump) {
    // anticipation and settle: a quick squash then a springy stretch
    root.classList.remove("np-bump"); void root.offsetWidth; root.classList.add("np-bump");
  }
}

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

// throw `el` (positioned in group units) from a to b along a gravity arc:
// x moves at a constant speed, y is a parabola with constant downward
// acceleration, `peak` units above the higher end. Resolves on landing.
// `scale: [from, to]` grows it on the way (a thing flying at the camera).
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export function arcTo(el, G, a, b, { ms = 500, peak = 80, spin = 0, scale = null } = {}) {
  return new Promise(res => {
    if (!el?.isConnected) { res(); return; }
    const w = parseFloat(el.style.width) / 100 * G.w, h = parseFloat(el.style.height) / 100 * G.h;
    const place = (x, y, r, k) => {
      el.style.left = `${((x - w / 2) / G.w * 100).toFixed(3)}%`; el.style.top = `${((y - h / 2) / G.h * 100).toFixed(3)}%`;
      const sc = scale ? scale[0] + (scale[1] - scale[0]) * k : 1;
      el.style.transform = `${r ? `rotate(${r.toFixed(1)}deg)` : ""}${sc !== 1 ? ` scale(${sc.toFixed(3)})` : ""}`;
    };
    if (reduce()) { place(b[0], b[1], 0, 1); res(); return; }
    const top = Math.min(a[1], b[1]) - peak, t0 = performance.now();
    // y(t) = a + v t + g t^2 / 2 through a -> top -> b: solve for the apex time
    const ra = Math.sqrt(Math.max(0, a[1] - top)), rb = Math.sqrt(Math.max(0, b[1] - top));
    const tApex = ra / (ra + rb || 1);
    const step = now => {
      if (!el.isConnected) { res(); return; }
      const k = Math.min(1, (now - t0) / ms);
      place(a[0] + (b[0] - a[0]) * k, arcY(a[1], b[1], top, tApex, k), spin * k, k);
      if (k < 1) requestAnimationFrame(step); else res();
    };
    place(a[0], a[1], 0, 0);
    requestAnimationFrame(step);
  });
}
// the height at k (0..1) of a gravity arc from y0 to y1 over its apex `top`
const arcY = (y0, y1, top, tApex, k) => k < tApex ? top + (y0 - top) * (1 - k / tApex) ** 2 : top + (y1 - top) * ((k - tApex) / (1 - tApex || 1)) ** 2;

// FLIP: `el` is already where it ends up (the on-screen card); start it as if
// it were at `from` (a DOMRect: the prop in the scene), scaled down and
// tipped back, and fly it home. Same element all the way.
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

// the NPC's speech bubble, Art Gallery style, typed out
export function say(el, text, { blip = null, cps = 40 } = {}) {
  if (!el) return;
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  const chars = [...text];
  if (reduce()) { el.textContent = text; return; }
  clearInterval(el._t);
  let i = 0;
  el.innerHTML = `<span class="np-typed"></span><span class="np-rest"></span>`;
  const typed = el.firstChild, rest = el.lastChild;
  rest.textContent = text;
  el._t = setInterval(() => {
    i++;
    typed.textContent = chars.slice(0, i).join(""); rest.textContent = chars.slice(i).join("");
    if (i % 2 && !/\s/.test(chars[i - 1] ?? " ")) blip?.();
    if (i >= chars.length) clearInterval(el._t);
  }, 1000 / cps);
}
export const hush = el => { if (!el) return; clearInterval(el._t); el.classList.remove("on"); };
