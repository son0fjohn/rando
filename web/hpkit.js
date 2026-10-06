// House-party shared kit: the pieces every party game reuses.
//
// HostGame (gamekit.js) already gives us host-authoritative state, snapshot
// sync and host migration. This adds the party-specific layer:
//   * placeholder avatars (no generated characters this pass)
//   * the round machine: submit -> reveal -> vote -> score, drop-safe
//   * the results screen (big, minimal, screenshottable)
//   * a cleanup registry so photos and entries die with the party
import { ui } from "./gamekit.js";

const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------- avatars
// Placeholder only: a deterministic colour per player id plus their initial.
// Characters are explicitly out of scope this run, so nothing here loads a
// generated asset — swapping in real avatars later means changing only this.
export function avatarHue(id) {
  let h = 2166136261;
  for (let i = 0; i < String(id).length; i++) { h ^= String(id).charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}
export function avatarHtml(p, { size = 44, ring = "" } = {}) {
  const hue = avatarHue(p?.id ?? "?");
  const initial = esc(String(p?.handle ?? "?").trim().charAt(0).toUpperCase() || "?");
  return `<span class="hp-av ${ring}" style="--h:${hue};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${initial}</span>`;
}

// ---------------------------------------------------------------- drop-safety
// A player who closes the tab mid-round stops blocking it. Their already-made
// submissions still count (the state keeps them); they just stop being
// expected. `active()` is what every "is everyone done?" check must use.
export function syncGone(s, room) {
  const present = new Set(room.members.map(m => m.id));
  for (const p of Object.values(s.players)) if (!p.isBot) p.gone = !present.has(p.id);
}
export const active = s => Object.values(s.players || {}).filter(p => !p.gone);
export const everyone = s => Object.values(s.players || {});

// Did every still-present player finish this step? Vacuously true for an
// empty room, which lets a phase drain instead of hanging forever.
export function allDone(s, fn) { return active(s).every(fn); }

// ---------------------------------------------------------------- round machine
// A game declares its phases; the host advances them on a clock, or early the
// moment every present player has submitted. Each phase:
//   { name, ms, done?(s), enter?(s), exit?(s), next?(s) -> phaseName }
// Call hostStep(s, dt) from hostTick. Clients never run this — they render
// whatever snapshot arrives, which is why a host handover is seamless.
// NOTE: onPhase therefore fires on the HOST'S phone only. Never reset a
// player's local UI state (their draft answer, "I already voted" flags) in
// onPhase — guests would keep last round's. Reset it in render, keyed off
// something in the state (round number, phase), which every phone sees.
export class Rounds {
  constructor(phases, { onPhase = () => {} } = {}) {
    this.phases = Object.fromEntries(phases.map(p => [p.name, p]));
    this.order = phases.map(p => p.name);
    this.onPhase = onPhase;
  }
  // GRACE_MS: once everyone's in, hold a beat so the last submit is visible
  // rather than snapping straight to the next screen.
  static GRACE_MS = 1200;
  enter(s, name) {
    const p = this.phases[name];
    if (!p) return;
    // Only run the exit hook of a phase this machine actually ENTERED. A
    // game's initial state already names its first phase, so without this
    // the bootstrap enter() would "leave" that phase before it began — which
    // runs its exit hook on an empty round (in Secret Diary that wiped every
    // answer slot; in Mission it auto-picked everyone's card). The marker
    // lives in the state, so it survives a host handover.
    if (s._rp && s._rp === s.phase) this.phases[s.phase]?.exit?.(s);
    s.phase = name;
    s._rp = name;
    s.left = typeof p.ms === "function" ? p.ms(s) : p.ms;
    p.enter?.(s);
    this.onPhase(name, s);
  }
  hostStep(s, dt) {
    const p = this.phases[s.phase];
    if (!p) return;
    s.left -= dt * 1000;
    if (p.done && p.done(s) && s.left > Rounds.GRACE_MS) s.left = Rounds.GRACE_MS;
    if (s.left > 0) return;
    const nxt = p.next?.(s);
    if (nxt === null || nxt === undefined) return;   // phase holds itself (e.g. "end")
    this.enter(s, nxt);
  }
}

// ---------------------------------------------------------------- results
// Built to be screenshotted: avatars, names, scores, nothing else. No
// buttons inside the capture area, no timers, no scrolling list of rules.
export function resultsHtml(players, { title = "final scores", sub = "", note = "" } = {}) {
  const ranked = players.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = ranked.length ? (ranked[0].score ?? 0) : 0;
  const rows = ranked.map((p, i) => {
    const win = (p.score ?? 0) === top && top > 0;
    return `<li class="hp-res-row ${win ? "win" : ""}">
      <span class="hp-res-rank">${i + 1}</span>
      ${avatarHtml(p, { size: 52, ring: win ? "gold" : "" })}
      <span class="hp-res-name">${esc(p.handle)}${p.gone ? ' <small class="hp-left">left</small>' : ""}</span>
      <span class="hp-res-score">${p.score ?? 0}</span>
    </li>`;
  }).join("");
  return `<div class="hp-results">
    <div class="hp-res-title">${esc(title)}</div>
    ${sub ? `<div class="hp-res-sub">${esc(sub)}</div>` : ""}
    <ol class="hp-res-list">${rows}</ol>
    ${note ? `<div class="hp-res-note">${esc(note)}</div>` : ""}
  </div>`;
}
// Full-screen results stage. `extra` is rendered OUTSIDE the capture card so
// host buttons don't end up in the screenshot.
export function showResults(players, opts = {}, extra = "") {
  ui.panel(resultsHtml(players, opts) + extra, "hp-results-wrap");
}

// ---------------------------------------------------------------- cleanup
// Anything a game creates that outlives a render — object URLs, photo caches,
// written entries — registers a disposer here. The party flushes the bin when
// the party ends or the game unloads, so nothing lingers after the night.
export const trash = {
  _fns: new Set(),
  add(fn) { this._fns.add(fn); return () => this._fns.delete(fn); },
  flush(why = "party ended") {
    for (const fn of [...this._fns]) { try { fn(); } catch (e) { console.warn("[hpkit] cleanup", e); } }
    this._fns.clear();
    if (window.__hpTrashLog !== false) console.info(`[hpkit] cleaned up (${why})`);
  },
};

// ---------------------------------------------------------------- misc ui
export const hostSkip = (ctx, label = "host: skip ahead") =>
  ctx.isHost() ? `<button type="button" class="pt-btn ag-skip" id="hp-skip">${label}</button>` : "";
export function bindHostSkip(game) {
  const b = $("hp-skip");
  if (b) b.onclick = () => game.input("skip");
}
// "3/5 in" style progress, counting only players still present
export function tally(s, fn) {
  const a = active(s);
  return `${a.filter(fn).length}/${a.length}`;
}
