// Permissions at the right moment: a friendly card first (what it's for, in
// one line), then the system dialog only if they tap yes. Never on the first
// screen. Declining is fine: the app works without, and Settings can turn it
// on later. Pages without the onboarding root (#onb: the test party page)
// skip the card and just ask.
//
//   await askPermission("location")                   -> true / false
//   await askPermission("location", { body: t("perm.loc.mh") })
//   await askPermission("notifications")
//   await prePrompt("contacts")                       -> the card only (the picker is the system's part)
//   permState("location")                             -> "granted" | "denied" | "prompt" | "unsupported"
import { t } from "./i18n.js";
import { track } from "./analytics.js";
import { sfx, buzz } from "./fx.js";
import { esc } from "./hpkit.js";

const ICON = {
  location: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>`,
  notifications: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
  contacts: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
};
const KEYS = { location: "perm.loc", notifications: "perm.notif", contacts: "perm.contacts", camera: "perm.camera" };

export async function permState(kind) {
  try {
    if (kind === "notifications") {
      if (!("Notification" in globalThis)) return "unsupported";
      return Notification.permission === "default" ? "prompt" : Notification.permission;
    }
    if (kind === "location") {
      if (!navigator.geolocation) return "unsupported";
      const st = await navigator.permissions?.query({ name: "geolocation" });
      return st?.state ?? "prompt";
    }
    if (kind === "contacts") return "contacts" in navigator && "ContactsManager" in globalThis ? "prompt" : "unsupported";
  } catch {}
  return "prompt";
}

// the card on its own: resolves true (yes) / false (not now). onYes runs
// inside the tap on yes itself: a file picker (input.click()) only opens from
// a real tap on iPhone Safari, not from a promise that resolves after one.
// The card sits above everything, game screens included (a game asks too:
// Art Gallery's photos, Manhunt's location).
export function prePrompt(kind, { title, body, onYes } = {}) {
  const root = document.getElementById("onb");
  if (!root) { onYes?.(); return Promise.resolve(true); }
  const k = KEYS[kind];
  track("permission_prompted", { permission: kind });
  return new Promise(res => {
    const el = document.createElement("div");
    el.className = "onb-perm glass-scrim";
    el.innerHTML = `<div class="onb-perm-card glass glass-dialog" role="dialog" aria-labelledby="onb-perm-t">
        <span class="onb-perm-ico">${ICON[kind] ?? ""}</span>
        <b id="onb-perm-t">${esc(title ?? t(`${k}.title`))}</b>
        <p>${esc(body ?? t(`${k}.body`))}</p>
        <button type="button" class="glass-btn gold" data-yes>${esc(t(`${k}.ok`))}</button>
        <button type="button" class="onb-btn text" data-no>${esc(t("perm.later"))}</button>
      </div>`;
    document.body.appendChild(el);
    sfx.open?.();
    const done = yes => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 220);
      if (!yes) { track("permission_declined", { permission: kind }); toast(t("perm.denied")); }
      res(yes);
    };
    el.querySelector("[data-yes]").onclick = () => { sfx.confirm?.(); buzz(12); onYes?.(); done(true); };
    el.querySelector("[data-no]").onclick = () => { sfx.back?.(); done(false); };
  });
}

// the card, then the system's own prompt; true when it's allowed
export async function askPermission(kind, opts = {}) {
  const st = await permState(kind);
  if (st === "granted") return true;
  if (st === "denied" || st === "unsupported") return false;
  if (!(await prePrompt(kind, opts))) return false;
  const ok = await system(kind);
  track(ok ? "permission_granted" : "permission_declined", { permission: kind });
  if (!ok) toast(t("perm.denied"));
  return ok;
}

function system(kind) {
  if (kind === "notifications") return Notification.requestPermission().then(r => r === "granted").catch(() => false);
  if (kind === "location") return new Promise(res => navigator.geolocation.getCurrentPosition(() => res(true), () => res(false), { timeout: 15000, maximumAge: 600000 }));
  return Promise.resolve(true);
}

export function toast(text, ms = 2600) {
  const root = document.getElementById("onb") ?? document.body;
  const el = document.createElement("div");
  el.className = "onb-toast glass-toast";
  el.textContent = text;
  (root.id === "onb" ? document.body : root).appendChild(el);
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 300);
}
