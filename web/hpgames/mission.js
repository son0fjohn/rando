// Today's Mission (3+) — house party game 2.
//
// Each player gets a bold "TODAY'S MISSION:" card with an absurd task, does
// it in front of the room while a timer runs, and the room rates how well
// they pulled it off on a 0-10 spectrum. Points are the average rating as a
// share of 100, so "half-hearted" still scores something and "legendary"
// scores the lot.
//
// Two ways in, chosen by the host in the lobby (ctx.options.mode):
//   quick  — the game deals one mission each and play starts immediately
//   choose — everyone is offered a few mission cards at once and picks the
//            one they'll do, then play starts
// Missions then run one at a time so the room has something to watch.
//
// SAFETY RULE, enforced by the pool not the code: a mission may only ever
// embarrass the player who drew it. Nothing in MISSION_PROMPTS asks a player
// to involve, name, rank, touch or use another person — bystanders are never
// the joke and never the prop. That holds in "choose" mode too: players pick
// from the curated pool, they never write a mission for someone else.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MISSION_PROMPTS, MISSION, pool } from "./../hpconfig.js";
import { Rounds, syncGone, active, allDone, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const CARD_MS = 7000;        // the card is on screen, performer reads it
const DO_MS = 75000;         // timer to actually do the thing
const VOTE_MS = 25000;       // room rates the attempt
const RESULT_MS = 6000;
const END_MS = 22000;
const SCALE = MISSION.SCALE, MAX_PTS = MISSION.MAX_PTS;
const ASSET = "games/mission/";

// rating -> the label under the slider (LABELS spread evenly over 0..SCALE)
const labelFor = v => MISSION.LABELS[Math.min(MISSION.LABELS.length - 1, Math.floor(v / (SCALE + 1) * MISSION.LABELS.length))];

export const TODAYS_MISSION = {
  id: "mission", title: "Today's Mission",
  blurb: "draw an absurd mission, do it in front of everyone. the room rates it 0-10.",
  minPlayers: 3, maxPlayers: 12, length: "~2 min per player",
  // the lobby renders these as toggles once the host queues this game
  options: [{
    key: "mode", label: "missions",
    choices: [
      { value: "quick", label: "quick start", hint: "the game deals one each" },
      { value: "choose", label: "players choose", hint: `everyone picks 1 of ${MISSION.CHOICES}` },
    ],
    default: MISSION.DEFAULT_MODE,
  }],

  start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    const MODE = MISSION.MODES.includes(ctx.options?.mode) ? ctx.options.mode : MISSION.DEFAULT_MODE;
    let myRating = null, myDraft = Math.round(SCALE / 2), myPick = null, editing = false, lastHud = 0, lastMission = null;
    trash.add(() => { myRating = null; myPick = null; });

    const cur = s => s.order?.[s.mi] ?? null;                 // whose mission
    const isMine = s => cur(s) === ctx.me.id;
    const voters = s => active(s).filter(p => p.id !== cur(s));

    const rounds = new Rounds([
      // "choose" mode only: everyone picks their own card, simultaneously
      {
        name: "pick", ms: MISSION.PICK_MS,
        done: s => allDone(s, p => Number.isInteger(s.offers[p.id]?.picked)),
        next: () => "card",
        exit: s => settlePicks(s),
      },
      { name: "card", ms: CARD_MS, next: () => "do" },
      {
        name: "do", ms: DO_MS,
        // the performer can say they're done early; nobody else gates this
        done: s => !!s.missions[cur(s)]?.claimed,
        next: () => "vote",
      },
      {
        name: "vote", ms: VOTE_MS,
        done: s => voters(s).every(p => s.missions[cur(s)]?.ratings[p.id] !== undefined),
        next: s => { tally(s); return "result"; },
      },
      {
        name: "result", ms: RESULT_MS,
        next: s => (s.mi + 1 < s.order.length ? (s.mi++, "card") : "end"),
      },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey(); myRating = null; editing = false; myDraft = Math.round(SCALE / 2);
        if (name === "pick") sfx.open();
        if (name === "card") { sfx.open(); buzz([20, 40, 20]); }
        if (name === "do") sfx.ping();
        if (name === "vote") sfx.tick();
        if (name === "result") sfx.pop();
        if (name === "end") sfx.win();
      },
    });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true);
        s.mode = MODE;
        s.order = shuffle(game.rng, Object.keys(s.players));
        s.missions = {}; s.offers = {};
        const deck = shuffle(game.rng, pool(MISSION_PROMPTS)).map(p => p.text);
        if (MODE === "choose") {
          // CHOICES distinct cards per player; cards may repeat across
          // players once the pool runs out, never within one player's hand
          s.order.forEach((id, i) => {
            const hand = [];
            for (let k = 0; hand.length < Math.min(MISSION.CHOICES, deck.length); k++) {
              const t = deck[(i * MISSION.CHOICES + k) % deck.length];
              if (!hand.includes(t)) hand.push(t);
            }
            s.offers[id] = { hand, picked: null };
          });
          s.order.forEach(id => { s.missions[id] = mission(null); });
          s.mi = 0;
          rounds.enter(s, "pick");
        } else {
          s.order.forEach((id, i) => { s.missions[id] = mission(deck[i % deck.length] ?? deck[0]); });
          s.mi = 0;
          rounds.enter(s, "card");
        }
      },
      hostTick(s, dt) {
        syncGone(s, room);
        if (s.phase === "pick") {
          for (const p of Object.values(s.players))
            if (p.isBot && !Number.isInteger(s.offers[p.id]?.picked) && game.rng() < dt * 0.5)
              s.offers[p.id].picked = Math.floor(game.rng() * s.offers[p.id].hand.length);
          rounds.hostStep(s, dt);
          return;
        }
        const id = cur(s), m = s.missions[id];
        if (!m) { if (s.phase !== "end") rounds.enter(s, "end"); return; }
        // a performer who left can't perform: skip straight to the next card
        if (s.players[id]?.gone && (s.phase === "card" || s.phase === "do")) {
          m.pts = 0; m.skipped = true;
          rounds.enter(s, "result");
          return;
        }
        if (s.phase === "do" && s.players[id]?.isBot && !m.claimed && game.rng() < dt * 0.08) m.claimed = true;
        if (s.phase === "vote")
          for (const p of voters(s))
            if (p.isBot && m.ratings[p.id] === undefined && game.rng() < dt * 0.5)
              m.ratings[p.id] = Math.max(0, Math.min(SCALE, Math.round(4 + game.rng() * 6)));
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const p = s.players[m.from];
        if (!p) return;
        if (m.in === "pick" && s.phase === "pick") {
          const o = s.offers[p.id];
          if (o && Number.isInteger(m.idx) && m.idx >= 0 && m.idx < o.hand.length) o.picked = m.idx;
          return;
        }
        const mi = s.missions[cur(s)];
        if (!mi) return;
        if (m.in === "claim" && s.phase === "do" && m.from === cur(s)) mi.claimed = true;
        if (m.in === "rate" && s.phase === "vote" && m.from !== cur(s)) {
          const v = Math.round(Number(m.v));
          if (Number.isFinite(v)) mi.ratings[p.id] = Math.max(0, Math.min(SCALE, v));
        }
      },
      render(s) { renderTM(s); },
      onEvent() {},
    }, { hz: 3 });

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false });
    const mission = task => ({ task, claimed: false, ratings: {}, avg: null, n: 0, pts: 0 });

    // choose mode: lock each player's pick in; anyone who didn't pick in
    // time gets a random card from their own hand
    function settlePicks(s) {
      for (const id of s.order) {
        const o = s.offers[id];
        if (!o) continue;
        const chose = Number.isInteger(o.picked);
        const idx = chose ? o.picked : Math.floor(game.rng() * o.hand.length);
        o.picked = idx;
        s.missions[id].task = o.hand[idx];
        s.missions[id].autoPicked = !chose;
      }
    }

    // average rating -> points. No ratings at all (everyone abstained) is 0.
    function tally(s) {
      const m = s.missions[cur(s)];
      const vs = Object.values(m.ratings).filter(v => Number.isFinite(v));
      m.n = vs.length;
      m.avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
      m.pts = Math.round(MAX_PTS * m.avg / SCALE);
      const p = s.players[cur(s)];
      if (p) p.score += m.pts;
    }

    // ---- render ----
    function renderTM(s) {
      // per-mission local state resets on every phone, keyed off the state
      // (Rounds' onPhase only runs on the host — resetting there let a
      // guest's rating from the last mission show up on this one)
      const mk = `${s.phase === "vote" ? "v" : "x"}:${s.mi}`;
      if (mk !== lastMission) { lastMission = mk; myRating = null; editing = false; myDraft = Math.round(SCALE / 2); }
      const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const id = cur(s), m = s.missions?.[id], who = s.players?.[id]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : s.phase === "pick" ? "pick a card" : `mission ${Math.min((s.mi ?? 0) + 1, s.order?.length ?? 1)}/${s.order?.length ?? 1}`;
      ui.hud(`<div class="hq"><b>TODAY'S MISSION</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);

      // the mission card — bold, generated backdrop, "TODAY'S MISSION:" header
      const card = (task, forWho, extra = "") => `<div class="tm-card ${extra}" style="background-image:url(${ASSET}card.jpg)">
        <div class="tm-kicker">TODAY'S MISSION:</div>
        <div class="tm-task">${esc(task)}</div>
        ${forWho ? `<div class="tm-for">${esc(forWho)}</div>` : ""}
      </div>`;

      if (s.phase === "pick") {
        const o = s.offers?.[ctx.me.id];
        const picked = Number.isInteger(o?.picked) ? o.picked : myPick;
        const ready = active(s).filter(p => Number.isInteger(s.offers[p.id]?.picked)).length;
        if (!ui.once(`pk:${picked ?? "-"}:${ready}`, () => {})) return;
        if (!o) { ui.stage("picking…", `<p class="ab-sub">waiting for everyone to pick</p>`, "missions"); return; }
        ui.stage("pick your mission", `<div class="tm-hand">${o.hand.map((t, i) =>
            `<button type="button" class="tm-pick ${picked === i ? "on" : ""}" data-pick="${i}">${card(t, picked === i ? "✓ this one" : "")}</button>`).join("")}</div>
          <p class="ab-sub">you'll do this one in front of everyone · ${ready}/${active(s).length} picked${picked !== null ? " · tap another to change" : ""}</p>${hostSkip(ctx)}`,
          `choose · ${ui.clock(s.left)}`);
        $("game-panel").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
          myPick = +b.dataset.pick; game.input("pick", { idx: myPick }); sfx.pop(); ui.resetKey();
        });
        bindHostSkip(game);

      } else if (s.phase === "card") {
        if (!ui.once(`c:${s.mi}`, () => {})) return;
        ui.stage(isMine(s) ? "your turn" : `${who}'s turn`,
          card(m?.task ?? "…", isMine(s) ? "this one is yours" : `for ${who}`)
          + `<p class="ab-sub">${isMine(s) ? "read it, stand up, and commit." : `watch ${esc(who)} — you'll be rating it.`}</p>${hostSkip(ctx)}`,
          "the card");
        bindHostSkip(game);

      } else if (s.phase === "do") {
        if (!ui.once(`d:${s.mi}:${m?.claimed ? 1 : 0}:${isMine(s) ? 1 : 0}`, () => {})) return;
        if (isMine(s)) {
          ui.stage("go. now.", card(m.task, "you're on")
            + (m.claimed
              ? `<p class="ab-sub">done — the room is about to rate you</p>`
              : `<button type="button" class="pt-btn pt-primary" id="tm-done">I did it</button><p class="ab-sub">or let the timer run out</p>`)
            + hostSkip(ctx), `doing it · ${ui.clock(s.left)}`);
          const b = $("tm-done"); if (b) b.onclick = () => { game.input("claim"); sfx.pop(); ui.resetKey(); };
        } else {
          ui.stage(`${who} is doing it`, `<div class="tm-watch"><b>${esc(who)}:</b> ${esc(m.task)}</div>
            ${ui.bar(Math.max(0, s.left / DO_MS))}
            <p class="ab-sub">eyes up. you're rating this in a second.</p>${hostSkip(ctx)}`, `watching · ${ui.clock(s.left)}`);
        }
        bindHostSkip(game);

      } else if (s.phase === "vote") {
        const amPerformer = isMine(s);
        const vIn = Object.keys(m.ratings).length, need = voters(s).length;
        // while re-editing, ignore the rating the host already holds — the
        // next snapshot would otherwise flip the slider straight back shut
        const locked = editing ? null : (m.ratings[ctx.me.id] ?? myRating);
        // the slider value is NOT in the key: dragging must not rebuild the
        // panel (it would yank the thumb out from under your finger)
        if (!ui.once(`v:${s.mi}:${locked ?? "-"}:${editing ? 1 : 0}:${vIn}:${amPerformer ? 1 : 0}`, () => {})) return;
        if (amPerformer) {
          ui.stage("the room is rating you", `<div class="tm-watch">${esc(m.task)}</div>
            <p class="ab-sub">${vIn}/${need} ratings in · nothing you can do now</p>${hostSkip(ctx)}`, `verdict · ${ui.clock(s.left)}`);
        } else if (locked !== null && locked !== undefined) {
          ui.stage(`you gave ${who} a ${locked}`, `<div class="tm-watch"><b>the mission was:</b> ${esc(m.task)}</div>
            ${spectrum(locked)}
            <button type="button" class="pt-btn" id="tm-change">change my rating</button>
            <p class="ab-sub">${vIn}/${need} ratings in</p>${hostSkip(ctx)}`, `rate · ${ui.clock(s.left)}`);
          const c = $("tm-change"); if (c) c.onclick = () => { myDraft = locked; myRating = null; editing = true; ui.resetKey(); };
        } else {
          ui.stage(`how well did ${who} pull it off?`, `<div class="tm-watch"><b>the mission was:</b> ${esc(m.task)}</div>
            <div class="tm-rate">
              <div class="tm-rate-val"><b id="tm-val">${myDraft}</b><span>/ ${SCALE}</span></div>
              <input type="range" id="tm-slider" min="0" max="${SCALE}" step="1" value="${myDraft}">
              <div class="tm-rate-ends"><span>${esc(MISSION.LABELS[0])}</span><span>${esc(MISSION.LABELS[MISSION.LABELS.length - 1])}</span></div>
              <div class="tm-rate-label" id="tm-label">${esc(labelFor(myDraft))}</div>
            </div>
            <button type="button" class="pt-btn pt-primary" id="tm-lock">lock it in</button>
            <p class="ab-sub">${vIn}/${need} ratings in</p>${hostSkip(ctx)}`, `rate · ${ui.clock(s.left)}`);
          const sl = $("tm-slider");
          if (sl) sl.oninput = () => { myDraft = +sl.value; $("tm-val").textContent = sl.value; $("tm-label").textContent = labelFor(+sl.value); };
          const lk = $("tm-lock");
          if (lk) lk.onclick = () => { myRating = myDraft; editing = false; game.input("rate", { v: myDraft }); sfx.pop(); ui.resetKey(); };
        }
        bindHostSkip(game);

      } else if (s.phase === "result") {
        if (!ui.once(`r:${s.mi}`, () => {})) return;
        if (m.skipped) {
          ui.stage(`${who} left`, `<p class="ab-sub">their mission goes unrated</p>${hostSkip(ctx)}`, "verdict");
        } else {
          const avg = Math.round((m.avg ?? 0) * 10) / 10;
          ui.stage(m.n ? `${who}: ${avg} / ${SCALE}` : `${who}: nobody rated it`,
            `<div class="tm-watch">${esc(m.task)}</div>
            ${spectrum(m.avg ?? 0)}
            <div class="mh-big">+${m.pts} pts</div>
            <p class="ab-sub">${m.n ? `${esc(labelFor(Math.round(m.avg)))} · average of ${m.n} rating${m.n === 1 ? "" : "s"}` : "no ratings came in"}</p>${hostSkip(ctx)}`, "verdict");
        }
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, { title: "Today's Mission", sub: "final scores", note: `each mission scores its average rating out of ${SCALE}, as points out of ${MAX_PTS}` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }
    // a read-only bar with a marker at v — the "spectrum"
    const spectrum = v => `<div class="tm-spec"><i style="left:${Math.max(0, Math.min(100, v / SCALE * 100))}%"></i></div>
      <div class="tm-rate-ends"><span>0</span><span>${SCALE}</span></div>`;

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every entry, title and photo id alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: MODE === "choose" ? "pick" : "card", left: CARD_MS, players: {}, order: [], missions: {}, offers: {}, mi: 0, mode: MODE });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
