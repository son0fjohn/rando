// Humiliation Ritual (3+) — house party game 3.
//
// One performer gets a secret prompt and acts it out in public, charades
// style. Everyone else guesses — by typing, or by shouting it out loud.
// Performers rotate so everyone takes a turn.
//
// The performer should be ACTING, not reading their phone. So:
//   * Typed guesses are judged automatically by the answer matcher below
//     (typo-tolerant, plural-tolerant, accepts the listed alternates). The
//     first correct one ends the turn on its own — nobody has to approve it.
//   * Guesses shouted out loud are confirmed by the performer, the only
//     person who knows the answer, with one big button and one name tap.
// The performer's screen is the prompt, the clock and that button. No feed.
//
// The matcher is local string matching, not a language model: there is no
// AI service wired into this app and a model API key can't live in client
// code. It is deliberately forgiving on spelling and word form and strict on
// meaning — "walking the dog" matches "walking a dog", "a horse" does not.
// When it says no to something that was clearly right, the out-loud button
// is the fallback.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { RITUAL_PROMPTS, RITUAL, pool } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const PREP_MS = 6000;        // performer reads the secret prompt
const ACT_MS = RITUAL.ACT_MS;
const RESULT_MS = 7000;
const END_MS = 22000;
const PTS_GUESS = 100;       // whoever got it
const PTS_PERFORM = 60;      // the performer, if anyone got it
const SPEED_BONUS = 50;      // performer bonus, scaled by how fast it landed
const GUESS_MAX = 60;
const MAX_GUESSES = 60;      // ring buffer so a long round can't bloat the state
const ASSET = "games/ritual/";

// ---------------------------------------------------------------- the judge
const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "is", "it", "its", "and", "or", "at", "for", "with", "by",
  "someone", "something", "somebody", "your", "you", "my", "me", "their", "they", "be", "being", "doing", "like", "very",
  "really", "just", "that", "this", "who", "what", "are", "was", "has", "have"]);
const norm = s => String(s ?? "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// light stemming: enough to make walking/walk, dogs/dog, folded/fold meet
function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const tokens = s => norm(s).split(" ").filter(w => w.length > 1 && !STOP.has(w)).map(stem);
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// one typo allowed from 5 letters, two from 8
function wordEq(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n >= 8) return lev(a, b) <= 2;
  if (n >= 5) return lev(a, b) <= 1;
  return false;
}
// "correct": every meaningful word of the answer (or of one alternate) is in
// the guess. "close": the guess shares at least one meaningful word with it.
export function judge(guess, round) {
  const G = tokens(guess);
  if (!G.length) return "wrong";
  const targets = [round.answer, ...(round.alt ?? [])];
  for (const t of targets) {
    const T = tokens(t);
    if (!T.length) { if (norm(t) && norm(t) === norm(guess)) return "correct"; continue; }
    if (T.every(tw => G.some(gw => wordEq(gw, tw)))) return "correct";
  }
  for (const t of targets) if (tokens(t).some(tw => G.some(gw => wordEq(gw, tw)))) return "close";
  return "wrong";
}

