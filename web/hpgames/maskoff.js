// Mask Off (3+) — truth cards, answered out loud, rated on honesty.
//
// Each turn the fair picker (fairpick.js, same as Side Quest) lands on one
// player and a truth card flips up for everyone: "MASK OFF: …". They answer
// out loud, in person. Everyone else rates their honesty 1-5 (1 = mask on,
// totally fake; 5 = mask off, totally real); rating opens with the card, one
// tap locks it in, and the turn ends once everyone has rated (the 2-minute
// clock is only the backstop). Skipping the card scores 0 and skips rating.
//
// The reveal: the player's avatar wears a theatrical mask. A low average
// keeps it on with a sly grin (MASK ON), the middle cracks it (SUS), a high
// one shatters it off with a burst (MASK OFF). Points = average x
// MASKOFF.POINTS_PER_STAR.
//
// The host sets the number of turns in the votes sheet (everyone once, twice
// — the default — or three times). Cards escalate as the game goes: level 1
// (fun), then 2 (personal), then 3 (deep). Played over the dimmed party room.
//
// The cards live in web/data/mask_off_cards.json (a draft); ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MASKOFF } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash, roomBackdrop } from "./../hpkit.js";
import { fairPick } from "./../fairpick.js";
import { spriteFace } from "./../partyboard.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const PICK_MS = 4600;
const PICK_LAND_MS = 2800;        // of PICK_MS: faces flick past, then it lands
const REVEAL_MS = 8500;
const END_MS = 22000;
const STARS = MASKOFF.STARS, PPS = MASKOFF.POINTS_PER_STAR;
const RATE_LABELS = ["mask on", "mostly fake", "sus", "pretty real", "mask off"];
const STAMPS = { on: "MASK ON", sus: "SUS", off: "MASK OFF" };

