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
import { mountCharView } from "./charview.js";

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

  const view = mountCharView(wrap.querySelector("#y-card-3d"), person.avatar ?? {});
  wrap._dispose = () => view.dispose();
}

export function close(host, now = false) {
  const wrap = host.querySelector("#y-card");
  if (!wrap) return;
  wrap._dispose?.();
  if (now) { wrap.remove(); return; }
  wrap.querySelector(".y-card")?.classList.add("closing");
  setTimeout(() => wrap.remove(), 160);
}
