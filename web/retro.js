// Retro console UI bits shared by the map and the party screens (styles in
// theme.css): the DS-style dialog box that types its text out letter by
// letter with a soft blip and a blinking ▼, the mute toggle, and screen wipes.
//
// Sound: fx.js synthesizes every UI sound; the mute flag lives here (light
// module, no 3D imports) and fx.js checks it before making any noise.
const MUTE_KEY = "rando-muted";
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch {}
const muteListeners = new Set();

export const isMuted = () => muted;
export function setMuted(on) {
  muted = !!on;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch {}
  for (const fn of muteListeners) fn(muted);
}

// a small speaker toggle; every one on the page stays in sync
export function muteButton(cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `y-mute ${cls}`;
  const paint = m => { b.classList.toggle("off", m); b.setAttribute("aria-label", m ? "sound off — tap to turn on" : "sound on — tap to mute"); b.setAttribute("aria-pressed", String(m)); };
  paint(muted);
  muteListeners.add(paint);
  b.addEventListener("click", e => { e.stopPropagation(); setMuted(!muted); });
  return b;
}

// ---------------------------------------------------------------- dialog box
// typeDialog(host, { name, text, blip, onClose, sticky }) -> { el, skip(), close() }
// Tap while typing: show the rest. Tap when done: close (unless sticky — a
// status box that stays until it's replaced).
export function typeDialog(host, { name = "", text = "", blip = null, onClose = null, cps = 38, cls = "", sticky = false } = {}) {
  const el = document.createElement("div");
  el.className = `y-dlg-wrap ${cls}`;
  el.innerHTML = `${name ? `<span class="y-dlg-name"></span>` : ""}<div class="y-dlg" role="dialog" aria-live="polite"><span class="y-typed"></span><span class="y-rest"></span><span class="y-dlg-more" aria-hidden="true">&#9660;</span></div>`;
  if (name) el.querySelector(".y-dlg-name").textContent = name;
  const box = el.querySelector(".y-dlg"), typed = el.querySelector(".y-typed"), rest = el.querySelector(".y-rest");
  const chars = [...text];
  rest.textContent = text;           // reserves the box's final size from the start
  host.appendChild(el);
  let i = 0, timer = null, done = false;
  const finish = () => { clearInterval(timer); typed.textContent = text; rest.textContent = ""; done = true; box.classList.add("done"); };
  const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !chars.length) finish();
  else timer = setInterval(() => {
    i++;
    typed.textContent = chars.slice(0, i).join("");
    rest.textContent = chars.slice(i).join("");
    if (i % 2 === 1 && !/\s/.test(chars[i - 1])) blip?.();
    if (i >= chars.length) finish();
  }, 1000 / cps);
  const close = () => {
    clearInterval(timer);
    if (!el.isConnected) return;
    el.classList.add("out");
    setTimeout(() => el.remove(), 150);
    onClose?.();
  };
  el.addEventListener("click", e => { e.stopPropagation(); if (!done) finish(); else if (!sticky) close(); });
  return { el, skip: finish, close, get done() { return done; } };
}

// a quick wipe/pop on an element that just appeared (0.15–0.3 s)
export function popIn(el, kind = "pop") {
  if (!el) return;
  el.classList.remove("y-in-pop", "y-in-wipe");
  void el.offsetWidth;
  el.classList.add(kind === "wipe" ? "y-in-wipe" : "y-in-pop");
}
