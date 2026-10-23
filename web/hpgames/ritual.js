// Humiliation Ritual (3+) — charades, in public.
//
// The host is a 3D clown (clown3d.js). Each turn he juggles gacha capsules
// with the players' faces on them, tosses one high, catches it in his mouth,
// spits it into his hands and holds it up: "[Name], you're up!" (picked
// random-but-fair, see fairpick.js). Then he twists it open. On the
// performer's phone a slip unrolls out of it: ACT IT OUT, and the prompt. On
// everyone else's he peeks inside, gasps, winks and goes "shhh", and the
// guess box appears: type guesses, as many as you like, for 60 seconds.
//
// The prompt only ever reaches the performer's phone. That phone asks the
// server for it (ritual_draw, migrations/015_ritual_prompts.sql) when its
// turn comes up; the host's game state never carries a prompt or a prompt id.
// The performer's phone sends the answer once the turn is over, for the big
// reveal. (Without the server hook, e.g. on the offline test pages, the
// performer's phone draws from the pool itself: still never sent anywhere.)
//
// The guesses land on the performer's screen as a live feed, and the
// performer taps the right one. That guesser and the performer both score —
// the guesser more, the performer less, both more the faster it landed
// (RITUAL in hpconfig). If time runs out, nobody scores. Either way the
// answer is revealed big, then the next performer is up.
//
// Close guesses (a typo, part of the answer) are highlighted for the
// performer by the matcher below, on the performer's phone, but it never
// decides anything: the performer does. It is local string matching — no AI
// service, no API key.
//
// The prompts live in web/data/ritual_prompts.json (a draft); ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { RITUAL } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";
import { typeDialog } from "./../retro.js";
import { spriteFace } from "./../partyboard.js";
import { fairPick } from "./../fairpick.js";
import { maxLevelFor } from "./secretdiary.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

// the clown's pick: juggle, toss one high, mouth catch, spit, hold it up
export const PICK_MS = 7800;
export const TOSS_AT = 3200;   // the chosen capsule goes up
export const SHOW_AT = 5600;   // ...and is held up to the camera: "[Name], you're up!"
// he twists it open: the slip for the performer, peek/wink/shhh for the rest
export const OPEN_MS = 3800;
const ACT_MS = RITUAL.ACT_MS;
const CAST_MAX = 5;          // capsules in the air at once
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

// a turn's key: names the turn on the server (ritual_draw) without saying
// anything about the prompt
const turnKey = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
};

// the clown, lazily: a failure here never stops the game (the 2D capsules stay)
let clownP = null;
const clownKit = () => clownP ??= import("./../clown3d.js").then(m => m.clownKit()).catch(e => { console.warn("[ritual] no 3D clown:", e?.message ?? e); return null; });

// a gacha capsule in HTML: the face and the name (the 2D fallback, and the
// big one held up when there's no 3D)
const capHue = id => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
function capsuleEl(p, cls = "") {
  const el = document.createElement("div");
  el.className = `hr-cap ${cls}`;
  el.style.setProperty("--cap-h", capHue(p.id));
  el.innerHTML = `<i class="hr-cap-top"></i><i class="hr-cap-bot"></i><b class="hr-cap-name"></b>`;
  el.querySelector(".hr-cap-name").textContent = p.handle ?? "?";
  const f = spriteFace(p.avatar ?? {}, 2);
  f.classList.add("hr-cap-face");
  el.querySelector(".hr-cap-top").after(f);
  return el;
}

