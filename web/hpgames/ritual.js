// Humiliation Ritual (3+) — house party game 3.
//
// One performer gets a secret prompt and acts it out in public, charades
// style. Everyone else types guesses on their phones. The performer sees the
// guesses stream in live and taps the first correct one. Performers rotate so
// everyone takes a turn.
//
// The performer is the judge: matching is suggestive, not authoritative. The
// code marks a guess as "near" when it looks close to the answer (so the
// performer's eye is drawn to it) but the performer can tap ANY guess —
// including one the matcher missed. That keeps a clever-but-unlisted guess
// from being thrown away.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { RITUAL_PROMPTS, pool } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const PREP_MS = 6000;        // performer reads the secret prompt
const ACT_MS = 90000;        // acting + guessing window
const RESULT_MS = 7000;
const END_MS = 22000;
const PTS_GUESS = 100;       // the guesser who got it
const PTS_PERFORM = 60;      // the performer, if anyone got it
const SPEED_BONUS = 50;      // performer bonus, scaled by how fast it landed
const GUESS_MAX = 60;
const MAX_GUESSES = 60;      // ring buffer so a long round can't bloat the state
const ASSET = "games/ritual/";

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
// "near" = exact match on the answer or an accepted variant, or the guess and
// the answer share a distinctive word. Only a hint for the performer's eye.
function nearness(guess, p) {
  const g = norm(guess);
  if (!g) return false;
  const targets = [p.answer, ...(p.alt ?? [])].map(norm);
  if (targets.includes(g)) return true;
  if (targets.some(t => t.includes(g) || g.includes(t))) return true;
  const stop = new Set(["a", "an", "the", "of", "to", "in", "on", "is", "it", "and", "someone", "something", "your", "you"]);
  const words = new Set(g.split(" ").filter(w => w.length > 3 && !stop.has(w)));
  return targets.some(t => t.split(" ").some(w => w.length > 3 && !stop.has(w) && words.has(w)));
}

