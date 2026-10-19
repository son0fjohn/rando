// Tap someone in the party room: their profile card slides up.
//
// Shows their full 3D character in their current outfit (live render, drag
// to rotate; their pixel sprite if 3D can't run), their name, badges and a
// short status when they have them, and:
//   * Wave      — they see you wave (a bubble over you, a note on their phone)
//   * Add friend — friendships only ever come from a confirmed in-person
//                  meetup (server-side, see migrations/010_friends.sql);
//                  this shows whether you're friends, it never adds one
//   * Report    — a reason, sent to the reports table (migrations/012)
//   * Block     — hides them and their chat from you, on this phone
// Close: tap outside, swipe down, or the grip.
import { esc } from "./hpkit.js";
import { spriteFor, silhouetteFor } from "./charsprite.js";

const REASONS = ["harassment", "hateful", "sexual", "spam", "something else"];

export function openCard(host, person, { me, isHost = false, friend = false, blocked = false, onWave, onBlock, onReport } = {}) {
  close(host, true);
  const wrap = document.createElement("div");
  wrap.className = "y-card-wrap";
  wrap.id = "y-card";
  wrap.innerHTML = `<div class="y-card" role="dialog" aria-label="${esc(person.handle)}'s profile">
      <div class="y-card-grip"></div>
      <div class="y-card-top">
        <div class="y-card-3d" id="y-card-3d"><small>drag to spin</small></div>
        <div class="y-card-info">
          <div class="y-card-name">${isHost ? '<i class="lr-crown" aria-label="host"></i>' : ""}${esc(person.handle)}</div>
          ${person.status ? `<div class="y-card-status">${esc(person.status)}</div>` : ""}
          <div class="y-card-sec">badges</div>
          <div class="y-card-badges">${(person.badges ?? []).length ? person.badges.map(b => `<span>${esc(b)}</span>`).join("") : "no badges yet"}</div>
        </div>
      </div>
      <div class="y-card-btns">
        <button type="button" class="y-btn pink" id="y-card-wave">wave</button>
        <button type="button" class="y-btn ${friend ? "lime" : "dim"}" id="y-card-friend" disabled>${friend ? "friends ✓" : "add friend"}</button>
        <button type="button" class="y-btn dim small" id="y-card-report">report</button>
        <button type="button" class="y-btn dim small" id="y-card-block">${blocked ? "unblock" : "block"}</button>
      </div>
      <div class="y-card-report" id="y-card-reasons" hidden>${REASONS.map(r => `<button type="button" class="y-btn dim small" data-reason="${r}">${r}</button>`).join("")}</div>
      <div class="y-card-note" id="y-card-note">${friend ? "" : "add each other by meeting up in person"}</div>
    </div>`;
  host.appendChild(wrap);
  const card = wrap.querySelector(".y-card");
  const note = t => { wrap.querySelector("#y-card-note").textContent = t; };
  wrap.addEventListener("pointerdown", e => { if (e.target === wrap) close(host); });
  // swipe down on the card (not on the 3D view) to close
  let y0 = null;
  card.addEventListener("pointerdown", e => { if (!e.target.closest(".y-card-3d, button")) y0 = e.clientY; });
  card.addEventListener("pointermove", e => { if (y0 !== null) card.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  const end = e => { if (y0 === null) return; const dy = e.clientY - y0; y0 = null; if (dy > 70) close(host); else card.style.transform = ""; };
  card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
  wrap.querySelector(".y-card-grip").addEventListener("click", () => close(host));

  wrap.querySelector("#y-card-wave").onclick = e => { onWave?.(); e.target.disabled = true; note(`you waved at ${person.handle}`); setTimeout(() => { if (e.target.isConnected) e.target.disabled = false; }, 3000); };
  wrap.querySelector("#y-card-block").onclick = () => { const now = onBlock?.(); note(now ? `${person.handle} is hidden from you` : `${person.handle} is back`); wrap.querySelector("#y-card-block").textContent = now ? "unblock" : "block"; };
  wrap.querySelector("#y-card-report").onclick = () => { const r = wrap.querySelector("#y-card-reasons"); r.hidden = !r.hidden; note(r.hidden ? "" : "what happened?"); };
  wrap.querySelectorAll("[data-reason]").forEach(b => b.onclick = async () => {
    wrap.querySelectorAll("[data-reason]").forEach(x => { x.disabled = true; });
    note("sending…");
    const ok = await Promise.resolve(onReport?.(b.dataset.reason)).catch(() => false);
    note(ok ? "reported — thank you. you can block them too." : "couldn't send the report — try again in a bit");
    if (!ok) wrap.querySelectorAll("[data-reason]").forEach(x => { x.disabled = false; });
  });

  show3d(wrap.querySelector("#y-card-3d"), person.avatar);
}

export function close(host, now = false) {
  const wrap = host.querySelector("#y-card");
  if (!wrap) return;
  wrap._dispose?.();
  if (now) { wrap.remove(); return; }
  wrap.querySelector(".y-card")?.classList.add("closing");
  setTimeout(() => wrap.remove(), 160);
}

// their real character, lit softly, drag to rotate; the sprite if 3D fails
async function show3d(box, avatar) {
  const wrap = box.closest(".y-card-wrap");
  const sprite = sh => { if (box.isConnected && !box.querySelector("canvas")) { box.querySelector(".y-card-spr")?.remove(); box.insertAdjacentHTML("afterbegin", `<div class="y-card-spr" style="background-image:url(${sh.url})"></div>`); } };
  sprite(silhouetteFor(avatar));
  spriteFor(avatar).then(sprite);
  try {
    const THREE = await import("https://esm.sh/three@0.160.0");
    const A = await import("./avatar3.js");
    if (!A.makeHumanCharacter || !box.isConnected) return;
    const ch = await A.makeHumanCharacter(avatar ?? {});
    await ch.ready;
    if (!box.isConnected) { ch.dispose?.(); return; }
    const w = box.clientWidth, h = box.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a3f7a, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(6, 14, 18); scene.add(key);
    const rim = new THREE.DirectionalLight(0x4de8c8, 1.2); rim.position.set(-10, 8, -12); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, w / h, 1, 200);
    cam.position.set(0, 9, 34); cam.lookAt(0, 7.2, 0);
    scene.add(ch.group);
    box.querySelector(".y-card-spr")?.remove();
    box.prepend(renderer.domElement);
    let yaw = 0.35, vel = 0, dragging = false, lastX = 0, raf = 0, idle = 0;
    box.addEventListener("pointerdown", e => { dragging = true; lastX = e.clientX; box.setPointerCapture?.(e.pointerId); });
    box.addEventListener("pointermove", e => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; vel = dx * 0.012; yaw += vel; idle = 0; });
    const up = () => { dragging = false; };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    const tick = () => {
      if (!box.isConnected) { dispose(); return; }
      if (!dragging) { vel *= 0.92; yaw += vel; if (++idle > 90) yaw += 0.006; }
      ch.group.rotation.y = yaw;
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    const dispose = () => { cancelAnimationFrame(raf); ch.dispose?.(); renderer.dispose(); renderer.forceContextLoss?.(); };
    if (wrap) wrap._dispose = dispose;
    tick();
  } catch (e) { console.warn("[card] 3D preview unavailable", e); }
}