export const HUMILIATION_RITUAL = {
  id: "ritual", title: "Humiliation Ritual",
  blurb: "charades, in public. the clown picks a performer, only they get the secret prompt, everyone types guesses, the performer taps the right one.",
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
    const meta = ctx.party ?? {};
    const PROMPTS = ritualPromptsFor(POOL, meta);
    const PER = Math.max(1, Math.min(3, +(ctx.options?.rounds ?? 1) || 1));
    let lastHud = 0, mine = [], beatTok = 0, dlg = null;
    // what only this phone knows: the prompt it drew for its own turn(s)
    const secrets = new Map();      // turn key -> { id, text } | null while drawing
    const drawnHere = new Set();    // prompt ids this phone drew (offline draws avoid repeats)
    const answered = new Map();     // turn key -> when the answer was last sent
    // the host's phone deals the bots' prompts itself (bots only exist in the
    // offline demo); kept in memory, never in the synced state
    const botSecrets = new Map();
    trash.add(() => { mine = []; secrets.clear(); botSecrets.clear(); beatTok++; dlg?.close(); dlg = null; clownP?.then(k => k?.detach()); });

    // the performer's own phone draws the prompt: from the server when the
    // party has one (only this phone is sent it), else from the pool here
    const localDraw = () => {
      const fresh = PROMPTS.filter(p => !drawnHere.has(p.id));
      const p = (fresh.length ? fresh : PROMPTS)[Math.floor(Math.random() * (fresh.length || PROMPTS.length))] ?? { id: "-", text: "a penguin" };
      return { id: p.id, text: p.text };
    };
    function mySecret(r) {
      if (!secrets.has(r.key)) {
        secrets.set(r.key, null);
        const ask = ctx.drawPrompt
          ? ctx.drawPrompt({ room: String(room.id), turn: r.key, level: maxLevelFor(meta) })
            .then(x => (x?.text ? x : Promise.reject(new Error("empty draw"))))
            .catch(e => { console.warn("[ritual] the server draw failed; drawing on this phone", e?.message ?? e); return localDraw(); })
          : Promise.resolve(localDraw());
        ask.then(x => { drawnHere.add(x.id); secrets.set(r.key, { id: x.id, text: x.text }); lastHud = 0; if (game.s) renderHR(game.s); });
      }
      return secrets.get(r.key);
    }

    clownKit();     // load the clown while the first pick gets going

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
      { name: "pick", ms: PICK_MS, enter: s => deal(s), next: () => "open" },
      { name: "open", ms: OPEN_MS, next: () => "act" },
      { name: "act", ms: ACT_MS, done: s => !!turn(s)?.won, next: s => { settle(s); return "result"; } },
      { name: "result", ms: RESULT_MS, next: s => (s.ti + 1 < s.turns ? (s.ti++, "pick") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
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
        s.turns = Object.keys(s.players).length * PER;
        s.ti = 0; s.weights = {}; s.turn = null;
        rounds.enter(s, "pick");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const r = turn(s);
        if (!r) return;
        if (s.phase === "act" && !r.startedAt) r.startedAt = Date.now();
        // a performer who leaves before the end skips the turn: nobody scores
        // and the prompt stays theirs
        if (s.players[r.performer]?.gone && ["pick", "open", "act"].includes(s.phase)) {
          r.skipped = true; r.won = null;
          rounds.enter(s, "result");
          return;
        }
        // the prompts this phone (the host's) already knows: a bot's, which it
        // dealt, or its own player's. Bots guess from those; nothing is sent.
        const bot = botSecrets.get(r.key) ?? (r.performer === ctx.me.id ? secrets.get(r.key) : null);
        if (s.phase === "act" && !r.won) {
          for (const p of active(s)) {
            // bots guess: noise, and for a bot's own prompt sometimes close or right
            if (p.isBot && p.id !== r.performer && game.rng() < dt * 0.3) {
              const x = game.rng();
              addGuess(s, r, p.id, bot && x < 0.18 ? bot.text : bot && x < 0.35 ? bot.text.split(/[\s-]/)[0] : botNoise(game.rng));
            }
          }
          // a bot performer taps the first guess that looks right, after a beat
          if (botSecrets.has(r.key) && game.rng() < dt * 0.4) {
            const g = r.guesses.find(g => judge(g.text, { answer: bot.text }) === "match");
            if (g) win(r, g);
          }
        }
        if (s.phase === "result" && botSecrets.has(r.key) && !r.answer && !r.skipped) r.answer = bot.text;
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const r = turn(s);
        if (!r || !s.players[m.from]) return;
        // the reveal: only the performer can say what it was, and only once
        // the turn is over
        if (m.in === "answer" && m.from === r.performer && m.key === r.key && s.phase === "result" && !r.answer && !r.skipped) {
          r.answer = String(m.text ?? "").trim().slice(0, 80) || null;
          return;
        }
        if (s.phase !== "act" || r.won) return;
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

    // tests: the current turn's prompt, if THIS phone knows it (its own, or a bot's it dealt)
    game.knownPrompt = () => { const r = turn(game.s ?? {}); return r ? (secrets.get(r.key) ?? botSecrets.get(r.key))?.text ?? null : null; };
    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false });
    const BOT_NOISE = ["a horse?", "driving", "cooking", "swimming", "falling over", "a baby", "waiting for a bus", "crying", "eating soup", "a tree", "sneezing", "very confused", "boxing", "a chicken"];
    const botNoise = rng => BOT_NOISE[Math.floor(rng() * BOT_NOISE.length)];

    // the next turn: a fair pick of the performer, and the capsules the clown
    // juggles (up to 5 players, the performer among them). No prompt here.
    function deal(s) {
      const ids = active(s).map(x => x.id);
      const { id, weights } = fairPick(s.weights, ids, game.rng);
      s.weights = weights;
      const others = shuffle(game.rng, ids.filter(x => x !== id)).slice(0, CAST_MAX - 1);
      const cast = shuffle(game.rng, [id, ...others]);
      s.turn = { no: s.ti + 1, key: turnKey(), performer: id, cast, guesses: [], won: null, startedAt: 0, pts: 0, perfPts: 0, secs: 0, skipped: false, answer: null };
      if (s.players[id]?.isBot) botSecrets.set(s.turn.key, localDraw());
    }
    function addGuess(s, r, by, text) {
      const t = text.trim().slice(0, GUESS_MAX);
      if (!t) return;
      if (r.guesses.some(g => g.by === by && norm(g.text) === norm(t))) return;   // no spamming the same guess
      const g = { gid: `g${r.n = (r.n ?? 0) + 1}`, by, text: t, t: Date.now() };
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

    // ---- the clown's show (every phone plays it from the synced clock) ----
    const person = (s, id) => ({ id, handle: s.players[id]?.handle ?? "?", avatar: ctx.humans.find(h => h.id === id)?.avatar ?? room.members?.find(m => m.id === id)?.avatar ?? {} });
    const castOf = (s, r) => (r.cast ?? [r.performer]).map(id => person(s, id));
    // the 3D clown's capsules cycle through everyone still here
    const everyoneOf = (s, r) => { const ids = active(s).map(p => p.id); return [...(r.cast ?? []), ...ids.filter(id => !(r.cast ?? []).includes(id))].map(id => person(s, id)); };
    // the beats of the clown's show run off the synced game clock (s.left),
    // checked on every render: a stall on the host's phone (say, the 3D
    // model loading) holds the show too, instead of running ahead of it
    let beats = null;      // { key: turn:phase, fired: Set }
    function beat(key, ms, elapsed, fn) {
      const bk = `${game.s?.ti}:${game.s?.phase}`;
      if (beats?.key !== bk) beats = { key: bk, fired: new Set() };
      if (beats.fired.has(key) || elapsed < ms) return;
      beats.fired.add(key);
      fn(elapsed - ms > 600);
    }
    const kitAt = (name, elapsed, chosen) => clownP?.then(k => { if (k?.shown) k.sync(name, elapsed, { chosen }); });
    function showPick(s, r, elapsed, built) {
      const el = $("hr-show"), cast = castOf(s, r), who = cast.find(p => p.id === r.performer) ?? cast[0];
      if (!el) return;
      if (built) {
        const tok = ++beatTok;
        // 2D capsules (hidden once the 3D clown draws)
        $("hr-caps").replaceChildren(...cast.map((p, i) => { const c = capsuleEl(p); c.style.setProperty("--i", i); c.style.setProperty("--n", cast.length); if (p.id === r.performer) c.classList.add("chosen"); return c; }));
        el.className = "hr-show b-juggle";
        clownKit().then(k => { if (k && tok === beatTok && el.isConnected) { k.attach(el); k.setCast(everyoneOf(s, r)); k.beat("juggle", 0, { chosen: who.id }); } });
      }
      if (elapsed < TOSS_AT) kitAt("juggle", elapsed, who.id);
      else kitAt("toss", elapsed - TOSS_AT, who.id);
      beat("toss", TOSS_AT, elapsed, late => {
        el.className = "hr-show b-toss";
        if (!late) { sfx.whoosh(); }
      });
      beat("gulp", TOSS_AT + 1100, elapsed, late => { if (!late) sfx.gulp(); });
      beat("show", SHOW_AT, elapsed, late => {
        el.className = "hr-show b-present";
        const host = $("hr-dlg");
        if (host && !dlg) dlg = typeDialog(host, { name: "CLOWN", text: `${who.handle}, you're up!`, blip: () => sfx.blip(), sticky: true, cls: "hr-dlg" });
        if (late) dlg?.skip();
        else { sfx.chime(); if (who.id === ctx.me.id) buzz([60, 40, 120]); }
      });
    }
    function showOpen(s, r, elapsed, perf, built) {
      const el = $("hr-show"), cast = castOf(s, r), who = cast.find(p => p.id === r.performer) ?? cast[0];
      if (!el) return;
      const name = perf ? "open" : "peek";
      if (built) {
        const tok = ++beatTok;
        $("hr-caps").replaceChildren(capsuleEl(who, "chosen"));
        el.className = `hr-show b-present ${perf ? "b-open" : "b-peek"}`;
        clownKit().then(k => { if (k && tok === beatTok && el.isConnected) { k.attach(el); k.setCast(everyoneOf(s, r)); k.beat(name, OPEN_MS - (game.s?.left ?? OPEN_MS), { chosen: who.id }); } });
      }
      kitAt(name, elapsed, who.id);
      if (perf) {
        beat("pop", 700, elapsed, late => { el.classList.add("popped"); if (!late) { sfx.gacha(); buzz([30, 30, 60]); confetti(el); } });
        beat("slip", 800, elapsed, () => el.classList.add("slip-out"));
      } else {
        beat("gasp", 1300, elapsed, late => { el.classList.add("gasp"); if (!late) sfx.cursor(); });
        beat("shh", 1800, elapsed, () => el.classList.add("shh"));
      }
    }
    function confetti(el) {
      if (matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const box = document.createElement("div");
      box.className = "hr-confetti";
      const C = ["#ffc83d", "#ff5d8a", "#3ee0d0", "#ffffff", "#ff8a3d"];
      for (let i = 0; i < 28; i++) {
        const b = document.createElement("i");
        b.style.cssText = `--x:${(Math.random() * 2 - 1) * 140}px;--y:${-60 - Math.random() * 140}px;--r:${Math.random() * 720 - 360}deg;background:${C[i % C.length]};animation-delay:${Math.random() * 80}ms`;
        box.appendChild(b);
      }
      el.appendChild(box);
      setTimeout(() => box.remove(), 1600);
    }
    const stageHtml = extra => `<div class="hr-show" id="hr-show"><div class="hr-caps" id="hr-caps"></div>${extra}</div><div class="hr-dlg-host" id="hr-dlg"></div>`;

    // ---- render ----
    let lastTurn = null;
    function renderHR(s) {
      const tk = `${s.ti}:${s.phase}`;
      if (tk !== lastTurn) {
        // per-phase local state resets on every phone, keyed off the state
        if (lastTurn?.split(":")[0] !== String(s.ti)) mine = [];
        lastTurn = tk; beatTok++; dlg?.close(); dlg = null;
        if (!["pick", "open"].includes(s.phase)) clownP?.then(k => k?.detach());
      }
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const r = turn(s);
      const who = s.players?.[r?.performer]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || 1}`;
      ui.hud(`<div class="hq"><b>HUMILIATION RITUAL</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase === "act" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
      if (!r && s.phase !== "end") return;
      // the performer's phone fetches its prompt as soon as it's picked
      const secret = r && isPerformer(s) ? mySecret(r) : null;

      if (s.phase === "pick") {
        const built = ui.once(`k:${s.ti}`, () => {
          ui.stage("", stageHtml("") + `${hostSkip(ctx)}`, `turn ${r.no} · who's it going to be…`);
          bindHostSkip(game);
        });
        showPick(s, r, PICK_MS - s.left, built);

      } else if (s.phase === "open") {
        const perf = isPerformer(s);
        const built = ui.once(`o:${s.ti}:${perf ? 1 : 0}`, () => {});
        if (built) {
          ui.stage("", stageHtml(perf
            ? `<div class="hr-slip" id="hr-slip"><div class="hr-kick">ACT IT OUT</div><div class="hr-prompt" id="hr-slip-p"></div></div>`
            : `<div class="hr-shh" aria-hidden="true">shhh…</div>`)
            + (perf ? `<p class="ab-sub">only you can see this. no talking, no spelling.</p>` : `<p class="ab-sub">${esc(who)} is about to perform. get ready to guess!</p>`) + hostSkip(ctx),
          perf ? "only you can see this" : `${esc(who)} is up`);
          bindHostSkip(game);
        }
        showOpen(s, r, OPEN_MS - s.left, perf, built);
        const sp = $("hr-slip-p");
        if (sp) { const t = secret?.text ?? ""; if (sp.dataset.t !== t) { sp.dataset.t = t; sp.textContent = t || "…"; } }

      } else if (s.phase === "act") {
        const gs = r.guesses ?? [];
        if (isPerformer(s)) {
          // PERFORMER: the prompt, the clock, and the live feed to tap. Hints
          // are worked out here, from this phone's own copy of the prompt.
          if (ui.once(`a:${s.ti}:perf:${secret ? 1 : 0}`, () => {})) {
            ui.stage("", `<div class="hr-card small"><div class="hr-kick">ACT IT OUT</div><div class="hr-prompt">${secret ? esc(secret.text) : "…"}</div></div>
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
          const sig = `${r.n ?? 0}:${r.won?.gid ?? ""}:${secret ? 1 : 0}`;
          if (feed && feed.dataset.sig !== sig) {
            feed.dataset.sig = sig;
            feed.innerHTML = gs.slice().reverse().slice(0, 24).map(g => {
              const hint = secret ? judge(g.text, { answer: secret.text }) : "wrong";
              return `<button type="button" class="hr-g ${hint}" data-gid="${esc(g.gid)}" ${r.won ? "disabled" : ""}>
              <b>${esc(s.players[g.by]?.handle ?? "?")}</b><span>${esc(g.text)}</span>${hint === "match" ? "<em>looks right</em>" : hint === "close" ? "<em>close</em>" : ""}</button>`;
            }).join("") || `<div class="hr-empty">guesses will pop up here</div>`;
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
        // the performer's phone says what it was, now that the turn is over
        // (again after a beat, in case the first one got lost)
        if (isPerformer(s) && secret && !r.answer && !r.skipped && Date.now() - (answered.get(r.key) ?? 0) > 1500) {
          answered.set(r.key, Date.now());
          game.input("answer", { key: r.key, text: secret.text });
        }
        if (!ui.once(`r:${s.ti}:${r.answer ? 1 : 0}`, () => {})) return;
        const board = P.slice().sort((a, b) => b.score - a.score).map(p => `<li class="${r.won && (p.id === r.won.by || p.id === r.performer) ? "me" : ""}"><b>${esc(p.handle)}</b><span>${p.score}</span></li>`).join("");
        const reveal = r.skipped
          ? `<div class="hr-reveal"><small>the prompt stays a secret</small><b>🤫</b></div>`
          : `<div class="hr-reveal ${r.answer ? "" : "waiting"}"><small>it was</small><b>${r.answer ? esc(r.answer) : "…"}</b></div>`;
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
          `<div class="hr-show hr-bowing" id="hr-show"><div class="hr-caps" id="hr-caps"></div></div><p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
        // the clown takes a bow
        const tok = ++beatTok;
        clownKit().then(k => { const el = $("hr-show"); if (k && tok === beatTok && el?.isConnected) { k.attach(el); k.beat("bow", 0); } });
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "pick", left: PICK_MS, players: {}, turns: 0, ti: 0, weights: {}, turn: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => { beatTok++; dlg?.close(); dlg = null; clownP?.then(k => k?.detach()); game.stop(); ui.hide(); o(r); };
  },
};
