// The party's scoreboard and its big finish (styles in theme.css):
//   * the room leaderboard: an arcade high-score board on the room's wall —
//     each player's room sprite, name and party points so far; after each
//     game the new points tick up and the rows reshuffle
//   * the party results: after the set's last game, the top 3 on a podium
//     and everyone else under it, built to be screenshotted
//   * the coin burst: pixel coins pop out and the count ticks up
import { esc } from "./hpkit.js";
import { spriteFor, silhouetteFor, SPRITE } from "./charsprite.js";
import { PARTY } from "./hpconfig.js";

// a player's room sprite, standing, facing you
export function spriteFace(avatar, scale = 2) {
  const w = SPRITE.W * scale, h = SPRITE.H * scale;
  const el = document.createElement("i");
  el.className = "pb-face";
  Object.assign(el.style, { width: `${w}px`, height: `${h}px`, backgroundSize: `${w * SPRITE.COLS}px ${h * SPRITE.FACINGS.length}px` });
  el.style.backgroundImage = `url(${silhouetteFor(avatar).url})`;
  spriteFor(avatar).then(sh => { el.style.backgroundImage = `url(${sh.url})`; });
  return el;
}

// count a number up from `from` to `to`
function tick(el, from, to, ms = 900) {
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- room board
// rows: standings() output; avatars: id -> avatar. Keeps what it showed last
// time so new points tick up instead of jumping.
export function renderBoard(el, set, rows, { me, avatars = {} } = {}) {
  const shown = el._shown ?? {};
  const sig = `${set.no}:${set.games.length}:${rows.map(r => `${r.id}${r.total}${r.here ? 1 : 0}`).join(",")}`;
  if (el.dataset.sig === sig) return;
  const fresh = el.dataset.sig?.split(":")[1] !== String(set.games.length);
  el.dataset.sig = sig;
  const no = Math.min(set.games.length + (set.done ? 0 : 1), PARTY.GAMES_PER_SET);
  el.innerHTML = `<div class="pb-head"><b>high scores</b><span>${set.done ? "final" : `game ${no} of ${PARTY.GAMES_PER_SET}`}</span></div>
    <ol class="pb-rows"></ol>
    <div class="pb-dots">${Array.from({ length: PARTY.GAMES_PER_SET }, (_, i) => `<i class="${i < set.games.length ? "on" : ""}"></i>`).join("")}</div>`;
  const ol = el.querySelector(".pb-rows");
  rows.slice(0, 6).forEach((r, i) => {
    const li = document.createElement("li");
    li.className = `pb-row ${r.id === me ? "me" : ""} ${r.here ? "" : "gone"}`;
    li.innerHTML = `<span class="pb-rank">${i + 1}</span><span class="pb-av"></span><span class="pb-name">${esc(r.handle)}</span><b class="pb-pts">${shown[r.id] ?? r.total}</b>${r.last && fresh ? `<em class="pb-plus">+${r.last}</em>` : ""}`;
    li.querySelector(".pb-av").appendChild(spriteFace(avatars[r.id] ?? r.avatar ?? {}, 1));
    ol.appendChild(li);
    const pts = li.querySelector(".pb-pts");
    if ((shown[r.id] ?? r.total) !== r.total) { li.classList.add("up"); tick(pts, shown[r.id] ?? 0, r.total); }
  });
  if (rows.length > 6) ol.insertAdjacentHTML("beforeend", `<li class="pb-more">+${rows.length - 6} more</li>`);
  el._shown = Object.fromEntries(rows.map(r => [r.id, r.total]));
}

// ---------------------------------------------------------------- podium
// The party results. `coins`: what I earned this party (null while the
// server's still counting, undefined when there's no coin service).
export function showPodium(host, set, rows, { me, avatars = {}, isHost = false, onNewSet = null, onEnd = null } = {}) {
  closePodium(host);
  const wrap = document.createElement("div");
  wrap.className = "pp-wrap";
  wrap.id = "pp";
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]];                       // 2 · 1 · 3
  wrap.innerHTML = `<div class="pp-card">
      <div class="pp-title">party results</div>
      <div class="pp-sub">${set.games.length} games · set ${set.no}</div>
      <div class="pp-podium">${order.map((r, i) => r ? `<div class="pp-step s${[2, 1, 3][i]}" data-id="${esc(r.id)}">
          <div class="pp-who"><span class="pp-sprite"></span>${[2, 1, 3][i] === 1 ? '<i class="pp-crown"></i>' : ""}</div>
          <b class="pp-name">${esc(r.handle)}</b><span class="pp-pts">${r.total}</span>
          <div class="pp-block"><span>${[2, 1, 3][i]}</span></div></div>` : `<div class="pp-step empty"></div>`).join("")}</div>
      ${rows.length > 3 ? `<ol class="pp-rest" start="4">${rows.slice(3).map(r => `<li data-id="${esc(r.id)}"><span class="pp-sprite"></span><b>${esc(r.handle)}</b><span>${r.total}</span></li>`).join("")}</ol>` : ""}
    </div>
    <div class="pp-coins" id="pp-coins" hidden></div>
    <div class="pp-btns">${isHost
      ? `<button type="button" class="y-btn dim" id="pp-end">end the party</button><button type="button" class="y-btn host" id="pp-again">new set of ${PARTY.GAMES_PER_SET} ▶</button>`
      : `<p class="pp-wait">the host picks: another set, or the end of the party</p>`}</div>`;
  host.appendChild(wrap);
  wrap.querySelectorAll("[data-id]").forEach(el => {
    const r = rows.find(x => x.id === el.dataset.id);
    el.querySelector(".pp-sprite")?.appendChild(spriteFace(avatars[r?.id] ?? r?.avatar ?? {}, el.classList.contains("pp-step") ? 3 : 1));
    if (r?.id === me) el.classList.add("me");
  });
  wrap.querySelector("#pp-again")?.addEventListener("click", () => onNewSet?.());
  wrap.querySelector("#pp-end")?.addEventListener("click", () => onEnd?.());
  return wrap;
}
export function closePodium(host) { host?.querySelector("#pp")?.remove(); }

// the coins I earned, with a burst of pixel coins
export function showCoins(el, n, { note = "" } = {}) {
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<div class="cb-row"><i class="coin big"></i><b class="cb-n">+0</b><span>coins</span></div>${note ? `<small>${esc(note)}</small>` : ""}`;
  const b = el.querySelector(".cb-n");
  tick({ set textContent(v) { b.textContent = `+${v}`; } }, 0, n, 1100);
  coinBurst(el, Math.min(18, 6 + Math.round(n / 8)));
}
export function coinBurst(host, count = 10) {
  for (let i = 0; i < count; i++) {
    const c = document.createElement("i");
    c.className = "coin fly";
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 70;
    c.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    c.style.setProperty("--dy", `${Math.sin(a) * d - 40}px`);
    c.style.animationDelay = `${i * 30}ms`;
    host.appendChild(c);
    setTimeout(() => c.remove(), 1200 + i * 30);
  }
}
