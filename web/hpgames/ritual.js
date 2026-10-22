// Humiliation Ritual (3+) — charades, in public.
//
// Each turn one performer (picked random-but-fair, see fairpick.js) gets a
// secret prompt and acts it out. Only the performer sees it: a big
// "ACT IT OUT" card. Everyone else sees "Guess what they're doing!" and types
// guesses, as many as they like, for 60 seconds.
//
// The guesses land on the performer's screen as a live feed, and the
// performer taps the right one. That guesser and the performer both score —
// the guesser more, the performer less, both more the faster it landed
// (RITUAL in hpconfig). If time runs out, nobody scores. Either way the
// answer is revealed big, then the next performer is up.
//
// Close guesses (a typo, part of the answer) are highlighted for the
// performer by the matcher below, but it never decides anything: the
// performer does. It is local string matching — no AI service, no API key.
//
// The prompts live in web/data/ritual_prompts.json (a draft); ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { RITUAL } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";
import { fairPick } from "./../fairpick.js";
import { maxLevelFor } from "./secretdiary.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const PREP_MS = 5000;        // "you're up" — the performer reads the card
const ACT_MS = RITUAL.ACT_MS;
const RESULT_MS = 7000;
const END_MS = 22000;
const GUESS_MAX = 60;
const MAX_GUESSES = 80;      // ring buffer so a long turn can't bloat the state
const LV = ["mild", "spicy", "unhinged"];

// ---------------------------------------------------------------- the pool
let POOL = null;
const poolReady = fetch(new URL(`../${RITUAL.POOL_URL}`, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => { POOL = (j.prompts || []).filter(p => p && p.id && p.text && LV.includes(p.level)); return POOL; })
  .catch(e => { console.warn("[ritual] couldn't load the prompts", e); POOL = []; return POOL; });
export const ritualPool = () => poolReady;
// what this party may draw: up to the party's level (public parties: mild)
export const ritualPromptsFor = (pool, meta = {}) => pool.filter(p => LV.indexOf(p.level) <= LV.indexOf(maxLevelFor(meta)));

// points for a correct guess `ms` into the turn: { guesser, performer }
export function ritualPoints(ms) {
  const k = Math.max(0, Math.min(1, 1 - ms / ACT_MS));
  return { guesser: Math.round(RITUAL.GUESS_PTS + RITUAL.GUESS_SPEED * k), performer: Math.round(RITUAL.PERFORM_PTS + RITUAL.PERFORM_SPEED * k) };
}

// ---------------------------------------------------------------- the hint
const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "is", "it", "its", "and", "or", "at", "for", "with", "by",
  "someone", "something", "somebody", "your", "you", "my", "me", "their", "they", "be", "being", "doing", "like", "very",
  "really", "just", "that", "this", "who", "what", "are", "was", "has", "have", "person", "guy"]);
const norm = s => String(s ?? "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// light stemming: enough to make peeing/pee, dogs/dog, tantrums/tantrum meet
function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ed")) return w.slice(0, -2);
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
// a guess word that is a good chunk of an answer word ("speed" in "ishowspeed")
const partOf = (g, t) => g.length >= 4 && t.length > g.length && t.includes(g);
// the same word in another form ("constipation" / "constipated")
const sameRoot = (a, b) => a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6);
// a HINT for the performer, never a verdict:
//   "match": every meaningful word of the answer is in the guess (typos ok)
//   "close": the guess shares a word with it, or a good part of one
export function judge(guess, round) {
  const G = tokens(guess), joined = norm(guess).replace(/ /g, "");
  if (!G.length) return "wrong";
  const targets = [round.answer, ...(round.alt ?? [])];
  for (const t of targets) {
    const T = tokens(t);
    if (!T.length) continue;
    if (T.every(tw => G.some(gw => wordEq(gw, tw)))) return "match";
    // "sydneysweeney", "i show speed": the words without their spaces
    if (wordEq(joined, T.join(""))) return "match";
  }
  const raw = norm(guess).split(" ").filter(w => !STOP.has(w));
  for (const t of targets) {
    if (tokens(t).some(tw => G.some(gw => wordEq(gw, tw) || sameRoot(gw, tw)))) return "close";
    const whole = norm(t).replace(/ /g, "");
    if (raw.some(w => partOf(w, whole))) return "close";
  }
  return "wrong";
}