// ---------------------------------------------------------------- the cards
let POOL = null;
const poolReady = fetch(new URL(`../${MASKOFF.POOL_URL}`, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => { POOL = (j.cards || []).filter(c => c && c.id && c.text && [1, 2, 3].includes(c.level)); return POOL; })
  .catch(e => { console.warn("[maskoff] couldn't load the cards", e); POOL = []; return POOL; });
export const maskPool = () => poolReady;

// which level the card for turn `ti` (0-based) of `turns` comes from
export const levelFor = (ti, turns) => {
  const f = turns > 0 ? ti / turns : 0;
  return f < MASKOFF.LEVEL_SPLIT[0] ? 1 : f < MASKOFF.LEVEL_SPLIT[1] ? 2 : 3;
};
// average honesty -> the reveal
export const maskVerdict = avg => (avg < MASKOFF.SUS ? "on" : avg < MASKOFF.OFF ? "sus" : "off");
export const maskPoints = avg => Math.round((avg ?? 0) * PPS);

// ---------------------------------------------------------------- the mask
// a theatrical mask, drawn twice (two halves, so it can break apart), with a
// sly grin and a crack line that the reveal brings in
const MASK_SVG = `<svg viewBox="0 0 60 46" aria-hidden="true">
  <path class="mo-m-face" d="M4 7Q30-2 56 7Q59 25 46 37Q30 47 14 37Q1 25 4 7Z"/>
  <path class="mo-m-eye" d="M12 17Q18.5 10 25 17Q18.5 21 12 17ZM35 17Q41.5 10 48 17Q41.5 21 35 17Z"/>
  <path class="mo-m-brow" d="M11 12Q18 7 25 11M35 11Q42 7 49 12"/>
  <path class="mo-m-grin" d="M19 28Q29 37 43 26"/>
  <path class="mo-m-crack" d="M31 1L27 11L34 19L28 28L33 38"/>
</svg>`;
const maskHtml = (cls = "") => `<div class="mo-mask ${cls}"><div class="mo-half l">${MASK_SVG}</div><div class="mo-half r">${MASK_SVG}</div>
  <div class="mo-burst">${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg;--d:${i % 2 ? 58 : 84}px"></i>`).join("")}</div></div>`;
const cardHtml = (c, cls = "") => `<div class="mo-card ${cls}"><div class="mo-card-in">
  <div class="mo-kicker">MASK OFF:</div><div class="mo-text">${esc(c?.text ?? "…")}</div>
  <em class="mo-lv l${c?.level ?? 1}">${["", "fun", "personal", "deep"][c?.level ?? 1]}</em></div></div>`;

export const MASK_OFF = {
  id: "mask_off", title: "Mask Off",
  blurb: "a truth card flips up for one player. they answer out loud, everyone rates how real they were — mask on, or mask off.",
  minPlayers: 3, maxPlayers: 12, length: "~2 min per turn",
  backdrop: "room",            // played over the party room (dimmed), not the map
  options: [{
    key: "rounds", label: "turns",
    choices: [
      { value: "1", label: "everyone once", hint: "about one turn each" },
      { value: "2", label: "everyone twice", hint: "about two turns each" },
      { value: "3", label: "three times", hint: "about three turns each" },
    ],
    default: "2",
  }],

  start(ctx) {
    if (!POOL) { ui.show(); ui.stage("Mask Off", `<div class="mo-game"><p class="ab-sub">shuffling the cards…</p></div>`, "loading"); poolReady.then(() => this._start(ctx)); return; }
    this._start(ctx);
  },

  _start(ctx) {
    ui.show(); ui.theme("chaos");
    roomBackdrop("lounge");     // a dim, moody lounge behind the cards
    const room = ctx.room;
    const PER = Math.max(1, Math.min(3, +(ctx.options?.rounds ?? 2) || 2));
    let lastHud = 0, lastTurn = null, myVote = null, skipArmed = 0, spinTok = 0, flipped = -1;
    trash.add(() => { myVote = null; spinTok++; });

    const turn = s => s.turn ?? null;
    const isMe = s => turn(s)?.who === ctx.me.id;
    const voters = s => active(s).filter(p => p.id !== turn(s)?.who);
    const avatarOf = id => room.members.find(m => m.id === id)?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? (game.s?.players?.[id]?.avatar ?? {});
    const allRated = s => voters(s).length > 0 && voters(s).every(p => turn(s)?.votes[p.id] !== undefined);

    const rounds = new Rounds([
      { name: "pick", ms: PICK_MS, enter: s => deal(s), next: () => "talk" },
      {
        // the answer and the rating at once: done when they skip, or when
        // everyone else has rated (the timer is only the backstop)
        name: "talk", ms: MASKOFF.TALK_MS,
        done: s => turn(s)?.status === "skipped" || allRated(s),
        next: s => { const t = turn(s); if (t && !t.status) t.status = allRated(s) ? "rated" : "timeup"; tally(s); return "reveal"; },
      },
      { name: "reveal", ms: REVEAL_MS, next: s => (s.ti + 1 < s.turns ? (s.ti++, "pick") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "pick") sfx.open();
        if (name === "talk") { sfx.whoosh(); buzz([30, 40, 30]); }
        if (name === "reveal") sfx.pop();
        if (name === "end") sfx.win();
      },
    });

    const seat = (id, handle, isBot, avatar = null) => ({ id, handle, isBot, score: 0, gone: false, ...(isBot && avatar ? { avatar } : {}) });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true, b.avatar);
        s.decks = { 1: [], 2: [], 3: [] };
        for (const c of POOL) s.decks[c.level].push(c.id);
        for (const l of [1, 2, 3]) s.decks[l] = shuffle(game.rng, s.decks[l]);
        s.weights = {}; s.used = []; s.ti = 0; s.turn = null;
        s.turns = Math.max(1, PER * active(s).length);
        rounds.enter(s, "pick");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const t = turn(s);
        // the player answering left: skip the turn, nobody scores it
        if (t && s.players[t.who]?.gone && ["pick", "talk"].includes(s.phase)) {
          t.left = true; t.pts = 0;
          rounds.enter(s, "reveal");
          return;
        }
        if (t && s.phase === "talk" && !t.status && s.players[t.who]?.isBot && game.rng() < dt * 0.01) t.status = "skipped";
        if (t && s.phase === "talk" && !t.status)
          for (const p of voters(s))
            if (p.isBot && t.votes[p.id] === undefined && game.rng() < dt * 0.15) t.votes[p.id] = 1 + Math.floor(game.rng() * STARS);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const t = turn(s), p = s.players[m.from];
        if (!t || !p || s.phase !== "talk" || t.status) return;
        if (m.in === "pass" && m.from === t.who) t.status = "skipped";
        // one tap locks a rating in: a second one is ignored
        if (m.in === "rate" && m.from !== t.who && t.votes[p.id] === undefined) {
          const v = Math.round(Number(m.v));
          if (v >= 1 && v <= STARS) t.votes[p.id] = v;
        }
      },
      render(s) { renderMO(s); },
      onEvent() {},
    }, { hz: 4 });

    // a new turn: the fair pick of who answers, and a card of this turn's level
    function deal(s) {
      const want = levelFor(s.ti, s.turns);
      const order = [want, ...[1, 2, 3].filter(l => l !== want).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))];
      let lvl = order.find(l => s.decks[l].length);
      if (!lvl) {                                    // every card used: reshuffle this level
        lvl = want;
        s.decks[lvl] = shuffle(game.rng, POOL.filter(c => c.level === lvl).map(c => c.id));
      }
      const id = s.decks[lvl].shift();
      const c = POOL.find(x => x.id === id) ?? POOL[0];
      const pick = fairPick(s.weights, active(s).map(p => p.id), game.rng);
      s.weights = pick.weights;
      s.used.push(c.id);
      s.turn = { no: s.ti + 1, card: { id: c.id, text: c.text, level: c.level }, who: pick.id, status: null, votes: {}, avg: null, n: 0, pts: 0, verdict: null, left: false };
    }
    // the ratings -> the verdict and the points; skipping is 0 and nobody rates
    function tally(s) {
      const t = turn(s);
      if (!t) return;
      if (t.status === "skipped") { t.avg = 0; t.n = 0; t.pts = 0; t.verdict = null; }
      else {
        const vs = Object.values(t.votes).filter(v => Number.isFinite(v));
        t.n = vs.length;
        t.avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
        t.pts = maskPoints(t.avg);
        t.verdict = t.n ? maskVerdict(t.avg) : null;
      }
      const p = s.players[t.who];
      if (p) p.score += t.pts;
    }

    // ---- the face reel: flick through everyone, slow down, land on `target`
    function spin(el, ids, target, elapsed) {
      const tok = ++spinTok;
      if (!el || !ids.length) return;
      const faces = new Map(ids.map(id => { const f = spriteFace(avatarOf(id), 3); f.dataset.id = id; return [id, f]; }));
      el.replaceChildren(...faces.values());
      const show = id => { for (const [k, f] of faces) f.hidden = k !== id; };
      const steps = [];
      let t = 0, d = 60, i = Math.floor(Math.random() * ids.length);
      while (t + d < PICK_LAND_MS) { steps.push([t, ids[i++ % ids.length]]); t += d; d *= 1.18; }
      steps.push([PICK_LAND_MS, target]);
      const landed = () => $("mo-who")?.classList.add("on");
      if (elapsed >= PICK_LAND_MS) { show(target); landed(); return; }
      for (const [at, id] of steps) {
        if (at < elapsed) continue;
        setTimeout(() => {
          if (tok !== spinTok) return;
          show(id);
          if (id === target && at === PICK_LAND_MS) { landed(); sfx.chime(); if (target === ctx.me.id) buzz([60, 40, 120]); }
          else sfx.cursor();
        }, at - elapsed);
      }
      show(steps.find(([at]) => at >= elapsed)?.[1] ?? target);
    }

    // ---- render ----
    function renderMO(s) {
      // per-turn local state resets on every phone, keyed off the state
      const tk = `${s.ti}:${s.phase}`;
      if (tk !== lastTurn) { lastTurn = tk; if (s.phase !== "talk") myVote = null; skipArmed = 0; }
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const t = turn(s), who = s.players?.[t?.who]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || "?"}`;
      ui.hud(`<div class="hq"><b>MASK OFF</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);

      // a guest can draw before the host's first turn reaches it
      if (!t && s.phase !== "end") return;

      if (s.phase === "pick") {
        if (!ui.once(`p:${s.ti}`, () => {})) return;
        ui.stage("", `<div class="mo-game"><div class="mo-reel-wrap"><div class="sq-reel mo-reel" id="mo-reel"></div>${maskHtml("still")}</div>
          <div class="sq-who" id="mo-who">${isMe(s) ? "it's YOU!" : `${esc(who)}!`}</div>
          <p class="ab-sub">level ${t.card.level} · ${["", "fun", "personal", "deep"][t.card.level]}</p></div>${hostSkip(ctx)}`, "whose mask comes off?");
        const ids = P.filter(p => !p.gone).map(p => p.id);
        spin($("mo-reel"), ids.length ? ids : [t.who], t.who, PICK_MS - s.left);
        bindHostSkip(game);

      } else if (s.phase === "talk") {
        const mine = isMe(s);
        const held = t.votes[ctx.me.id] ?? myVote;
        if (ui.once(`t:${s.ti}:${t.status ?? "-"}:${mine ? 1 : 0}:${skipArmed ? 1 : 0}:${held ?? "-"}`, () => {})) {
          // the card flips up once per turn; later rebuilds show it face up
          const flip = flipped !== s.ti ? "flip" : "";
          flipped = s.ti;
          if (t.status === "skipped") {
            ui.stage(mine ? "you skipped it" : `${esc(who)} skipped the card`, `<div class="mo-game">${cardHtml(t.card, "small")}<p class="ab-sub">0 points · no rating</p></div>${hostSkip(ctx)}`, "skipped");
          } else if (mine) {
            ui.stage("answer out loud", `<div class="mo-game">${cardHtml(t.card, flip)}<div class="sq-clock" id="mo-clock">${ui.clock(s.left)}</div>
                <p class="ab-sub">the room is rating how real you're being · <b id="mo-vcount"></b></p>
                <button type="button" class="sq-giveup mo-skip ${skipArmed ? "armed" : ""}" id="mo-skip">${skipArmed ? "tap again to skip · 0 points" : "skip this card"}</button></div>${hostSkip(ctx)}`, "your turn");
            const b = $("mo-skip");
            if (b) b.onclick = () => {
              if (skipArmed && performance.now() - skipArmed < 3500) { game.input("pass"); sfx.back(); skipArmed = 0; return; }
              skipArmed = performance.now(); ui.resetKey();
              setTimeout(() => { if (skipArmed && performance.now() - skipArmed >= 3400) { skipArmed = 0; ui.resetKey(); } }, 3500);
            };
          } else {
            ui.stage(`${esc(who)} is answering`, `<div class="mo-game">${cardHtml(t.card, flip)}<div class="sq-clock small" id="mo-clock">${ui.clock(s.left)}</div>
              <div class="mo-rate ${held ? "locked" : ""}">${Array.from({ length: STARS }, (_, i) =>
                `<button type="button" class="mo-r ${held === i + 1 ? "on" : ""}" data-honest="${i + 1}" aria-label="${i + 1}: ${RATE_LABELS[i]}" ${held ? "disabled" : ""}>${i + 1}</button>`).join("")}</div>
              <div class="mo-ends"><span>mask on</span><span>mask off</span></div>
              <p class="sq-rate-lbl">${held ? `${RATE_LABELS[held - 1]} · locked in` : "how real are they being? tap to rate"}</p>
              <p class="ab-sub"><b id="mo-vcount"></b>${held ? " · the turn ends when everyone has rated" : ""}</p></div>${hostSkip(ctx)}`, "listen · rate");
            $("game-panel").querySelectorAll("[data-honest]").forEach(b => b.onclick = () => {
              if (myVote || t.votes[ctx.me.id] !== undefined) return;
              myVote = +b.dataset.honest; game.input("rate", { v: myVote }); sfx.pop(); buzz(20); ui.resetKey();
            });
          }
          bindHostSkip(game);
        }
        // the clock and the count tick in place (rebuilding would eat taps)
        const c = $("mo-clock");
        if (c) { c.textContent = ui.clock(s.left); c.classList.toggle("urgent", s.left < 20000); }
        const vc = $("mo-vcount");
        if (vc) vc.textContent = `${Object.keys(t.votes).length}/${voters(s).length} rated`;

      } else if (s.phase === "reveal") {
        if (!ui.once(`r:${s.ti}`, () => {})) return;
        const board = P.slice().sort((a, b) => b.score - a.score).map(p => `<li class="${p.id === t.who ? "me" : ""}"><b>${esc(p.handle)}</b><span>${p.score}</span></li>`).join("");
        if (t.left) {
          ui.stage(`${esc(who)} left`, `<div class="mo-game">${cardHtml(t.card, "small")}<p class="ab-sub">nobody scores this one</p><ol class="sq-board">${board}</ol></div>${hostSkip(ctx)}`, "no verdict");
        } else if (t.status === "skipped" || !t.verdict) {
          ui.stage(`${esc(who)}`, `<div class="mo-game">${cardHtml(t.card, "small")}<div class="sq-stamp">${t.status === "skipped" ? "SKIPPED" : "NO VOTES"}</div><div class="mh-big">+0</div>
            <ol class="sq-board">${board}</ol></div>${hostSkip(ctx)}`, "the verdict");
        } else {
          const avg = Math.round((t.avg ?? 0) * 10) / 10;
          ui.stage(`${esc(who)}`, `<div class="mo-game"><div class="mo-reveal" id="mo-reveal"><div class="mo-face" id="mo-face"></div>${maskHtml()}</div>
            <div class="mo-stamp ${t.verdict}" id="mo-stamp">${STAMPS[t.verdict]}</div>
            <div class="sq-avg"><b id="mo-avg">0.0</b><span>/ ${STARS} honest</span></div>
            <div class="mh-big sq-pts" id="mo-pts">+${t.pts}</div>
            <p class="ab-sub">average of ${t.n} rating${t.n === 1 ? "" : "s"} × ${PPS}</p>
            <ol class="sq-board">${board}</ol></div>${hostSkip(ctx)}`, "the verdict");
          $("mo-face").appendChild(spriteFace(avatarOf(t.who), 5));
          // the beat: the mask sits there a moment, then the verdict plays out
          const el = $("mo-reveal");
          setTimeout(() => { el?.classList.add(t.verdict); if (t.verdict === "off") { sfx.chime(); buzz([40, 30, 80]); } else sfx.blip(); }, 900);
          setTimeout(() => $("mo-stamp")?.classList.add("show"), 1900);
          const av = $("mo-avg"), t0 = performance.now() + 900;
          const up = n => { const k = Math.max(0, Math.min(1, (n - t0) / 1300)); if (av) av.textContent = (avg * k).toFixed(1); if (k < 1) requestAnimationFrame(up); else $("mo-pts")?.classList.add("on"); };
          requestAnimationFrame(up);
        }
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, { title: "Mask Off", sub: "final scores", note: `average honesty × ${PPS} per card · skip = 0` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "pick", left: PICK_MS, players: {}, decks: { 1: [], 2: [], 3: [] }, weights: {}, used: [], ti: 0, turns: 1, turn: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => { spinTok++; game.stop(); ui.hide(); o(r); };
  },
};
