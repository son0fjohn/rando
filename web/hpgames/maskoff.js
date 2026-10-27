// Mask Off (3+) — a slow, sentimental card game round a table. No scores,
// no ratings, no judging.
//
// The host picks which levels are in the deck (light, real, deep; light +
// real by default) and how many rounds (everyone asks twice by default).
// Everyone is dealt a private hand of 5 question cards; nobody else sees it,
// and no card is dealt twice in a game.
//
// The room (roundtable.js): everyone's own 3D character sits round a table
// under one low lamp, all in plain cream masks. Every phone looks from its
// own seat, first person, its hand of cards fanned at the bottom.
//
// A turn goes round the table clockwise. It's your turn: your hand glows,
// "Pick someone to ask." Tap anyone at the table (not yourself, not whoever
// was asked last turn; whoever hasn't been asked yet glows gently), pick a
// card and tap "Ask" (or the clock picks for you). The card flies to the
// middle of the table and flips up, big, for everyone: "[you] → [them]".
// You draw a new card, so you always hold 5. They answer out loud: "Answer"
// slides their mask off onto the table, "Pass" keeps it on (no penalty, the
// turn moves on). While they talk, the others can tap "Same" (only the count
// is ever shown: "3 people felt this too") or "Go deeper" (a gentle
// follow-up the answerer can take or pass). "Done": the mask goes back on,
// the next one round the table asks.
//
// The end: the camera lifts above the table, every mask off, and how many
// "Same" taps the game had ("12 moments you weren't alone"). No ranking:
// everyone who answered at least once gets the same coins (score 1, everyone
// else 0), and it counts as one of the party's 3 games.
//
// Answers are spoken out loud, never typed, sent or stored. The deck is
// web/data/mask_off_cards.json; card ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MASKOFF } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, hostSkip, bindHostSkip, trash, roomBackdrop } from "./../hpkit.js";
import { fairPick } from "./../fairpick.js";
import { SKIN4_RGB, normalizeAvatar4 } from "./../items4.js";
import { dialogBox } from "./../dialog.js";
import { HOWTO_MS, howto, howtoOn, howtoInput, howtoDone, howtoTally } from "./../howto.js";
import { t as tr } from "./../i18n.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(11, +params.get("bots") || 0));
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