export const HUMILIATION_RITUAL = {
  id: "ritual", title: "Humiliation Ritual",
  blurb: "act out a secret prompt in public. everyone else types guesses. tap the first one that's right.",
  minPlayers: 3, maxPlayers: 12, length: "~2 min per player",

  start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    let lastHud = 0, sentAt = 0;
    trash.add(() => { sentAt = 0; });

    // ui.prompt locks its input after one submit. This game wants a stream of
    // guesses, so re-open it in place — no panel rebuild, no lost focus.
    function reopen() {
      const inp = $("gp-in"), btn = $("game-panel")?.querySelector(".gp-form button");
      if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
      if (btn) btn.disabled = false;
    }

    const cur = s => s.order?.[s.ri] ?? null;
    const isPerformer = s => cur(s) === ctx.me.id;
    const round = s => s.rounds?.[s.ri] ?? null;

    const rounds = new Rounds([
      { name: "prep", ms: PREP_MS, next: () => "act" },
      {
        name: "act", ms: ACT_MS,
        done: s => !!round(s)?.won,            // performer tapped a correct guess
        next: s => { settle(s); return "result"; },
      },
      { name: "result", ms: RESULT_MS, next: s => (s.ri + 1 < s.order.length ? (s.ri++, "prep") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "prep") { sfx.open(); buzz([20, 40, 20]); }
        if (name === "act") sfx.ping();
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
        const deck = shuffle(game.rng, pool(RITUAL_PROMPTS));
        s.order = shuffle(game.rng, Object.keys(s.players));
        s.rounds = s.order.map((id, i) => {
          const p = deck[i % deck.length] ?? deck[0];
          return { performer: id, prompt: p.text, answer: p.answer, alt: p.alt ?? [], guesses: [], won: null, pts: 0, perfPts: 0, startedAt: 0 };
        });
        s.ri = 0;
        rounds.enter(s, "prep");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const r = round(s);
        if (!r) { if (s.phase !== "end") rounds.enter(s, "end"); return; }
        if (s.phase === "act" && !r.startedAt) r.startedAt = Date.now();
        // a performer who leaves mid-act ends the round with nobody scoring
        if (s.players[r.performer]?.gone && (s.phase === "prep" || s.phase === "act")) {
          r.skipped = true; r.won = null;
          rounds.enter(s, "result");
          return;
        }
        if (s.phase === "act") {
          // bots guess: mostly nonsense, occasionally the real answer
          for (const p of active(s)) {
            if (!p.isBot || p.id === r.performer) continue;
            if (game.rng() < dt * 0.22) {
              const right = game.rng() < 0.25;
              addGuess(s, r, p.id, right ? r.answer : botNoise(game.rng));
            }
          }
          // a bot performer taps the first near guess for itself
          if (s.players[r.performer]?.isBot && !r.won) {
            const hit = r.guesses.find(g => g.near);
            if (hit && game.rng() < dt * 1.2) r.won = { gid: hit.gid, by: hit.by, at: Date.now() };
          }
        }
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const r = round(s);
        if (!r || !s.players[m.from]) return;
        if (m.in === "guess" && s.phase === "act" && m.from !== r.performer)
          addGuess(s, r, m.from, String(m.text ?? ""));
        // only the performer can accept a guess, and only once
        if (m.in === "accept" && s.phase === "act" && m.from === r.performer && !r.won) {
          const g = r.guesses.find(x => x.gid === m.gid);
          if (g) r.won = { gid: g.gid, by: g.by, at: Date.now() };
        }
      },
      render(s) { renderHR(s); },
      onEvent(m) { if (m.ev === "got") { sfx.chime(); buzz(60); } },
    }, { hz: 4 });   // guesses should feel live, so a slightly faster tick

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false });
    const BOT_NOISE = ["a horse?", "driving", "cooking", "swimming", "falling over", "a baby", "waiting for a bus", "crying", "eating soup", "a tree", "sneezing", "very confused"];
    const botNoise = rng => BOT_NOISE[Math.floor(rng() * BOT_NOISE.length)];

    function addGuess(s, r, by, text) {
      const t = text.trim().slice(0, GUESS_MAX);
      if (!t) return;
      const last = r.guesses[r.guesses.length - 1];
      if (last && last.by === by && norm(last.text) === norm(t)) return;    // no spamming the same guess
      r.guesses.push({ gid: `g${r.guesses.length}-${by.slice(0, 4)}`, by, text: t, near: nearness(t, r), t: Date.now() });
      if (r.guesses.length > MAX_GUESSES) r.guesses.splice(0, r.guesses.length - MAX_GUESSES);
    }

    // scoring: the guesser whose guess was accepted takes PTS_GUESS; the
    // performer takes PTS_PERFORM plus a speed bonus for landing it quickly
    function settle(s) {
      const r = round(s);
      if (!r || !r.won) return;
      const g = s.players[r.won.by], perf = s.players[r.performer];
      if (g) g.score += PTS_GUESS;
      const elapsed = Math.max(0, (r.won.at ?? Date.now()) - (r.startedAt || Date.now()));
      const speed = Math.round(SPEED_BONUS * Math.max(0, 1 - elapsed / ACT_MS));
      r.pts = PTS_GUESS; r.perfPts = PTS_PERFORM + speed; r.secs = Math.round(elapsed / 1000);
      if (perf) perf.score += r.perfPts;
    }

    // ---- render ----
    function renderHR(s) {
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const r = round(s);
      const who = s.players?.[r?.performer]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : `turn ${Math.min((s.ri ?? 0) + 1, s.order?.length ?? 1)}/${s.order?.length ?? 1}`;
      ui.hud(`<div class="hq"><b>HUMILIATION RITUAL</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);

      const stage = (caption) => `<div class="hr-stage" style="background-image:url(${ASSET}stage.jpg)"><div class="hr-performer">${caption}</div></div>`;

      if (s.phase === "prep") {
        if (!ui.once(`p:${s.ri}:${isPerformer(s) ? 1 : 0}`, () => {})) return;
        if (isPerformer(s)) {
          ui.stage("you're up — don't say a word",
            stage("you, in a moment") + `<div class="hr-secret">${esc(r.prompt)}</div>
            <p class="ab-sub">act it out. no talking, no spelling, no pointing at words.</p>${hostSkip(ctx)}`, "your secret");
        } else {
          ui.stage(`${who} is up`, stage(`${esc(who)} takes the stage`)
            + `<p class="ab-sub">they've got a secret prompt. start typing guesses the moment they move.</p>${hostSkip(ctx)}`, "get ready");
        }
        bindHostSkip(game);

      } else if (s.phase === "act") {
        const gs = r.guesses ?? [];
        if (isPerformer(s)) {
          // live guess feed; tap any one to accept it
          if (!ui.once(`a:${s.ri}:perf:${gs.length}:${r.won ? 1 : 0}`, () => {})) return;
          const rows = gs.slice().reverse().map(g => `<button type="button" class="hr-guess ${r.won ? "" : "tappable"} ${g.near ? "near" : ""} ${r.won?.gid === g.gid ? "correct" : ""}" data-gid="${esc(g.gid)}" ${r.won ? "disabled" : ""}>
            <b>${esc(s.players[g.by]?.handle ?? "?")}</b><span>${esc(g.text)}</span></button>`).join("") || `<div class="pt-empty">no guesses yet — keep going</div>`;
          ui.stage("tap the first one that's right", `<div class="hr-secret">${esc(r.prompt)}</div>
            <div class="hr-guesses">${rows}</div>
            <p class="ab-sub">dashed outline = looks close. you're the judge — tap whatever actually counts.</p>${hostSkip(ctx)}`, `acting · ${ui.clock(s.left)}`);
          if (!r.won) $("game-panel").querySelectorAll("[data-gid]").forEach(b => b.onclick = () => {
            game.input("accept", { gid: b.dataset.gid });
            sfx.pop(); ui.resetKey();
          });
        } else {
          // GUESSER VIEW. The key deliberately excludes the guess count: a
          // guess arriving from anyone else must NOT rebuild this panel, or it
          // would wipe whatever this player is halfway through typing. The
          // feed is patched in place below instead.
          if (ui.once(`a:${s.ri}:g:${r.won ? 1 : 0}`, () => {})) {
            ui.stage(`what is ${who} doing?`, stage(`${esc(who)} is performing`)
              + ui.prompt("your guess…", text => { game.input("guess", { text }); sentAt = Date.now(); sfx.tick(); reopen(); }, { maxlength: GUESS_MAX, submitLabel: "guess" })
              + `<div class="hr-guesses" id="hr-feed"></div>
              <p class="ab-sub">guess as often as you like — ${esc(who)} picks the first one that's right</p>${hostSkip(ctx)}`, `guessing · ${ui.clock(s.left)}`);
            bindHostSkip(game);
          }
          const feed = $("hr-feed");
          if (feed) {
            const sig = `${gs.length}:${r.won?.gid ?? "-"}`;
            if (feed.dataset.sig !== sig) {
              feed.dataset.sig = sig;
              feed.innerHTML = gs.slice().reverse().slice(0, 14).map(g => `<div class="hr-guess ${g.by === ctx.me.id ? "hr-mine" : ""} ${r.won?.gid === g.gid ? "correct" : ""}">
                <b>${esc(s.players[g.by]?.handle ?? "?")}</b><span>${esc(g.text)}</span></div>`).join("") || `<div class="pt-empty">be first</div>`;
            }
          }
          return;
        }
        bindHostSkip(game);

      } else if (s.phase === "result") {
        if (!ui.once(`r:${s.ri}`, () => {})) return;
        if (r.skipped) {
          ui.stage(`${who} left`, `<p class="ab-sub">nobody scores this turn</p>${hostSkip(ctx)}`, "no verdict");
        } else if (r.won) {
          const g = s.players[r.won.by];
          ui.stage(`${esc(g?.handle ?? "?")} got it`, `<div class="hr-secret">${esc(r.prompt)}</div>
            <div class="mh-big">${esc(g?.handle ?? "?")} +${r.pts} · ${esc(who)} +${r.perfPts}</div>
            <p class="ab-sub">landed in ${r.secs ?? "?"}s${r.perfPts > PTS_PERFORM ? ` — ${r.perfPts - PTS_PERFORM} speed bonus` : ""}</p>${hostSkip(ctx)}`, "got it");
        } else {
          ui.stage("nobody got it", `<div class="hr-secret">${esc(r.prompt)}</div>
            <p class="ab-sub">that was the prompt. no points this turn.</p>${hostSkip(ctx)}`, "time");
        }
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, { title: "Humiliation Ritual", sub: "final scores", note: `${PTS_GUESS} for the guess · ${PTS_PERFORM} for performing it, plus up to ${SPEED_BONUS} for speed` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every entry, title and photo id alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "prep", left: PREP_MS, players: {}, order: [], rounds: [], ri: 0 });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
