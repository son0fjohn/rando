// Mask Off (3+) — a slow, sentimental card game. No scores, no ratings.
//
// The host picks which levels are in the deck (light, real, deep; light +
// real by default) and how many rounds (everyone answers twice by default).
// Everyone is dealt a private hand of 5 question cards; nobody else sees it,
// and no card is dealt twice in a game.
//
// A turn: the app picks who's asking whom (the answerer is fair-random and
// everyone is asked equally often; the asker is never the answerer). The
// asker browses their hand and taps a card (30 s, then a random one is played
// for them). It flips up on every screen, big, with both names. The answerer
// answers out loud: "Answer" slides their mask off, "Pass" keeps it on (no
// penalty, the turn moves on). While they talk, listeners can tap "Same" (I
// relate; only the count is ever shown) or "Go deeper" (a gentle follow-up
// the answerer can take or pass). "Done", the asker's hand refills to 5, next.
//
// The end: everyone's characters together, masks off, and how many "Same"
// taps the game had ("12 moments you weren't alone"). No ranking: everyone
// who answered at least once gets the same coins (score 1, everyone else 0),
// and it counts as one of the party's 3 games.
//
// Answers are spoken out loud, never typed, sent or stored. The deck is
// web/data/mask_off_cards.json; card ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MASKOFF } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, hostSkip, bindHostSkip, trash, roomBackdrop } from "./../hpkit.js";
import { fairPick } from "./../fairpick.js";
import { renderLook } from "./../charrender.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));
const M = MASKOFF;
export const LEVELS = { 1: "light", 2: "real", 3: "deep" };

