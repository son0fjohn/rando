// Today's Mission (3+) — house party game 2.
//
// Each player draws a bold mission card with an absurd task. A timer runs,
// they go do it in front of the room, and the group votes on whether they
// pulled it off. Points for completing it, plus a bonus for style.
//
// Missions run one at a time so the room has something to look at and vote
// on: card -> perform -> vote, then the next player. Everyone gets a mission,
// in a shuffled order.
//
// SAFETY RULE, enforced by the pool not the code: a mission may only ever
// embarrass the player who drew it. Nothing in MISSION_PROMPTS asks a player
// to involve, name, rank, touch or use another person — bystanders are never
// the joke and never the prop. If you curate that pool, keep that line.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MISSION_PROMPTS, pool } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const CARD_MS = 7000;        // the card is on screen, performer reads it
const DO_MS = 75000;         // timer to actually do the thing
const VOTE_MS = 25000;       // room votes completed? + style?
const RESULT_MS = 6000;
const END_MS = 22000;
const PTS_DONE = 60, PTS_STYLE = 40;    // completion + style bonus
const ASSET = "games/mission/";

export const TODAYS_MISSION = {
  id: "mission", title: "Today's Mission",
  blurb: "draw an absurd mission. do it in front of everyone. the room decides if you pulled it off.",
  minPlayers: 3, maxPlayers: 12, length: "~2 min per player",

  start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    let myVote = null, myStyle = false, lastHud = 0;
    trash.add(() => { myVote = null; myStyle = false; });

    const cur = s => s.order?.[s.mi] ?? null;                 // whose mission
    const isMine = s => cur(s) === ctx.me.id;
    const voters = s => active(s).filter(p => p.id !== cur(s));

    const rounds = new Rounds([
      { name: "card", ms: CARD_MS, next: () => "do" },
      {
        name: "do", ms: DO_MS,
        // the performer can say they're done early; nobody else gates this
        done: s => !!s.missions[cur(s)]?.claimed,
        next: () => "vote",
      },
      {
        name: "vote", ms: VOTE_MS,
        done: s => voters(s).every(p => s.missions[cur(s)]?.votes[p.id] !== undefined),
        next: s => { tally(s); return "result"; },
      },
      {
        name: "result", ms: RESULT_MS,
        next: s => (s.mi + 1 < s.order.length ? (s.mi++, "card") : "end"),
      },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey(); myVote = null; myStyle = false;
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
        // one mission each, no repeats while the pool lasts
        const deck = shuffle(game.rng, pool(MISSION_PROMPTS));
        s.order = shuffle(game.rng, Object.keys(s.players));
        s.missions = {};
        s.order.forEach((id, i) => {
          s.missions[id] = { task: (deck[i % deck.length] ?? deck[0]).text, claimed: false, votes: {}, style: {}, done: null, styled: 0, pts: 0 };
        });
        s.mi = 0;
        rounds.enter(s, "card");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const id = cur(s), m = s.missions[id];
        if (!m) { if (s.phase !== "end") rounds.enter(s, "end"); return; }
        // a performer who left can't perform: skip straight to the next card
        if (s.players[id]?.gone && (s.phase === "card" || s.phase === "do")) {
          m.done = false; m.pts = 0; m.skipped = true;
          rounds.enter(s, "result");
          return;
        }
        if (s.phase === "do" && s.players[id]?.isBot && !m.claimed && game.rng() < dt * 0.08) m.claimed = true;
        if (s.phase === "vote")
          for (const p of voters(s))
            if (p.isBot && m.votes[p.id] === undefined && game.rng() < dt * 0.5) {
              m.votes[p.id] = game.rng() < 0.75 ? 1 : 0;
              m.style[p.id] = game.rng() < 0.4 ? 1 : 0;
            }
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const p = s.players[m.from];
        const mi = s.missions[cur(s)];
        if (!p || !mi) return;
        if (m.in === "claim" && s.phase === "do" && m.from === cur(s)) mi.claimed = true;
        if (m.in === "vote" && s.phase === "vote" && m.from !== cur(s)) {
          mi.votes[p.id] = m.ok ? 1 : 0;
          mi.style[p.id] = m.style ? 1 : 0;
        }
      },
      render(s) { renderTM(s); },
      onEvent() {},
    }, { hz: 3 });

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false });

    // majority says completed -> PTS_DONE; style bonus scales with the share
    // of voters who ticked "with style"
    function tally(s) {
      const m = s.missions[cur(s)];
      const vs = Object.values(m.votes).filter(v => v === 0 || v === 1);
      const yes = vs.filter(v => v === 1).length;
      const styleYes = Object.values(m.style).filter(v => v === 1).length;
      m.done = vs.length ? yes * 2 > vs.length : false;       // strict majority
      m.yes = yes; m.total = vs.length; m.styled = styleYes;
      const bonus = vs.length ? Math.round(PTS_STYLE * styleYes / vs.length) : 0;
      m.pts = (m.done ? PTS_DONE : 0) + (m.done ? bonus : 0);
      const p = s.players[cur(s)];
      if (p) p.score += m.pts;
    }

    // ---- render ----
    function renderTM(s) {
      const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const id = cur(s), m = s.missions?.[id], who = s.players?.[id]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : `mission ${Math.min((s.mi ?? 0) + 1, s.order?.length ?? 1)}/${s.order?.length ?? 1}`;
      ui.hud(`<div class="hq"><b>TODAY'S MISSION</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);

      // the mission card — bold, generated backdrop, "TODAY'S MISSION:" header
      const card = (task, forWho) => `<div class="tm-card" style="background-image:url(${ASSET}card.jpg)">
        <div class="tm-kicker">TODAY'S MISSION:</div>
        <div class="tm-task">${esc(task)}</div>
        <div class="tm-for">${esc(forWho)}</div>
      </div>`;

      if (s.phase === "card") {
        if (!ui.once(`c:${s.mi}`, () => {})) return;
        ui.stage(isMine(s) ? "your turn" : `${who}'s turn`,
          card(m?.task ?? "…", isMine(s) ? "this one is yours" : `for ${who}`)
          + `<p class="ab-sub">${isMine(s) ? "read it, stand up, and commit." : `watch ${esc(who)} — you'll be voting on it.`}</p>${hostSkip(ctx)}`,
          "the card");
        bindHostSkip(game);

      } else if (s.phase === "do") {
        if (!ui.once(`d:${s.mi}:${m?.claimed ? 1 : 0}:${isMine(s) ? 1 : 0}`, () => {})) return;
        if (isMine(s)) {
          ui.stage("go. now.", card(m.task, "you're on")
            + (m.claimed
              ? `<p class="ab-sub">done — the room is about to judge you</p>`
              : `<button type="button" class="pt-btn pt-primary" id="tm-done">I did it</button><p class="ab-sub">or let the timer run out</p>`)
            + hostSkip(ctx), `doing it · ${ui.clock(s.left)}`);
          const b = $("tm-done"); if (b) b.onclick = () => { game.input("claim"); sfx.pop(); ui.resetKey(); };
        } else {
          ui.stage(`${who} is doing it`, `<div class="tm-watch"><b>${esc(who)}:</b> ${esc(m.task)}</div>
            ${ui.bar(Math.max(0, s.left / DO_MS))}
            <p class="ab-sub">eyes up. you're voting on this in a second.</p>${hostSkip(ctx)}`, `watching · ${ui.clock(s.left)}`);
        }
        bindHostSkip(game);

      } else if (s.phase === "vote") {
        const amPerformer = isMine(s);
        const vIn = Object.keys(m.votes).length, need = voters(s).length;
        const picked = m.votes[ctx.me.id] ?? myVote;
        if (!ui.once(`v:${s.mi}:${picked ?? "-"}:${myStyle ? 1 : 0}:${vIn}:${amPerformer ? 1 : 0}`, () => {})) return;
        if (amPerformer) {
          ui.stage("the room is deciding", `<div class="tm-watch">${esc(m.task)}</div>
            <p class="ab-sub">${vIn}/${need} votes in · nothing you can do now</p>${hostSkip(ctx)}`, `verdict · ${ui.clock(s.left)}`);
        } else {
          ui.stage(`did ${who} pull it off?`, `<div class="tm-watch"><b>the mission was:</b> ${esc(m.task)}</div>
            <div class="tm-votes">
              <button type="button" class="yes ${picked === 1 ? "on" : ""}" data-ok="1">yes</button>
              <button type="button" class="no ${picked === 0 ? "on" : ""}" data-ok="0">no</button>
            </div>
            <div class="tm-style"><button type="button" class="pt-btn ${myStyle ? "on" : ""}" id="tm-style">+ with style</button></div>
            <p class="ab-sub">${vIn}/${need} votes in · style adds up to ${PTS_STYLE} bonus points</p>${hostSkip(ctx)}`, `vote · ${ui.clock(s.left)}`);
          $("game-panel").querySelectorAll("[data-ok]").forEach(b => b.onclick = () => {
            myVote = +b.dataset.ok;
            game.input("vote", { ok: myVote === 1, style: myStyle });
            sfx.pop(); ui.resetKey();
          });
          const sb = $("tm-style");
          if (sb) sb.onclick = () => {
            myStyle = !myStyle;
            if (myVote !== null) game.input("vote", { ok: myVote === 1, style: myStyle });
            sfx.tick(); ui.resetKey();
          };
        }
        bindHostSkip(game);

      } else if (s.phase === "result") {
        if (!ui.once(`r:${s.mi}`, () => {})) return;
        const head = m.skipped ? `${who} left` : m.done ? `${who} pulled it off` : `${who} did not pull it off`;
        const detail = m.skipped
          ? `<p class="ab-sub">their mission goes unjudged</p>`
          : `<div class="tm-watch">${esc(m.task)}<br><b>${m.yes}/${m.total} said yes${m.done && m.styled ? ` · ${m.styled} said with style` : ""}</b></div>`;
        ui.stage(head, `<div class="mh-big">+${m.pts} pts</div>${detail}${hostSkip(ctx)}`, "verdict");
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, { title: "Today's Mission", sub: "final scores", note: `${PTS_DONE} for pulling it off · up to ${PTS_STYLE} for style` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    game.start({ phase: "card", left: CARD_MS, players: {}, order: [], missions: {}, mi: 0 });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