export const HUMILIATION_RITUAL = {
  id: "ritual", title: "Humiliation Ritual",
  blurb: "charades, in public. one player acts out a secret prompt, everyone types guesses, the performer taps the right one.",
  minPlayers: 3, maxPlayers: 12, length: "~1.5 min per turn",
  backdrop: "room",            // played over the party room (dimmed), not the map
  options: [{
    key: "rounds", label: "rounds",
    choices: [
      { value: "1", label: "everyone once", hint: "each player performs once" },
      { value: "2", label: "everyone twice", hint: "each player performs twice" },
    ],
    default: "1",
  }],

  start(ctx) {
    if (!POOL) { ui.show(); ui.stage("Humiliation Ritual", `<p class="ab-sub">setting the stage…</p>`, "loading"); poolReady.then(() => this._start(ctx)); return; }
    this._start(ctx);
  },

  _start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    const PROMPTS = ritualPromptsFor(POOL, ctx.party ?? {});
    const PER = Math.max(1, Math.min(3, +(ctx.options?.rounds ?? 1) || 1));
    let lastHud = 0, mine = [];
    trash.add(() => { mine = []; });

    // ui.prompt locks its input after one submit — and it does so AFTER
    // calling our onSubmit, so this has to run on the next tick. This game
    // wants a stream of guesses, so re-open in place: no rebuild, no lost focus.
    function reopen() {
      const inp = $("gp-in"), btn = $("game-panel")?.querySelector(".gp-form button");
      if (inp) { inp.disabled = false; inp.value = ""; inp.focus(); }
      if (btn) btn.disabled = false;
    }

    const turn = s => s.turn ?? null;
    const isPerformer = s => turn(s)?.performer === ctx.me.id;

    const rounds = new Rounds([
      { name: "prep", ms: PREP_MS, enter: s => deal(s), next: () => "act" },
      { name: "act", ms: ACT_MS, done: s => !!turn(s)?.won, next: s => { settle(s); return "result"; } },
      { name: "result", ms: RESULT_MS, next: s => (s.ti + 1 < s.turns ? (s.ti++, "prep") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "prep") { sfx.open(); buzz([20, 40, 20]); }
        if (name === "act") sfx.now();
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
        s.deck = shuffle(game.rng, PROMPTS.map(p => p.id));
        s.turns = Object.keys(s.players).length * PER;
        s.ti = 0; s.weights = {}; s.turn = null; s.used = [];
        rounds.enter(s, "prep");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const r = turn(s);
        if (!r) return;
        if (s.phase === "act" && !r.startedAt) r.startedAt = Date.now();
        // a performer who leaves mid-act ends the turn with nobody scoring
        if (s.players[r.performer]?.gone && (s.phase === "prep" || s.phase === "act")) {
          r.skipped = true; r.won = null;
          rounds.enter(s, "result");
          return;
        }
        if (s.phase === "act" && !r.won) {
          for (const p of active(s)) {
            // bots guess: mostly nonsense, sometimes close, now and then right
            if (p.isBot && p.id !== r.performer && game.rng() < dt * 0.3) {
              const x = game.rng();
              addGuess(s, r, p.id, x < 0.18 ? r.answer : x < 0.35 ? r.answer.split(/[\s-]/)[0] : botNoise(game.rng));
            }
          }
          // a bot performer taps the first guess that looks right, after a beat
          if (s.players[r.performer]?.isBot && game.rng() < dt * 0.4) {
            const g = r.guesses.find(g => g.hint === "match");
            if (g) win(r, g);
          }
        }
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const r = turn(s);
        if (!r || !s.players[m.from] || s.phase !== "act" || r.won) return;
        if (m.in === "guess" && m.from !== r.performer) addGuess(s, r, m.from, String(m.text ?? ""));
        // only the performer can call a guess right (and never their own: they don't guess)
        if (m.in === "pick" && m.from === r.performer) {
          const g = r.guesses.find(x => x.gid === m.gid);
          if (g && g.by !== r.performer && s.players[g.by]) win(r, g);
        }
      },
      render(s) { renderHR(s); },
      onEvent() {},
    }, { hz: 5 });   // guesses should feel live

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false });
    const BOT_NOISE = ["a horse?", "driving", "cooking", "swimming", "falling over", "a baby", "waiting for a bus", "crying", "eating soup", "a tree", "sneezing", "very confused", "boxing", "a chicken"];
    const botNoise = rng => BOT_NOISE[Math.floor(rng() * BOT_NOISE.length)];

    // the next turn: fair pick of the performer, the next prompt off the deck
    function deal(s) {
      if (!s.deck.length) s.deck = shuffle(game.rng, PROMPTS.map(p => p.id));
      const p = PROMPTS.find(x => x.id === s.deck.shift()) ?? PROMPTS[0] ?? { id: "-", text: "a penguin" };
      const { id, weights } = fairPick(s.weights, active(s).map(x => x.id), game.rng);
      s.weights = weights;
      s.used.push(p.id);
      s.turn = { no: s.ti + 1, performer: id, prompt: p.text, pid: p.id, answer: p.text, guesses: [], won: null, startedAt: 0, pts: 0, perfPts: 0, secs: 0, skipped: false };
    }
    function addGuess(s, r, by, text) {
      const t = text.trim().slice(0, GUESS_MAX);
      if (!t) return;
      if (r.guesses.some(g => g.by === by && norm(g.text) === norm(t))) return;   // no spamming the same guess
      const g = { gid: `g${r.n = (r.n ?? 0) + 1}`, by, text: t, hint: judge(t, r), t: Date.now() };
      r.guesses.push(g);
      if (r.guesses.length > MAX_GUESSES) r.guesses.splice(0, r.guesses.length - MAX_GUESSES);
    }
    function win(r, g) { r.won = { gid: g.gid, by: g.by, text: g.text, at: Date.now() }; }

    // the guesser and the performer both score, more the faster it landed
    function settle(s) {
      const r = turn(s);
      if (!r || !r.won) return;
      const ms = Math.max(0, r.won.at - (r.startedAt || r.won.at));
      const pts = ritualPoints(ms);
      r.pts = pts.guesser; r.perfPts = pts.performer; r.secs = Math.round(ms / 1000);
      const g = s.players[r.won.by], perf = s.players[r.performer];
      if (g) g.score += r.pts;
      if (perf) perf.score += r.perfPts;
    }

    // ---- render ----
    let lastTurn = null;
    function renderHR(s) {
      const tk = `${s.ti}:${s.phase === "act" ? "a" : "x"}`;
      if (tk !== lastTurn) { lastTurn = tk; mine = []; }
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const r = turn(s);
      const who = s.players?.[r?.performer]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || 1}`;
      ui.hud(`<div class="hq"><b>HUMILIATION RITUAL</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
      if (!r && s.phase !== "end") return;

      if (s.phase === "prep") {
        if (!ui.once(`p:${s.ti}:${isPerformer(s) ? 1 : 0}`, () => {})) return;
        if (isPerformer(s)) {
          ui.stage("you're up", `<div class="hr-card"><div class="hr-kick">ACT IT OUT</div><div class="hr-prompt">${esc(r.prompt)}</div></div>
            <p class="ab-sub">no talking, no spelling, no pointing at words. guesses will show up here — tap the right one.</p>${hostSkip(ctx)}`, "only you can see this");
        } else {
          ui.stage(`${esc(who)} is up`, `<div class="hr-up"><b>${esc(who)}</b><span>is about to perform</span></div>
            <p class="ab-sub">get ready to guess — type as many as you like.</p>${hostSkip(ctx)}`, "get ready");
        }
        bindHostSkip(game);

      } else if (s.phase === "act") {
        const gs = r.guesses ?? [];
        if (isPerformer(s)) {
          // PERFORMER: the prompt, the clock, and the live feed to tap
          if (ui.once(`a:${s.ti}:perf`, () => {})) {
            ui.stage("", `<div class="hr-card small"><div class="hr-kick">ACT IT OUT</div><div class="hr-prompt">${esc(r.prompt)}</div></div>
              <div class="hr-clock" id="hr-clock">${ui.clock(s.left)}</div>
              <div class="rl-h">tap the right guess</div>
              <div class="hr-feed" id="hr-feed"></div>${hostSkip(ctx)}`, "acting");
            $("hr-feed").onclick = e => {
              const b = e.target.closest("[data-gid]");
              if (!b || b.disabled) return;
              game.input("pick", { gid: b.dataset.gid }); sfx.chime(); buzz(60);
              $("hr-feed").querySelectorAll("[data-gid]").forEach(x => { x.disabled = true; });
              b.classList.add("picked");
            };
            bindHostSkip(game);
          }
          const feed = $("hr-feed");
          const sig = `${r.n ?? 0}:${r.won?.gid ?? ""}`;
          if (feed && feed.dataset.sig !== sig) {
            feed.dataset.sig = sig;
            feed.innerHTML = gs.slice().reverse().slice(0, 24).map(g => `<button type="button" class="hr-g ${g.hint}" data-gid="${esc(g.gid)}" ${r.won ? "disabled" : ""}>
              <b>${esc(s.players[g.by]?.handle ?? "?")}</b><span>${esc(g.text)}</span>${g.hint === "match" ? "<em>looks right</em>" : g.hint === "close" ? "<em>close</em>" : ""}</button>`).join("")
              || `<div class="hr-empty">guesses will pop up here</div>`;
          }
        } else {
          // GUESSER. The key leaves out everyone else's guesses: a guess
          // arriving from anyone else must NOT rebuild this panel, or it
          // would wipe what this player is halfway through typing. My own
          // list is patched in place.
          if (ui.once(`a:${s.ti}:g`, () => {})) {
            ui.stage("Guess what they're doing!", `<div class="hr-up"><b>${esc(who)}</b><span>is performing</span></div>
              <div class="hr-clock" id="hr-clock">${ui.clock(s.left)}</div>
              ${ui.prompt("your guess…", text => { mine.push(text); game.input("guess", { text }); sfx.tick(); setTimeout(reopen, 0); }, { maxlength: GUESS_MAX, submitLabel: "guess" })}
              <div class="hr-mine" id="hr-mine"></div>
              <p class="ab-sub">${esc(who)} taps the right one — first right guess wins</p>${hostSkip(ctx)}`, "guessing");
            bindHostSkip(game);
          }
          const el = $("hr-mine");
          const sig = `${mine.length}`;
          if (el && el.dataset.sig !== sig) { el.dataset.sig = sig; el.innerHTML = mine.slice().reverse().slice(0, 8).map(t => `<span>${esc(t)}</span>`).join(""); }
        }
        const c = $("hr-clock");
        if (c) { c.textContent = ui.clock(s.left); c.classList.toggle("urgent", s.left < 10000); }

      } else if (s.phase === "result") {
        if (!ui.once(`r:${s.ti}`, () => {})) return;
        const board = P.slice().sort((a, b) => b.score - a.score).map(p => `<li class="${r.won && (p.id === r.won.by || p.id === r.performer) ? "me" : ""}"><b>${esc(p.handle)}</b><span>${p.score}</span></li>`).join("");
        const reveal = `<div class="hr-reveal"><small>it was</small><b>${esc(r.prompt)}</b></div>`;
        if (r.skipped) {
          ui.stage(`${esc(who)} left`, reveal + `<p class="ab-sub">nobody scores this turn</p><ol class="sq-board">${board}</ol>${hostSkip(ctx)}`, "no verdict");
        } else if (r.won) {
          const g = s.players[r.won.by];
          ui.stage(`${esc(g?.handle ?? "?")} got it!`, reveal + `<p class="hr-said">“${esc(r.won.text)}” · ${r.secs}s</p>
            <div class="hr-pts"><span><b>${esc(g?.handle ?? "?")}</b> +${r.pts}</span><span><b>${esc(who)}</b> +${r.perfPts}</span></div>
            <ol class="sq-board">${board}</ol>${hostSkip(ctx)}`, "got it");
        } else {
          ui.stage("time's up!", reveal + `<p class="ab-sub">nobody got it — no points this turn</p><ol class="sq-board">${board}</ol>${hostSkip(ctx)}`, "nobody got it");
        }
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, { title: "Humiliation Ritual", sub: "final scores", note: `right guess: ${RITUAL.GUESS_PTS}-${RITUAL.GUESS_PTS + RITUAL.GUESS_SPEED} · performer: ${RITUAL.PERFORM_PTS}-${RITUAL.PERFORM_PTS + RITUAL.PERFORM_SPEED} · faster = more` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "prep", left: PREP_MS, players: {}, deck: [], turns: 0, ti: 0, weights: {}, turn: null, used: [] });
    const o = ctx.onEnd;
    ctx.onEnd = r => { game.stop(); ui.hide(); o(r); };
  },
};