// ---------------------------------------------------------------- the turn rules
// who asks: the next one round the table (clockwise), among those still here
export function nextAsker(order, ai, ids) {
  const seated = order.filter(id => ids.includes(id));
  if (!seated.length) return { id: null, next: ai };
  return { id: seated[ai % seated.length], next: ai + 1 };
}
// who the asker may pick: anyone here but themselves and whoever was asked
// last turn (unless that leaves nobody)
export function canAsk(ids, asker, last) {
  const others = ids.filter(id => id !== asker);
  const fresh = others.filter(id => id !== last);
  return fresh.length ? fresh : others;
}
// who hasn't been asked yet (fewest times so far): they glow at the table
export function notAskedYet(asked, ids) {
  if (!ids.length) return [];
  const low = Math.min(...ids.map(id => asked[id] ?? 0));
  return ids.filter(id => (asked[id] ?? 0) === low);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const reduce = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// two hands, in your own skin tone, holding the cards
const HANDS = skin => `<svg class="mo-hands" viewBox="0 0 390 120" aria-hidden="true" style="--skin:${skin}">
  <path class="mo-hand-l" d="M30 120 C 34 92 52 70 78 62 C 96 57 112 64 116 76 C 120 88 108 92 98 92 C 112 96 118 108 110 120 Z"/>
  <path class="mo-hand-r" d="M360 120 C 356 92 338 70 312 62 C 294 57 278 64 274 76 C 270 88 282 92 292 92 C 278 96 272 108 280 120 Z"/>
</svg>`;

export const MASK_OFF = {
  id: "mask_off", title: "Mask Off",
  blurb: "a slow one, round a table. pick someone, ask a question from your hand, they answer out loud — or pass. tap \"same\" when you relate. no scores.",
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
    const room = ctx.room;
    // ---- this phone's own state: reset per turn in render, keyed off the state
    let lastHud = 0, seenTurn = null, mySame = false, raised = null, myPick = null, flownTurn = -1, endShown = false, heldHand = [];
    // the host keeps who tapped "Same" to itself (one tap each): only the
    // count goes into the state, so no phone ever has the names
    const sameBy = new Map();

    const turn = s => s.turn ?? null;
    const avatarOf = id => room.members.find(m => m.id === id)?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? (game.s?.players?.[id]?.avatar ?? {});
    const nameOf = (s, id) => (id === ctx.me.id ? "you" : esc(s.players?.[id]?.handle ?? "someone"));
    const handOf = (s, id) => s.hands?.[id] ?? [];
    // no host at this table: what to do next comes up in the dialog box, in
    // the same place as every game's (theme.css "the shared game screen")
    const dlg = dialogBox(document.createElement("div"), { name: tr("host.mask_off"), blip: () => sfx.blip?.() });
    trash.add(() => dlg.dispose());
    const say = text => { if (!text) return; dlg.show(); if (dlg.text !== text && !dlg.quipping) dlg.say(text); };
    const how = howto("mask_off", { dlg, send: v => game.input(v) });

    const rounds = new Rounds([
      { name: "setup", ms: M.SETUP_MS, done: s => !!s.setup.go, next: s => { begin(s); return howtoOn(ctx) ? "howto" : "pick"; } },
      // how it goes (howto.js), in the dialog box: over once everyone's read it
      { name: "howto", ms: HOWTO_MS, enter: s => { s.howto = {}; }, done: howtoDone, next: () => "pick" },
      { name: "pick", ms: M.PICK_MS, enter: s => nextTurn(s), next: s => (turn(s)?.status === "left" ? "after" : "choose") },
      {
        name: "choose", ms: M.CHOOSE_MS,
        done: s => !!turn(s)?.card,
        // time's up: someone who hasn't been asked yet, and a random card
        next: s => {
          const t = turn(s);
          if (!t.card) {
            if (!t.who) t.who = autoWho(s);
            play(s, pickRandom(s, handOf(s, t.asker)), true);
          }
          if (!t.card) t.status = "passed";            // an empty hand (the whole deck played) or nobody to ask
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
        if (t && !t.status && ["pick", "choose", "talk"].includes(s.phase) && ((t.who && s.players[t.who]?.gone) || (s.phase !== "talk" && s.players[t.asker]?.gone))) {
          if (s.phase === "choose" && !t.card && t.who && s.players[t.who]?.gone && !s.players[t.asker]?.gone) t.who = null;   // (just pick someone else)
          else { t.status = "left"; if (s.phase !== "pick") rounds.enter(s, "after"); }
        }
        if (t && s.phase === "talk" && t.status === "answering" && s.players[t.who]?.gone) t.status = "done";
        bots(s, dt);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const fromHost = m.from === room.hostId;
        if (m.in === "skip" && fromHost && s.phase !== "setup") { s.left = 0; return; }
        if (howtoInput(s, m)) return;
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
        if (s.phase === "choose" && m.from === t.asker && !t.card) {
          // the asker picks who (they can change their mind until they ask)
          if ((m.in === "who" || m.in === "ask") && m.who !== undefined) {
            if (canAsk(active(s).map(x => x.id), t.asker, s.lastWho).includes(m.who)) t.who = m.who;
          }
          if (m.in === "ask" && t.who && handOf(s, t.asker).includes(m.id)) play(s, m.id, false);
          return;
        }
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
    // setup's done: shuffle the chosen levels, deal everyone a hand, seat them
    function begin(s) {
      const ids = POOL.filter(c => s.setup.levels.includes(c.level)).map(c => c.id);
      s.deck = shuffle(game.rng, ids);
      s.played = [];
      s.hands = {};
      for (const p of active(s)) s.hands[p.id] = s.deck.splice(0, M.HAND);
      s.order = active(s).map(p => p.id);           // round the table, clockwise
      s.asked = {}; s.weights = {}; s.ai = 0; s.ti = 0; s.sameTotal = 0; s.deeperN = 0; s.lastWho = null;
      s.turns = Math.max(1, s.setup.rounds * active(s).length);
      s.turn = null;
    }
    // top a hand up to 5 from the deck. Only if the whole deck has been
    // played does a card come round again (cards in hands never do).
    function refill(s, id) {
      const h = (s.hands[id] ??= []);
      if (!s.deck.length && h.length < M.HAND) {
        const held = new Set(Object.values(s.hands).flat());
        s.deck = shuffle(game.rng, s.played.filter(x => !held.has(x)));
      }
      while (h.length < M.HAND && s.deck.length) h.push(s.deck.shift());
    }
    function nextTurn(s) {
      const ids = active(s).map(p => p.id);
      for (const id of ids) if (!s.order.includes(id)) s.order.push(id);   // (a late joiner takes a seat)
      const asker = nextAsker(s.order, s.ai, ids);
      s.ai = asker.next;
      if (asker.id) refill(s, asker.id);
      s.turn = { no: s.ti + 1, asker: asker.id, who: null, card: null, auto: false, status: asker.id && ids.length > 1 ? null : "left", same: 0, deeper: null, deepers: 0 };
    }
    // nobody picked in time: someone who hasn't been asked yet (fair-random)
    function autoWho(s) {
      const t = turn(s), ids = active(s).map(p => p.id);
      const ok = canAsk(ids, t.asker, s.lastWho);
      const fresh = notAskedYet(s.asked, ok);
      const r = fairPick(s.weights, fresh.length ? fresh : ok, game.rng);
      s.weights = r.weights;
      return r.id;
    }
    const pickRandom = (s, hand) => hand.length ? hand[Math.floor(game.rng() * hand.length)] : null;
    // the card is asked: it leaves the asker's hand for the table, they draw a new one
    function play(s, id, auto) {
      const t = turn(s), c = cardOf(id);
      if (!t || !c || !t.who) return;
      const h = handOf(s, t.asker);
      if (h.includes(id)) h.splice(h.indexOf(id), 1);
      s.played.push(id);
      refill(s, t.asker);
      t.card = { id: c.id, text: c.text, level: c.level };
      t.auto = auto;
      s.asked[t.who] = (s.asked[t.who] ?? 0) + 1;
    }
    // the turn's over: an answer counts; nobody can be asked twice in a row
    function wrapUp(s) {
      const t = turn(s);
      if (!t) return;
      if (t.who && t.card) s.lastWho = t.who;
      if (t.status === "done" && s.players[t.who]) s.players[t.who].score = 1;
    }
    // the offline demo's bots
    function bots(s, dt) {
      const t = turn(s), bot = id => s.players[id]?.isBot, r = () => game.rng();
      if (!t || t.status === "left") return;
      if (s.phase === "choose" && !t.card && bot(t.asker)) {
        if (!t.who && r() < dt * 0.8) t.who = autoWho(s);
        else if (t.who && r() < dt * 0.4) play(s, pickRandom(s, handOf(s, t.asker)), false);
      }
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

    // ---- the table (roundtable.js): one for the whole game, moved into the
    // room whenever it's (re)built. It loads while the host sets the deck.
    let rt = null, rtP = null, track = 0, seatedKey = "";
    const holder = document.createElement("div");
    const loadTable = () => (rtP ??= import("./../roundtable.js").then(m => m.roundTable(holder)).then(r => {
      rt = r; globalThis.__table = r;          // for the tests
      r.onTap = id => pickWho(id);
      return r;
    }).catch(e => {
      console.warn("[maskoff] no 3D table, the cards and names stay:", e?.message ?? e);
      roomBackdrop("lounge");                 // (a warm room behind it, if that can run)
      return null;
    }));
    loadTable();
    sfx.musicStart();
    trash.add(() => { sfx.musicStop(); cancelAnimationFrame(track); rtP?.then(r => r?.dispose()); rt = null; rtP = null; if (globalThis.__table) globalThis.__table = null; });
    const room$ = () => $("mo-room");

    function ensureRoom() {
      if (room$()) return false;
      seatedKey = "";
      const skin = SKIN4_RGB[normalizeAvatar4(avatarOf(ctx.me.id) ?? {}).skin] ?? [228, 182, 146];
      ui.panel(`<div class="np-room mo-room" id="mo-room">
          <div class="mo-3d" id="mo-3d"></div>
          <div class="np-pill mo-who" id="mo-who"></div>
          <div class="mo-top"><div class="mo-seatbar" id="mo-seatbar"></div></div>
          <div class="mo-chips" id="mo-chips"></div>
          <div class="mo-flyer" id="mo-flyer"></div>
          <div class="mo-center" id="mo-center"></div>
          <div class="mo-motes" id="mo-motes"></div>
          <div class="mo-low gs-low">
            ${hostSkip(ctx)}
            <div class="mo-handwrap" id="mo-handwrap">
              <div class="mo-deck" id="mo-deck"><i></i><i></i><i></i></div>
              <div class="mo-hand" id="mo-hand"></div>
              ${HANDS(`rgb(${skin.join(",")})`)}
            </div>
            <div class="mo-act gs-action" id="mo-act"></div>
            <div class="mo-dlg" id="mo-dlg"></div>
          </div>
        </div>`, "np-full mo-full");
      bindHostSkip(game);
      dlg.attach($("mo-dlg"));
      heldHand = [];
      loadTable().then(r => {
        const at = $("mo-3d");
        if (!r || !at) return;
        r.attach(at);
        seatedKey = "";
        if (game.s) seatTable(game.s);
        requestAnimationFrame(() => room$()?.classList.add("r3d"));
      });
      cancelAnimationFrame(track);
      const follow = () => { if (!room$()) return; placeChips(); track = requestAnimationFrame(follow); };
      track = requestAnimationFrame(follow);
      return true;
    }
    // everyone round the table, in turn order (the table seats 8; the rest
    // sit in the seat bar at the top)
    const tableOrder = s => (s.order?.length ? s.order : Object.keys(s.players ?? {})).filter(id => s.players[id] && !s.players[id].gone);
    function seatTable(s) {
      const ids = tableOrder(s), key = ids.join(",");
      if (!rt || key === seatedKey) return;
      seatedKey = key;
      rt.seat(ids.map(id => ({ id, name: s.players[id].handle, avatar: avatarOf(id) })), ctx.me.id);
    }
    // names over everyone's heads (tappable too: picking works without 3D),
    // and the seat bar for whoever isn't at the table
    let chipKey = "";
    function chips(s, { pickable = [], fresh = [], who = null, asker = null } = {}) {
      const ids = tableOrder(s).filter(id => id !== ctx.me.id);
      const seated = new Set(rt ? rt.info().seated : ids.slice(0, 7));
      const key = JSON.stringify([ids, pickable, fresh, who, asker, [...seated]]);
      if (key === chipKey) return;
      chipKey = key;
      const chip = id => `<button type="button" class="mo-chip ${pickable.includes(id) ? "can" : ""} ${fresh.includes(id) ? "fresh" : ""} ${who === id ? "on" : ""} ${asker === id ? "asker" : ""}" data-who="${esc(id)}" ${pickable.includes(id) ? "" : "tabindex=\"-1\""}>${esc(s.players[id]?.handle ?? "?")}</button>`;
      const c = $("mo-chips"), bar = $("mo-seatbar");
      if (c) c.innerHTML = ids.filter(id => seated.has(id)).map(chip).join("");
      if (bar) bar.innerHTML = ids.filter(id => !seated.has(id)).map(chip).join("");
      for (const b of document.querySelectorAll("#mo-room [data-who]")) b.onclick = () => pickWho(b.dataset.who);
    }
    function placeChips() {
      const rm = room$(), c = $("mo-chips");
      if (!rm || !c) return;
      const R = rm.getBoundingClientRect(), in3d = !!rt && rm.classList.contains("r3d");
      c.classList.toggle("in3d", in3d);
      if (!in3d) return;
      for (const el of c.children) {
        const p = rt.screen(el.dataset.who);
        if (!p) { el.style.visibility = "hidden"; continue; }
        el.style.visibility = "";
        // out of view: the name waits at the screen's edge (‹ or ›), still tappable
        const edge = !p.visible;
        el.classList.toggle("edge", edge);
        el.dataset.side = p.side < 0 ? "l" : "r";
        // (whole on screen: a name near the edge slides in)
        const w = el.offsetWidth, x = edge ? (p.side < 0 ? 8 : R.width - 8 - w) : Math.max(8, Math.min(R.width - 8 - w, p.x - R.left - w / 2));
        const y = Math.max(150, Math.min(R.height * 0.55, p.y - R.top));
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(0, -100%)`;
      }
    }
    // the asker taps someone at the table
    function pickWho(id) {
      const s = game.s, t = s && turn(s);
      if (!t || s.phase !== "choose" || t.asker !== ctx.me.id || t.card) return;
      if (!canAsk(active(s).map(p => p.id), t.asker, s.lastWho).includes(id)) {
        if (id === s.lastWho) { sfx.back(); flash(`${nameOf(s, id)} was just asked — pick someone else`); }
        return;
      }
      myPick = id; game.input("who", { who: id }); sfx.cursor(); buzz(10);
      lastHud = 0; renderMO(s);
    }
    // a passing warning, in the dialog box; the line before it comes back
    const flash = text => dlg.quip(text, { ms: 1800 });

    // ---- the hand: 5 cards fanned in your hands; tap one to raise it, again to lower
    function renderHand(s, { mine = false, canAskNow = false } = {}) {
      const el = $("mo-hand"), wrap = $("mo-handwrap");
      if (!el) return;
      const hand = handOf(s, ctx.me.id).map(cardOf).filter(Boolean);
      const ids = hand.map(c => c.id);
      if (raised && !ids.includes(raised)) raised = null;
      wrap.classList.toggle("turn", mine);
      wrap.classList.toggle("empty", !hand.length);
      const key = ids.join(",");
      if (el.dataset.key !== key) {
        // a new card: it's drawn from the deck (the one that just came in)
        const fresh = heldHand.length ? ids.filter(id => !heldHand.includes(id)) : [], firstDeal = !heldHand.length && ids.length > 0;
        heldHand = ids;
        el.dataset.key = key;
        el.innerHTML = hand.map((c, i) => `<button type="button" class="mo-hc l${c.level} ${fresh.includes(c.id) ? "drawn" : ""}" data-card="${esc(c.id)}" style="--i:${i};--n:${hand.length}">
            <em>${LEVELS[c.level]}</em><span>${esc(c.text)}</span></button>`).join("");
        if (fresh.length) sfx.flip(); else if (firstDeal) sfx.shuffle();
        el.querySelectorAll("[data-card]").forEach(b => b.onclick = () => {
          raised = raised === b.dataset.card ? null : b.dataset.card;
          sfx.flip(); lastHud = 0; renderMO(game.s);
        });
      }
      el.querySelectorAll("[data-card]").forEach(b => b.classList.toggle("up", b.dataset.card === raised));
      el.classList.toggle("has-up", !!raised);
      room$()?.classList.toggle("raised", !!raised);
      // the Ask button rides the raised card, once there's someone to ask
      const act = $("mo-act");
      if (mine && act) {
        const who = turn(s)?.who ?? myPick;
        const html = raised && who ? `<button type="button" class="mo-btn warm" id="mo-ask">Ask ${nameOf(s, who)}</button>` : "";
        if (act.dataset.k !== html) { act.dataset.k = html; act.innerHTML = html; }
        const b = $("mo-ask");
        if (b) b.onclick = () => {
          if (!canAskNow) return;
          b.disabled = true;
          flyFromHand(raised);
          game.input("ask", { id: raised, who }); sfx.whoosh(); buzz(15);
          raised = null;
        };
      }
    }
    // the asked card flies from your hand (or from the asker's seat) to the
    // middle of the table and flips up
    function flyFromHand(id) {
      const src = document.querySelector(`#mo-hand [data-card="${CSS.escape(id ?? "")}"]`), rm = room$(), f = $("mo-flyer");
      if (!src || !rm || !f) return;
      const R = rm.getBoundingClientRect(), b = src.getBoundingClientRect();
      flight(f, b.left - R.left + b.width / 2, b.top - R.top + b.height / 2);
    }
    function flight(f, x, y) {
      if (reduce()) return;
      f.innerHTML = `<div class="mo-fly" style="--x:${Math.round(x)}px;--y:${Math.round(y)}px"><div class="mo-fly-back"></div></div>`;
      setTimeout(() => { if (f.isConnected) f.innerHTML = ""; }, 900);
    }

    // ---- the asked card, big and readable over the table
    const centerHtml = (s, t) => `<div class="mo-card ${t.card ? "" : "back"}"><div class="mo-card-in">
        <div class="mo-ask"><b>${nameOf(s, t.asker)}</b> <i>→</i> <b>${nameOf(s, t.who)}</b></div>
        <div class="mo-text">${esc(t.card?.text ?? "…")}</div>
        <em class="mo-lv l${t.card?.level ?? 1}">${LEVELS[t.card?.level ?? 1]}</em></div></div>`;
    // my own "Same": a little warm glow rises from where I sit
    function myGlow() {
      const m = $("mo-motes"); if (!m || reduce()) return;
      const i = document.createElement("i"); m.appendChild(i);
      setTimeout(() => i.remove(), 2200);
    }

    // ---- render ----
    function renderMO(s) {
      const t = turn(s);
      // per-turn local state resets on every phone, keyed off the state
      if (s.ti !== seenTurn) { seenTurn = s.ti; mySame = false; myPick = null; raised = null; rt?.sameReset(); }
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const step = s.phase === "end" ? "masks off" : s.phase === "setup" ? "setup" : s.phase === "howto" ? "how to play" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || "?"}`;
      const timed = s.phase === "choose";
      ui.hud(`<div class="hq"><b>MASK OFF</b><span>${step}</span>${timed ? `<span class="clk">${ui.clock(s.left)}</span>` : ""}</div>`);

      if (s.phase === "setup") return renderSetup(s);
      ensureRoom();
      seatTable(s);
      room$()?.classList.toggle("howto", s.phase === "howto");
      if (s.phase === "howto") {
        rt?.state({ asker: null, who: null, picking: false, fresh: [], talker: null, off: [] });
        chips(s, {});
        renderHand(s);
        how.render(s, $("mo-act"));
        const w = $("mo-who"), pill = `how to play · <b>${howtoTally(s)}</b> ready`;
        if (w && w.innerHTML !== pill) w.innerHTML = pill;
        return;
      }
      how.stop();
      if (s.phase === "end") return renderEnd(s);
      if (!t) return;
      const asker = t.asker === ctx.me.id, answering = t.who === ctx.me.id;
      const ids = active(s).map(p => p.id);
      const pickable = asker && s.phase === "choose" && !t.card ? canAsk(ids, t.asker, s.lastWho) : [];
      const fresh = s.phase === "choose" && !t.card ? notAskedYet(s.asked ?? {}, canAsk(ids, t.asker, s.lastWho)) : [];
      const who = t.who ?? (asker ? myPick : null);
      const off = s.phase === "talk" && (t.status === "answering" || t.status === "done") ? [t.who] : [];
      rt?.state({ asker: t.asker, who: s.phase === "choose" || s.phase === "talk" ? who : null, picking: pickable.length > 0, fresh,
        talker: s.phase === "talk" ? t.who : t.asker, off });
      chips(s, { pickable, fresh, who, asker: t.asker });
      const whoEl = $("mo-who"), act = $("mo-act"), center = $("mo-center");
      const setWho = html => { if (whoEl && whoEl.innerHTML !== html) whoEl.innerHTML = html; };
      // (names in these lines are plain text: the dialog box never parses HTML)
      const name = id => (id === ctx.me.id ? "you" : s.players?.[id]?.handle ?? "someone");
      const setPrompt = say;
      const setAct = html => { if (act && act.dataset.k !== html) { act.dataset.k = html; act.innerHTML = html; return true; } return false; };
      const setCenter = html => { if (center && center.dataset.k !== html) { center.dataset.k = html; center.innerHTML = html; return true; } return false; };

      if (s.phase === "pick") {
        rt?.card(null);
        setWho(asker ? `your turn` : `${nameOf(s, t.asker)}'s turn`);
        setPrompt(asker ? "Your turn. Pick someone to ask." : `${name(t.asker)}'s turn to ask.`);
        setCenter(""); setAct("");
        renderHand(s);
        return;
      }

      if (s.phase === "choose") {
        rt?.card(null);
        setCenter("");
        if (asker) {
          setWho(who ? `you <i>→</i> ${nameOf(s, who)}` : "your turn");
          if (s.left <= M.NUDGE_MS) { const l = `No rush… the deck picks in ${Math.ceil(s.left / 1000)}s.`; if (dlg.text !== l && !dlg.quipping) dlg.set(l); }
          else setPrompt(!who ? "Pick someone to ask. Tap them at the table." : raised ? `Ask ${name(who)} that one?` : "Now a card from your hand.");
          renderHand(s, { mine: true, canAskNow: true });
          return;
        }
        setWho(who ? `${nameOf(s, t.asker)} <i>→</i> ${nameOf(s, who)}` : `${nameOf(s, t.asker)} is choosing…`);
        setPrompt(answering ? `${name(t.asker)} is asking you. A card's coming.` : who ? `${name(t.asker)} is asking ${name(who)}.` : `${name(t.asker)} is choosing who to ask…`);
        setAct("");
        renderHand(s);
        return;
      }

      if (s.phase === "talk") {
        renderHand(s);
        // the card lands: from the asker's hand (theirs flew already) or seat
        if (flownTurn !== s.ti) {
          flownTurn = s.ti;
          if (!asker) {
            const p = rt?.screen(t.asker), R = room$()?.getBoundingClientRect();
            if (p && R) flight($("mo-flyer"), p.x - R.left, p.y - R.top + 40);
          }
          sfx.whoosh(); setTimeout(() => sfx.flip(), 520);
        }
        rt?.card(t.card?.text, t.card?.level);
        setWho(`${nameOf(s, t.asker)} <i>→</i> ${nameOf(s, t.who)}`);
        setCenter(centerHtml(s, t));
        const answeringNow = t.status === "answering";
        rt?.same(t.same ?? 0);
        const d = t.deeper;
        const nudge = d && !d.state ? `<div class="mo-deeper ${answering ? "mine" : ""}"><small>go deeper</small><b>${esc(d.text)}</b>
            ${answering ? `<div class="mo-row"><button type="button" class="mo-btn soft" id="mo-dtake">take it</button><button type="button" class="mo-btn ghost" id="mo-dpass">pass</button></div>` : `<span>waiting on ${nameOf(s, t.who)}</span>`}</div>`
          : d?.state === "took" ? `<div class="mo-deeper took"><small>going deeper</small><b>${esc(d.text)}</b></div>` : "";
        let html;
        if (answering) {
          html = !t.status
            ? `<div class="mo-row"><button type="button" class="mo-btn warm" id="mo-answer">Answer</button><button type="button" class="mo-btn ghost" id="mo-pass">Pass</button></div>`
            : `${nudge}<div class="mo-row"><button type="button" class="mo-btn soft" id="mo-done">Done</button></div>`;
          setPrompt(!t.status ? "Answer out loud, or pass. Passing is fine: the mask just stays on." : "Your mask is off. Take your time. Tap Done when you're done.");
        } else {
          html = !t.status
            ? ""
            : `${nudge}<div class="mo-row">
                <button type="button" class="mo-btn same ${mySame ? "on" : ""}" id="mo-same" ${mySame ? "disabled" : ""}>${mySame ? "♥ same" : "♡ Same"}</button>
                <button type="button" class="mo-btn ghost" id="mo-deep" ${(d && !d.state) || t.deepers >= M.DEEPER_MAX ? "disabled" : ""}>Go deeper</button></div>`;
          setPrompt(!t.status ? `${name(t.who)} is deciding…` : answeringNow ? `${name(t.who)}'s mask is off. Listen. Tap Same if it's you too; nobody sees who did.` : `${name(t.who)} is done.`);
        }
        if (setAct(html)) {
          const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
          on("mo-answer", () => { game.input("answer"); sfx.chime(); buzz(20); });
          on("mo-pass", () => { game.input("pass"); sfx.back(); });
          on("mo-done", () => { game.input("done"); sfx.pop(); });
          on("mo-dtake", () => { game.input("deeper-take"); sfx.pop(); });
          on("mo-dpass", () => { game.input("deeper-pass"); sfx.back(); });
          on("mo-same", () => { if (mySame) return; mySame = true; game.input("same"); sfx.pop(); buzz(12); myGlow(); lastHud = 0; renderMO(game.s); });
          on("mo-deep", () => { game.input("deeper"); sfx.cursor(); });
        }
        return;
      }

      if (s.phase === "after") {
        renderHand(s);
        rt?.same(t.same ?? 0);
        setWho(t.status === "left" ? "" : `${nameOf(s, t.asker)} <i>→</i> ${nameOf(s, t.who)}`);
        let line;
        if (t.status === "left") line = "Someone had to go. On to the next one.";
        else if (t.status === "passed") line = `${answering ? "You passed" : `${name(t.who)} passed`}. The mask stays on. That's okay.`;
        else line = t.same ? (t.same === 1 ? "Someone felt this too." : `${t.same} people felt this too.`) : "Thank you for sharing.";
        setPrompt(line);
        setAct("");
        if (!t.card) setCenter("");
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

    // a calm "masks off": the camera lifts above the table, everyone
    // together, and how often nobody was alone
    function renderEnd(s) {
      rt?.card(null);
      rt?.end(true);
      const n = s.sameTotal ?? 0;
      const line = n ? `${n} ${n === 1 ? "moment" : "moments"} you weren't alone` : "thank you for being here";
      const html = `<div class="mo-end"><div class="mo-end-k">masks off</div><b class="mo-end-n">${line}</b></div>`;
      const c = $("mo-center"); if (c && c.dataset.k !== html) { c.dataset.k = html; c.innerHTML = html; }
      const w = $("mo-who"); if (w && w.textContent !== "masks off") w.textContent = "masks off";
      say("Masks off. Back to the party in a moment.");
      const act = $("mo-act"); if (act) { act.innerHTML = ""; act.dataset.k = ""; }
      $("mo-handwrap")?.classList.add("gone");
      room$()?.classList.add("ending");
      chips(s, {});
      if (!endShown) { endShown = true; buzz(20); sfx.chime(); }
    }

    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "setup", left: M.SETUP_MS, players: {}, setup: { levels: M.LEVELS_DEFAULT.slice(), rounds: M.ROUNDS_DEFAULT, go: false }, hands: {}, deck: [], played: [], asked: {}, weights: {}, order: [], ai: 0, ti: 0, turns: 1, turn: null, sameTotal: 0, lastWho: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => { game.stop(); ui.hide(); o(r); };
  },
};