export const HUMILIATION_RITUAL = {
  id: "ritual", title: "Humiliation Ritual",
  blurb: "act out a secret prompt in public. the room guesses — typed guesses are judged automatically.",
  minPlayers: 3, maxPlayers: 12, length: "~2 min per player",

  start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    let lastHud = 0, heardOpen = false;
    trash.add(() => { heardOpen = false; });

    // ui.prompt locks its input after one submit — and it does so AFTER
    // calling our onSubmit, so this has to run on the next tick (calling it
    // inline was silently undone). This game wants a stream of guesses, so
    // re-open in place: no panel rebuild, no lost focus.
    function reopen() {
      const inp = $("gp-in"), btn = $("game-panel")?.querySelector(".gp-form button");
      if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
      if (btn) btn.disabled = false;
    }

    const isPerformer = s => s.order?.[s.ri] === ctx.me.id;
    const round = s => s.rounds?.[s.ri] ?? null;

    const rounds = new Rounds([
      { name: "prep", ms: PREP_MS, next: () => "act" },
      {
        name: "act", ms: ACT_MS,
        done: s => !!round(s)?.won,
        next: s => { settle(s); return "result"; },
      },
      { name: "result", ms: RESULT_MS, next: s => (s.ri + 1 < s.order.length ? (s.ri++, "prep") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey(); heardOpen = false;
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
        if (s.phase === "act" && !r.won) {
          // bots guess: mostly nonsense, occasionally the real answer
          for (const p of active(s)) {
            if (!p.isBot || p.id === r.performer) continue;
            if (game.rng() < dt * 0.22) addGuess(s, r, p.id, game.rng() < 0.25 ? r.answer : botNoise(game.rng));
          }
        }
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const r = round(s);
        if (!r || !s.players[m.from]) return;
        // typed guesses from anyone but the performer, judged on arrival
        if (m.in === "guess" && s.phase === "act" && m.from !== r.performer && !r.won)
          addGuess(s, r, m.from, String(m.text ?? ""));
        // an out-loud guess: only the performer can confirm it, and they pick
        // who said it (never themselves)
        if (m.in === "heard" && s.phase === "act" && m.from === r.performer && !r.won) {
          const who = s.players[m.who];
          if (who && who.id !== r.performer) r.won = { gid: null, by: who.id, at: Date.now(), how: "out loud" };
        }
      },
      render(s) { renderHR(s); },
      onEvent() {},
    }, { hz: 4 });   // guesses should feel live, so a slightly faster tick

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false });
    const BOT_NOISE = ["a horse?", "driving", "cooking", "swimming", "falling over", "a baby", "waiting for a bus", "crying", "eating soup", "a tree", "sneezing", "very confused"];
    const botNoise = rng => BOT_NOISE[Math.floor(rng() * BOT_NOISE.length)];

    function addGuess(s, r, by, text) {
      const t = text.trim().slice(0, GUESS_MAX);
      if (!t) return;
      const last = r.guesses[r.guesses.length - 1];
      if (last && last.by === by && norm(last.text) === norm(t)) return;    // no spamming the same guess
      const verdict = judge(t, r);
      const g = { gid: `g${r.guesses.length}-${by.slice(0, 4)}`, by, text: t, verdict, t: Date.now() };
      r.guesses.push(g);
      if (r.guesses.length > MAX_GUESSES) r.guesses.splice(0, r.guesses.length - MAX_GUESSES);
      if (verdict === "correct" && !r.won) r.won = { gid: g.gid, by, at: g.t, how: "typed" };
    }

    // scoring: whoever got it takes PTS_GUESS; the performer takes
    // PTS_PERFORM plus a speed bonus for landing it quickly
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

      const stage = caption => `<div class="hr-stage" style="background-image:url(${ASSET}stage.jpg)"><div class="hr-performer">${caption}</div></div>`;

      if (s.phase === "prep") {
        if (!ui.once(`p:${s.ri}:${isPerformer(s) ? 1 : 0}`, () => {})) return;
        if (isPerformer(s)) {
          ui.stage("you're up — don't say a word",
            stage("you, in a moment") + `<div class="hr-secret">${esc(r.prompt)}</div>
            <p class="ab-sub">act it out. no talking, no spelling, no pointing at words. then put the phone down — guesses are judged for you.</p>${hostSkip(ctx)}`, "your secret");
        } else {
          ui.stage(`${who} is up`, stage(`${esc(who)} takes the stage`)
            + `<p class="ab-sub">type guesses or shout them out — the moment they move.</p>${hostSkip(ctx)}`, "get ready");
        }
        bindHostSkip(game);

      } else if (s.phase === "act") {
        if (isPerformer(s)) {
          // PERFORMER: the prompt, the clock, and one button. That's it.
          if (!ui.once(`a:${s.ri}:perf:${heardOpen ? 1 : 0}:${r.won ? 1 : 0}`, () => {})) return;
          const others = P.filter(p => p.id !== r.performer && !p.gone);
          ui.stage("act it out", `<div class="hr-secret big">${esc(r.prompt)}</div>`
            + (heardOpen
              ? `<div class="rl-h">who said it?</div><div class="hr-who">${others.map(p => `<button type="button" data-heard="${esc(p.id)}">${esc(p.handle)}</button>`).join("")}</div>
                 <button type="button" class="pt-btn" id="hr-cancel">never mind</button>`
              : `<button type="button" class="hr-heard" id="hr-heard">someone said it out loud</button>
                 <p class="ab-sub">typed guesses are judged automatically — you don't need to look at them</p>`)
            + hostSkip(ctx), `acting · ${ui.clock(s.left)}`);
          const h = $("hr-heard"); if (h) h.onclick = () => { heardOpen = true; sfx.tick(); ui.resetKey(); };
          const c = $("hr-cancel"); if (c) c.onclick = () => { heardOpen = false; ui.resetKey(); };
          $("game-panel").querySelectorAll("[data-heard]").forEach(b => b.onclick = () => {
            game.input("heard", { who: b.dataset.heard }); sfx.chime(); buzz(60); heardOpen = false; ui.resetKey();
          });
          bindHostSkip(game);
          return;
        }
        // GUESSER. The key deliberately excludes the guess count: a guess
        // arriving from anyone else must NOT rebuild this panel, or it would
        // wipe whatever this player is halfway through typing. The feed is
        // patched in place below instead.
        const gs = r.guesses ?? [];
        if (ui.once(`a:${s.ri}:g`, () => {})) {
          ui.stage(`what is ${who} doing?`, stage(`${esc(who)} is performing`)
            + ui.prompt("your guess…", text => { game.input("guess", { text }); sfx.tick(); setTimeout(reopen, 0); }, { maxlength: GUESS_MAX, submitLabel: "guess" })
            + `<div class="hr-guesses" id="hr-feed"></div>
            <p class="ab-sub">type as many as you like, or shout it — the first right answer wins</p>${hostSkip(ctx)}`, `guessing · ${ui.clock(s.left)}`);
          bindHostSkip(game);
        }
        const feed = $("hr-feed");
        if (feed) {
          const sig = `${gs.length}`;
          if (feed.dataset.sig !== sig) {
            feed.dataset.sig = sig;
            feed.innerHTML = gs.slice().reverse().slice(0, 14).map(g => `<div class="hr-guess ${g.by === ctx.me.id ? "hr-mine" : ""} ${g.verdict}">
              <b>${esc(s.players[g.by]?.handle ?? "?")}</b><span>${esc(g.text)}</span>${g.verdict === "close" ? `<em>close</em>` : ""}</div>`).join("") || `<div class="pt-empty">be first</div>`;
          }
        }
        return;

      } else if (s.phase === "result") {
        if (!ui.once(`r:${s.ri}`, () => {})) return;
        if (r.skipped) {
          ui.stage(`${who} left`, `<p class="ab-sub">nobody scores this turn</p>${hostSkip(ctx)}`, "no verdict");
        } else if (r.won) {
          const g = s.players[r.won.by];
          const said = r.won.how === "out loud" ? "said it out loud" : `typed “${esc(r.guesses.find(x => x.gid === r.won.gid)?.text ?? "")}”`;
          ui.stage(`${esc(g?.handle ?? "?")} got it`, `<div class="hr-secret">${esc(r.prompt)}</div>
            <div class="mh-big">${esc(g?.handle ?? "?")} +${r.pts} · ${esc(who)} +${r.perfPts}</div>
            <p class="ab-sub">${said} · landed in ${r.secs ?? "?"}s${r.perfPts > PTS_PERFORM ? ` — ${r.perfPts - PTS_PERFORM} speed bonus` : ""}</p>${hostSkip(ctx)}`, "got it");
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