// ---------------------------------------------------------------- the deck
let POOL = null;
const poolReady = fetch(new URL(`../${M.POOL_URL}`, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => { POOL = (j.cards || []).filter(c => c && c.id && c.text && LEVELS[c.level]); return POOL; })
  .catch(e => { console.warn("[maskoff] couldn't load the cards", e); POOL = []; return POOL; });
export const maskPool = () => poolReady;
const cardOf = id => POOL?.find(c => c.id === id) ?? null;

// who answers next: whoever has been asked least (ties: the fair picker),
// never the same person twice in a row when anyone else is level with them
export function pickAnswerer(asked, weights, ids, last, rng) {
  if (!ids.length) return { id: null, weights };
  const low = Math.min(...ids.map(id => asked[id] ?? 0));
  let cands = ids.filter(id => (asked[id] ?? 0) === low);
  if (cands.length > 1) cands = cands.filter(id => id !== last);
  return fairPick(weights, cands, rng);
}
// who asks: the next one round the table who isn't answering
export function pickAsker(order, from, who) {
  const ids = order.filter(id => id !== who);
  if (!ids.length) return { id: null, next: from };
  return { id: ids[from % ids.length], next: from + 1 };
}

// ---------------------------------------------------------------- the mask
const MASK_SVG = `<svg viewBox="0 0 60 46" aria-hidden="true">
  <path class="mo-m-face" d="M4 7Q30-2 56 7Q59 25 46 37Q30 47 14 37Q1 25 4 7Z"/>
  <path class="mo-m-eye" d="M12 17Q18.5 10 25 17Q18.5 21 12 17ZM35 17Q41.5 10 48 17Q41.5 21 35 17Z"/>
  <path class="mo-m-brow" d="M11 12Q18 7 25 11M35 11Q42 7 49 12"/>
  <path class="mo-m-mouth" d="M23 30Q30 33 37 30"/>
</svg>`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const MASK_OFF = {
  id: "mask_off", title: "Mask Off",
  blurb: "a slow one. ask someone a question from your hand, they answer out loud — or pass. tap \"same\" when you relate. no scores.",
  minPlayers: 3, maxPlayers: 12, length: "~2 min per turn",
  backdrop: "room",            // played over the party room (dimmed), not the map
  // the deck and the rounds are the host's own setup: everyone else waits in
  // the lobby, and the host can back out of it (party.js)
  hostSetup: ["setup"],

  start(ctx) {
    if (!POOL) { ui.show(); ui.stage("Mask Off", `<div class="mo-game"><p class="ab-sub">shuffling the cards…</p></div>`, "loading"); poolReady.then(() => this._start(ctx)); return; }
    this._start(ctx);
  },

  _start(ctx) {
    ui.show(); ui.theme("chill");
    roomBackdrop("lounge");     // a dim, warm lounge behind the cards
    const room = ctx.room;
    // ---- this phone's own state: reset per turn in render, keyed off the state
    let lastHud = 0, seenTurn = null, mySame = false, slid = -1, flipped = -1, endShown = false;
    const looks = new Map();
    trash.add(() => { looks.clear(); });
    // the host keeps who tapped "Same" to itself (one tap each): only the
    // count goes into the state, so no phone ever has the names
    const sameBy = new Map();

    const turn = s => s.turn ?? null;
    const avatarOf = id => room.members.find(m => m.id === id)?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? (game.s?.players?.[id]?.avatar ?? {});
    const nameOf = (s, id) => (id === ctx.me.id ? "you" : esc(s.players?.[id]?.handle ?? "someone"));
    const handOf = (s, id) => s.hands?.[id] ?? [];

    const rounds = new Rounds([
      { name: "setup", ms: M.SETUP_MS, done: s => !!s.setup.go, next: s => { begin(s); return "pick"; } },
      { name: "pick", ms: M.PICK_MS, enter: s => nextTurn(s), next: s => (turn(s)?.status === "left" ? "after" : "choose") },
      {
        name: "choose", ms: M.CHOOSE_MS,
        done: s => !!turn(s)?.card,
        // time's up: a random card from the asker's hand
        next: s => {
          const t = turn(s);
          if (!t.card) play(s, pickRandom(s, handOf(s, t.asker)), true);
          if (!t.card) t.status = "passed";            // an empty hand (the whole deck played): nothing to ask
          return t.card ? "talk" : "after";
        },
      },
      {
        name: "talk", ms: M.TALK_MS,
        done: s => ["passed", "done", "left"].includes(turn(s)?.status),
        next: s => { const t = turn(s); if (t.status === "answering" || !t.status) t.status = t.status ? "done" : "passed"; return "after"; },
      },
      {
        name: "after", ms: M.AFTER_MS,
        enter: s => wrapUp(s),
        next: s => (s.ti + 1 < s.turns ? (s.ti++, "pick") : "end"),
      },
      { name: "end", ms: M.END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "pick" || name === "end") sfx.chime();
      },
    });

    const seat = (id, handle, isBot, avatar = null) => ({ id, handle, isBot, score: 0, gone: false, ...(isBot && avatar ? { avatar } : {}) });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true, b.avatar);
        s.setup = { levels: M.LEVELS_DEFAULT.slice(), rounds: M.ROUNDS_DEFAULT, go: false };
        rounds.enter(s, "setup");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const t = turn(s);
        // someone in the turn left: it ends there, nobody waits on them
        if (t && !t.status && ["pick", "choose", "talk"].includes(s.phase) && (s.players[t.who]?.gone || (s.phase !== "talk" && s.players[t.asker]?.gone))) {
          t.status = "left";
          if (s.phase !== "pick") rounds.enter(s, "after");
        }
        if (t && s.phase === "talk" && t.status === "answering" && s.players[t.who]?.gone) t.status = "done";
        bots(s, dt);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const fromHost = m.from === room.hostId;
        if (m.in === "skip" && fromHost && s.phase !== "setup") { s.left = 0; return; }
        if (s.phase === "setup") {
          if (!fromHost) return;
          const lv = new Set(s.setup.levels);
          if (m.in === "mo-lv" && LEVELS[+m.l]) { if (m.on) lv.add(+m.l); else if (lv.size > 1) lv.delete(+m.l); }
          s.setup.levels = [1, 2, 3].filter(l => lv.has(l));
          if (m.in === "mo-rounds") { const n = Math.round(Number(m.n)); if (n >= 1 && n <= M.MAX_ROUNDS) s.setup.rounds = n; }
          if (m.in === "mo-go") s.setup.go = true;
          return;
        }
        const t = turn(s), p = s.players[m.from];
        if (!t || !p || t.status === "left") return;
        if (s.phase === "choose" && m.in === "ask" && m.from === t.asker && !t.card && handOf(s, t.asker).includes(m.id)) play(s, m.id, false);
        if (s.phase !== "talk") return;
        if (m.from === t.who) {
          if (m.in === "answer" && !t.status) t.status = "answering";
          else if (m.in === "pass" && !t.status) t.status = "passed";
          else if (m.in === "done" && t.status === "answering") t.status = "done";
          else if (m.in === "deeper-take" && t.deeper && !t.deeper.state) t.deeper.state = "took";
          else if (m.in === "deeper-pass" && t.deeper && !t.deeper.state) t.deeper.state = "passed";
          return;
        }
        if (t.status !== "answering") return;
        if (m.in === "same") {
          const by = sameBy.get(s.ti) ?? new Set();
          if (!by.has(m.from)) { by.add(m.from); sameBy.set(s.ti, by); t.same++; s.sameTotal++; }
        }
        if (m.in === "deeper" && (!t.deeper || t.deeper.state) && t.deepers < M.DEEPER_MAX) {
          const text = M.DEEPER[(s.deeperN ?? 0) % M.DEEPER.length];
          s.deeperN = (s.deeperN ?? 0) + 1;
          t.deepers++;
          t.deeper = { text, state: null, n: t.deepers };
        }
      },
      render(s) { renderMO(s); },
      onEvent() {},
    }, { hz: 4 });

    // ---- host: the deck, the hands, the turns
    // setup's done: shuffle the chosen levels and deal everyone a hand
    function begin(s) {
      const ids = POOL.filter(c => s.setup.levels.includes(c.level)).map(c => c.id);
      s.deck = shuffle(game.rng, ids);
      s.played = [];
      s.hands = {};
      for (const p of active(s)) s.hands[p.id] = s.deck.splice(0, M.HAND);
      s.order = active(s).map(p => p.id);
      s.asked = {}; s.weights = {}; s.ai = 0; s.ti = 0; s.sameTotal = 0; s.deeperN = 0;
      s.turns = Math.max(1, s.setup.rounds * active(s).length);
      s.turn = null;
    }
    // top a hand up to 5 from the deck. Only if the whole deck has been
    // played does a card come round again (cards in hands never do).
    function refill(s, id) {
      const h = (s.hands[id] ??= []);
      if (!s.deck.length && h.length === 0) {
        const held = new Set(Object.values(s.hands).flat());
        s.deck = shuffle(game.rng, s.played.filter(x => !held.has(x)));
      }
      while (h.length < M.HAND && s.deck.length) h.push(s.deck.shift());
    }
    function nextTurn(s) {
      const ids = active(s).map(p => p.id);
      for (const id of ids) if (!s.order.includes(id)) s.order.push(id);
      const who = pickAnswerer(s.asked, s.weights, ids, s.turn?.who ?? null, game.rng);
      s.weights = who.weights;
      const asker = pickAsker(s.order.filter(id => ids.includes(id)), s.ai, who.id);
      s.ai = asker.next;
      s.asked[who.id] = (s.asked[who.id] ?? 0) + 1;
      refill(s, asker.id);
      s.turn = { no: s.ti + 1, asker: asker.id, who: who.id, card: null, auto: false, status: who.id && asker.id ? null : "left", same: 0, deeper: null, deepers: 0 };
    }
    const pickRandom = (s, hand) => hand.length ? hand[Math.floor(game.rng() * hand.length)] : null;
    function play(s, id, auto) {
      const t = turn(s), c = cardOf(id);
      if (!t || !c) return;
      const h = handOf(s, t.asker);
      if (h.includes(id)) h.splice(h.indexOf(id), 1);
      s.played.push(id);
      t.card = { id: c.id, text: c.text, level: c.level };
      t.auto = auto;
    }
    // the turn's over: the asker's hand refills, an answer counts
    function wrapUp(s) {
      const t = turn(s);
      if (!t) return;
      if (t.asker && s.hands[t.asker]) refill(s, t.asker);
      if (t.status === "done" && s.players[t.who]) s.players[t.who].score = 1;
    }
    // the offline demo's bots
    function bots(s, dt) {
      const t = turn(s), bot = id => s.players[id]?.isBot, r = () => game.rng();
      if (!t || t.status === "left") return;
      if (s.phase === "choose" && !t.card && bot(t.asker) && r() < dt * 0.3) play(s, pickRandom(s, handOf(s, t.asker)), false);
      if (s.phase !== "talk") return;
      if (bot(t.who)) {
        if (!t.status && r() < dt * 0.5) t.status = r() < 0.15 ? "passed" : "answering";
        else if (t.deeper && !t.deeper.state && r() < dt * 0.4) t.deeper.state = r() < 0.6 ? "took" : "passed";
        else if (t.status === "answering" && (!t.deeper || t.deeper.state) && r() < dt * 0.12) t.status = "done";
      }
      if (t.status !== "answering") return;
      for (const p of active(s)) {
        if (!p.isBot || p.id === t.who) continue;
        const by = sameBy.get(s.ti) ?? new Set();
        if (!by.has(p.id) && r() < dt * 0.08) { by.add(p.id); sameBy.set(s.ti, by); t.same++; s.sameTotal++; }
      }
    }

    // ---- the players' 3D characters, as pictures (charrender.js)
    function lookImg(id, frame, cls = "") {
      const k = `${id}:${frame}`;
      if (!looks.has(k)) {
        looks.set(k, null);
        renderLook(avatarOf(id), { frame }).then(url => {
          if (!looks.has(k)) return;
          looks.set(k, url);
          document.querySelectorAll(`img[data-look="${CSS.escape(k)}"]`).forEach(el => { el.src = url; });
        });
      }
      const url = looks.get(k);
      return `<img class="mo-look ${frame} ${cls}" data-look="${esc(k)}" alt="" ${url ? `src="${url}"` : ""}>`;
    }
    // a character with the mask on its face; `.off` slides it away
    const masked = (id, cls = "") => `<div class="mo-masked ${cls}">${lookImg(id, "head")}<div class="mo-mask">${MASK_SVG}</div></div>`;
    const cardHtml = (s, t, cls = "") => `<div class="mo-card ${cls}"><div class="mo-card-in">
      <div class="mo-ask"><b>${nameOf(s, t.asker)}</b> <i>${t.asker === ctx.me.id ? "ask" : "asks"}</i> <b>${nameOf(s, t.who)}</b></div>
      <div class="mo-text">${esc(t.card?.text ?? "…")}</div>
      <em class="mo-lv l${t.card?.level ?? 1}">${LEVELS[t.card?.level ?? 1]}</em></div></div>`;
    const hearts = n => `<div class="mo-hearts">${Array.from({ length: Math.min(n, 12) }, (_, i) => `<i style="--i:${i};--x:${((i * 37) % 100) - 50}px">♥</i>`).join("")}</div>`;

    // ---- render ----
    function renderMO(s) {
      const t = turn(s);
      // per-turn local state resets on every phone, keyed off the state
      if (s.ti !== seenTurn) { seenTurn = s.ti; mySame = false; }
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const step = s.phase === "end" ? "masks off" : s.phase === "setup" ? "setup" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || "?"}`;
      const timed = s.phase === "choose";
      ui.hud(`<div class="hq"><b>MASK OFF</b><span>${step}</span>${timed ? `<span class="clk">${ui.clock(s.left)}</span>` : ""}</div>`);

      if (s.phase === "setup") return renderSetup(s);
      if (s.phase === "end") return renderEnd(s);
      if (!t) return;
      const asker = t.asker === ctx.me.id, answering = t.who === ctx.me.id;

      if (s.phase === "pick") {
        if (!ui.once(`p:${s.ti}`, () => {})) return;
        const line = asker ? `you <i>→ asking</i> ${nameOf(s, t.who)}` : answering ? `${nameOf(s, t.asker)} <i>→ asking</i> you` : `${nameOf(s, t.asker)} <i>→ asking</i> ${nameOf(s, t.who)}`;
        ui.stage("", `<div class="mo-game mo-pick">
            <div class="mo-pair"><div class="mo-p a">${lookImg(t.asker, "head")}<span>${nameOf(s, t.asker)}</span></div>
              <div class="mo-arrow">→</div>
              <div class="mo-p b">${masked(t.who)}<span>${nameOf(s, t.who)}</span></div></div>
            <div class="mo-line">${line}</div></div>${hostSkip(ctx)}`, `turn ${t.no} of ${s.turns}`);
        bindHostSkip(game);
        return;
      }

      if (s.phase === "choose") {
        if (asker) {
          const hand = handOf(s, ctx.me.id).map(cardOf).filter(Boolean);
          if (ui.once(`c:${s.ti}:${hand.map(c => c.id).join(",")}`, () => {})) {
            ui.stage(`ask ${nameOf(s, t.who)}`, `<div class="mo-game mo-choose">
                <p class="ab-sub">your hand · only you can see it. tap one to ask.</p>
                <div class="mo-hand">${hand.map((c, i) => `<button type="button" class="mo-hc l${c.level}" data-ask="${esc(c.id)}" style="--i:${i}"><em>${LEVELS[c.level]}</em><span>${esc(c.text)}</span></button>`).join("")}</div>
                <p class="mo-nudge" id="mo-nudge"></p></div>${hostSkip(ctx)}`, "your question");
            $("game-panel").querySelectorAll("[data-ask]").forEach(b => b.onclick = () => {
              $("game-panel").querySelectorAll("[data-ask]").forEach(x => { x.disabled = true; x.classList.toggle("on", x === b); });
              game.input("ask", { id: b.dataset.ask }); sfx.pop(); buzz(15);
            });
            bindHostSkip(game);
          }
          const n = $("mo-nudge");
          if (n) n.textContent = s.left <= M.NUDGE_MS ? `no rush… one will pick itself in ${Math.ceil(s.left / 1000)}s` : "";
          return;
        }
        if (!ui.once(`cw:${s.ti}`, () => {})) return;
        ui.stage("", `<div class="mo-game mo-wait">
            <div class="mo-backs">${Array.from({ length: M.HAND }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>
            <div class="mo-line">${nameOf(s, t.asker)} is choosing a question for ${nameOf(s, t.who)}…</div></div>${hostSkip(ctx)}`, answering ? "it's for you" : "a question is coming");
        bindHostSkip(game);
        return;
      }

      if (s.phase === "talk") {
        const d = t.deeper;
        const key = `t:${s.ti}:${t.status ?? "-"}:${d ? `${d.n}${d.state ?? ""}` : "-"}:${mySame ? 1 : 0}`;
        if (!ui.once(key, () => {})) return;
        // the card flips up once per turn; the mask slides off once
        const flip = flipped !== s.ti ? "flip" : ""; flipped = s.ti;
        const off = t.status === "answering" || t.status === "done";
        const slide = off && slid !== s.ti ? "sliding" : ""; if (off) slid = s.ti;
        if (flip) sfx.whoosh();
        if (slide) { sfx.chime(); if (answering) buzz(20); }
        const nudge = d && !d.state ? `<div class="mo-deeper ${answering ? "mine" : ""}"><small>go deeper</small><b>${esc(d.text)}</b>
            ${answering ? `<div class="mo-row"><button type="button" class="mo-btn soft" id="mo-dtake">take it</button><button type="button" class="mo-btn ghost" id="mo-dpass">pass</button></div>` : `<span>waiting on ${nameOf(s, t.who)}</span>`}</div>`
          : d?.state === "took" ? `<div class="mo-deeper took"><small>going deeper</small><b>${esc(d.text)}</b></div>` : "";
        let controls;
        if (answering) {
          controls = !t.status
            ? `<div class="mo-row"><button type="button" class="mo-btn warm" id="mo-answer">Answer</button><button type="button" class="mo-btn ghost" id="mo-pass">Pass</button></div>
               <p class="ab-sub">answer out loud. passing is fine — the mask just stays on.</p>`
            : `${nudge}<div class="mo-row"><button type="button" class="mo-btn soft" id="mo-done">Done</button></div><p class="ab-sub">take your time.</p>`;
        } else {
          controls = !t.status
            ? `<p class="mo-line small">${nameOf(s, t.who)} is deciding…</p>`
            : `${nudge}<div class="mo-row">
                <button type="button" class="mo-btn same ${mySame ? "on" : ""}" id="mo-same" ${mySame ? "disabled" : ""}>${mySame ? "♥ same" : "♡ Same"}</button>
                <button type="button" class="mo-btn ghost" id="mo-deep" ${(d && !d.state) || t.deepers >= M.DEEPER_MAX ? "disabled" : ""}>Go deeper</button></div>
               <p class="ab-sub">listening. nobody sees who tapped same.</p>`;
        }
        ui.stage("", `<div class="mo-game mo-talk">${cardHtml(s, t, flip)}
            ${masked(t.who, `${off ? "off" : ""} ${slide}`)}
            ${controls}</div>${hostSkip(ctx)}`, t.auto ? "the deck picked this one" : "");
        const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
        on("mo-answer", () => { game.input("answer"); });
        on("mo-pass", () => { game.input("pass"); sfx.back(); });
        on("mo-done", () => { game.input("done"); sfx.pop(); });
        on("mo-dtake", () => { game.input("deeper-take"); sfx.pop(); });
        on("mo-dpass", () => { game.input("deeper-pass"); sfx.back(); });
        on("mo-same", () => { if (mySame) return; mySame = true; game.input("same"); sfx.pop(); buzz(12); ui.resetKey(); });
        on("mo-deep", () => { game.input("deeper"); sfx.cursor(); });
        bindHostSkip(game);
        return;
      }

      if (s.phase === "after") {
        if (!ui.once(`a:${s.ti}`, () => {})) return;
        let body;
        if (t.status === "left") body = `<p class="mo-line">someone had to go. on to the next one.</p>`;
        else if (t.status === "passed") body = `${t.card ? cardHtml(s, t, "small") : ""}${masked(t.who)}<p class="mo-line">${answering ? "you passed" : `${nameOf(s, t.who)} passed`} — the mask stays on. that's okay.</p>`;
        else body = `${cardHtml(s, t, "small")}${masked(t.who, "off")}
          ${t.same ? `${hearts(t.same)}<p class="mo-line">${t.same === 1 ? "someone felt this too" : `${t.same} people felt this too`}</p>` : `<p class="mo-line">thank you for sharing.</p>`}`;
        ui.stage("", `<div class="mo-game mo-after">${body}</div>${hostSkip(ctx)}`, "");
        bindHostSkip(game);
        return;
      }
    }

    function renderSetup(s) {
      if (!ctx.isHost()) {
        if (ui.once("su:guest", () => {})) ui.stage("", `<div class="mo-game"><p class="mo-line">${nameOf(s, room.hostId)} is shuffling the deck…</p></div>`, "Mask Off");
        return;
      }
      const lv = new Set(s.setup.levels), R = s.setup.rounds, n = active(s).length;
      if (!ui.once(`su:${[...lv].join("")}:${R}:${n}`, () => {})) return;
      const count = l => POOL.filter(c => c.level === l).length;
      const sample = l => POOL.find(c => c.level === l)?.text ?? "";
      const total = [...lv].reduce((a, l) => a + count(l), 0);
      ui.stage("set the deck", `<div class="mo-game mo-setup">
          ${[1, 2, 3].map(l => `<button type="button" class="mo-lvl l${l} ${lv.has(l) ? "on" : ""}" data-lv="${l}" ${lv.has(l) && lv.size === 1 ? "aria-disabled=\"true\"" : ""}>
            <i class="mo-chk"></i><span><b>${LEVELS[l]}</b><small>${count(l)} cards · “${esc(sample(l))}”</small></span></button>`).join("")}
          <div class="mo-rounds"><span>rounds</span>
            ${[1, 2, 3].slice(0, M.MAX_ROUNDS).map(r => `<button type="button" class="mo-r ${r === R ? "on" : ""}" data-rounds="${r}">${["", "everyone once", "everyone twice", "three times"][r]}</button>`).join("")}</div>
          <button type="button" class="pt-btn pt-primary mo-go" id="mo-go">deal · ${plural(R * n, "turn")}</button>
          <p class="ab-sub">${total} cards in the deck · 5 in each hand, private</p></div>`, "host");
      const panel = $("game-panel");
      panel.querySelectorAll("[data-lv]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("mo-lv", { l: +b.dataset.lv, on: !b.classList.contains("on") }); });
      panel.querySelectorAll("[data-rounds]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("mo-rounds", { n: +b.dataset.rounds }); });
      $("mo-go").onclick = () => { sfx.confirm(); game.input("mo-go"); $("mo-go").disabled = true; };
    }

    // a calm "masks off": everyone together, and how often nobody was alone
    function renderEnd(s) {
      if (!ui.once("end", () => {})) return;
      const P = Object.values(s.players || {}).filter(p => !p.gone);
      const n = s.sameTotal ?? 0;
      const line = n ? `${n} ${n === 1 ? "moment" : "moments"} you weren't alone` : "thank you for being here";
      ui.panel(`<div class="mo-end">
          <div class="mo-end-k">masks off</div>
          <div class="mo-crowd">${P.map((p, i) => `<figure style="--i:${i}">${lookImg(p.id, "full")}<i class="mo-fall">${MASK_SVG}</i><figcaption>${esc(p.handle)}</figcaption></figure>`).join("")}</div>
          <div class="mo-end-n">${n ? hearts(Math.min(n, 12)) : ""}<b>${line}</b></div>
          <p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx, "host: back to the party")}</div>`, "mo-end-wrap");
      bindHostSkip(game);
      if (!endShown) { endShown = true; buzz(20); }
    }

    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "setup", left: M.SETUP_MS, players: {}, setup: { levels: M.LEVELS_DEFAULT.slice(), rounds: M.ROUNDS_DEFAULT, go: false }, hands: {}, deck: [], played: [], asked: {}, weights: {}, order: [], ai: 0, ti: 0, turns: 1, turn: null, sameTotal: 0 });
    const o = ctx.onEnd;
    ctx.onEnd = r => { game.stop(); ui.hide(); o(r); };
  },
};
