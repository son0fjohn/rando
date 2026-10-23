// Humiliation Ritual (3+) — charades, in public.
//
// The host is a clown on a circus stage, built like the Art Gallery
// (npcscene.js): a painted backdrop, the clown as pose cutouts, props as
// cutouts, the UI in the room. Each turn he picks the performer (random but
// fair, see fairpick.js): he cranks a big gacha machine, the performer's
// capsule (their own 3D head inside, charrender.js) pops out of the chute,
// he catches it and holds it up: "[Name], you're up!". Then he cracks it
// open. On the performer's phone the slip unrolls
// out of it and flies up to become their ACT IT OUT card. On everyone
// else's he peeks inside, winks and goes "shhh", the capsule stays shut,
// and the guess box appears: type guesses, as many as you like, for 60
// seconds. The performer's 3D character takes the stage while they act.
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
import { at, posesHtml, setPose, Beats, arcTo, flyFrom, confetti, say, hush } from "./../npcscene.js";
import { renderLook } from "./../charrender.js";
import { fairPick } from "./../fairpick.js";
import { maxLevelFor } from "./secretdiary.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

// the clown's pick: he cranks the machine, the chosen capsule comes out,
// he catches it and holds it up to the camera
export const PICK_MS = 7000;
export const TOSS_AT = 2300;   // the chosen capsule pops out of the chute
export const SHOW_AT = 3600;   // ...and is held up to the camera: "[Name], you're up!"
// he cracks it open: the slip for the performer, peek/wink/shhh for the rest
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

// ---------------------------------------------------------------- the stage
// in the units of the NPC group (760 x 900): the clown's pose cutouts are
// 600x800 canvases standing on the floor line (y 900); the gacha machine
// stands on its drum to his right-hand side (screen left), its dial right
// under his hand in the "twist" pose. Every landmark below was measured on
// the pose cutouts (pose units, + the clown's offset).
const ART = "games/ritual/";
const G = { w: 760, h: 900 };
const CX = 160, CY = 100;                                   // the clown's canvas in the group
const P = (x, y) => [x + CX, y + CY];
const POSES = ["clown_idle", "clown_twist", "clown_catch", "clown_hold", "clown_open", "clown_peek", "clown_shh"];
const CAP = [192, 221];                                     // a capsule, as he holds it (capsule.webp at .457)
const HOLD = P(300, 371);                                   // its centre in the "hold" pose
const CATCH = P(294, 446);                                  // resting in his cupped hands in "catch"
const CUP = [200 + CX, 328 + CY, 202, 124];                 // the open cup in "open"
const LID = P(301, 273);                                    // the lid's centre, still on the cup
const DIAL = [140, 416, 88, 88], CHUTE = [184, 596];
// the players' capsules in the machine's globe, front row (centres)
const GLOBE = [[92, 316], [143, 339], [195, 316], [246, 339], [292, 313]];
const capHtml = (id, cls, style) => `<div class="hr-cap ${cls}" data-id="${esc(id)}" style="${style}"><img class="hr-cap-base" src="${ART}capsule.webp" alt=""><img class="hr-cap-head" alt=""><img class="hr-cap-gloss" src="${ART}capsule_top.webp" alt=""></div>`;
const box = ([x, y], [w, h]) => at(G, x - w / 2, y - h / 2, w, h);

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
    let lastHud = 0, mine = [], sceneTi = null, uiKey = null;
    const beats = new Beats(), looks = new Map();
    // what only this phone knows: the prompt it drew for its own turn(s)
    const secrets = new Map();      // turn key -> { id, text } | null while drawing
    const drawnHere = new Set();    // prompt ids this phone drew (offline draws avoid repeats)
    const answered = new Map();     // turn key -> when the answer was last sent
    // the host's phone deals the bots' prompts itself (bots only exist in the
    // offline demo); kept in memory, never in the synced state
    const botSecrets = new Map();
    trash.add(() => { mine = []; secrets.clear(); botSecrets.clear(); looks.clear(); });

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
          s.players[b.id] = seat(b.id, b.handle, true, b.avatar);
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
    const seat = (id, handle, isBot, avatar = null) => ({ id, handle, isBot, score: 0, gone: false, ...(isBot && avatar ? { avatar } : {}) });
    const BOT_NOISE = ["a horse?", "driving", "cooking", "swimming", "falling over", "a baby", "waiting for a bus", "crying", "eating soup", "a tree", "sneezing", "very confused", "boxing", "a chicken"];
    const botNoise = rng => BOT_NOISE[Math.floor(rng() * BOT_NOISE.length)];

    // the next turn: a fair pick of the performer, and the capsules in the
    // clown's gacha machine (up to 5 players, the performer among them). No
    // prompt here.
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
    const avatarOf = (s, id) => s?.players?.[id]?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? room.members?.find(m => m.id === id)?.avatar ?? {};
    // everyone's own 3D character, rendered once: heads for the capsules,
    // the full body for the performer on stage
    const lookOf = (s, id, frame = "head") => {
      const k = `${frame}:${id}`;
      if (!looks.has(k)) { looks.set(k, null); renderLook(avatarOf(s, id), { frame }).then(u => { if (looks.has(k)) { looks.set(k, u); paint(); } }); }
      return looks.get(k);
    };
    function paint() {
      const s = game.s;
      if (!s) return;
      document.querySelectorAll(".hr-room .hr-cap[data-id]").forEach(c => {
        const u = lookOf(s, c.dataset.id), im = c.querySelector(".hr-cap-head");
        if (u && im && im.getAttribute("src") !== u) im.src = u;
      });
      const st = $("hr-star");
      if (st?.dataset.id) { const u = lookOf(s, st.dataset.id, "full"); if (u && st.getAttribute("src") !== u) st.src = u; }
    }

    function sceneHtml(s, r) {
      const cast = r.cast ?? [r.performer];
      const caps = cast.map((id, i) => capHtml(id, `in-globe ${id === r.performer ? "chosen" : ""}`, `${box(GLOBE[i % GLOBE.length], CAP)};--s:.3`)).join("");
      return `<div class="np-room hr-room" style="background-image:url(${ART}stage.jpg)">
        <div class="np-pill" id="np-pill"></div>
        <h2 class="np-title" id="np-title"></h2>
        <div class="np-group hr-group" id="hr-show">
          <img class="np-prop hr-pedestal" src="${ART}pedestal.webp" alt="" style="${at(G, 0, 671, 371, 221)}">
          <img class="np-prop hr-machine" src="${ART}gacha.webp" alt="" style="${at(G, 19, 31, 331, 640)}">
          <img class="np-prop hr-dial" id="hr-dial" src="${ART}dial.webp" alt="" style="${at(G, ...DIAL)}">
          <img class="hr-star" id="hr-star" data-id="${esc(r.performer)}" alt="" style="${at(G, 0, 300, 380, 570)}">
          <div class="np-npc" id="hr-npc" style="${at(G, CX, CY, 600, 800)}"><div class="np-body">${posesHtml(ART, POSES, "clown_idle")}</div></div>
          <div class="hr-caps" id="hr-caps">${caps}</div>
          ${capHtml(r.performer, "hero", `${box(CHUTE, CAP)};--s:.42`)}
          <img class="hr-lid" id="hr-lid" src="${ART}capsule_top.webp" alt="" style="${box(LID, [192, 130])}">
          <i class="hr-cup" id="hr-cup" style="${at(G, ...CUP)}"></i>
        </div>
        <div class="np-bubble hr-bubble" id="np-bubble"></div>
        ${r.performer === ctx.me.id ? "" : `<div class="np-bubble hr-shh" id="hr-shh" aria-hidden="true">shhh…</div>`}
        <div class="hr-wall" id="hr-wall"></div>
        <div class="hr-ui" id="hr-ui"></div>
        ${hostSkip(ctx)}
      </div>`;
    }
    // built once per turn, then patched beat by beat: the capsule he catches
    // is the one he opens, and the performer's slip is their card all turn
    function scene(s, r) {
      if (sceneTi === s.ti && $("hr-npc")) return false;
      sceneTi = s.ti; uiKey = null;
      ui.panel(sceneHtml(s, r), "np-full");
      bindHostSkip(game);
      paint();
      return true;
    }
    const pkOf = s => `${s.ti}:${s.phase}`;
    const pose = (name, opts) => setPose($("hr-npc"), name, opts);
    const bump = () => { const n = $("hr-npc"); if (n) { n.classList.remove("np-bump"); void n.offsetWidth; n.classList.add("np-bump"); } };
    const top = pill => { const p = $("np-pill"); if (p && p._v !== pill) { p._v = pill; p.innerHTML = pill; } };
    const title = t => { const h = $("np-title"); if (h && h.textContent !== t) h.textContent = t; };
    const plaque = (key, html) => {
      if (uiKey === key) return false;
      uiKey = key;
      const u = $("hr-ui");
      if (u) u.innerHTML = html ? `<div class="np-plaque hr-plaque enter">${html}</div>` : "";
      return true;
    };
    const heroEl = () => $("hr-show")?.querySelector(".hr-cap.hero");
    const place = (el, x, y, rot = 0, sc = 1) => {
      el.style.left = `${((x - CAP[0] / 2) / G.w * 100).toFixed(3)}%`; el.style.top = `${((y - CAP[1] / 2) / G.h * 100).toFixed(3)}%`;
      el.style.transform = `rotate(${rot.toFixed(1)}deg) scale(${sc})`;
    };
    // the capsule in his hands, held up: the pose has the cup and the grip,
    // the capsule shows the head inside its dome
    const hold = el => { if (!el) return; el.classList.remove("gone"); el.classList.add("out", "inhand"); place(el, ...HOLD); };
    const caught = el => { if (!el) return; el.classList.add("out"); place(el, ...CATCH); };
    // the lid pops off and bounces away across the floor
    function popLid(fly) {
      const lid = $("hr-lid");
      if (!lid) return;
      lid.className = "hr-lid on";
      lid.style.cssText = box(LID, [192, 130]);
      if (!fly) { lid.classList.add("land"); return; }
      arcTo(lid, G, LID, [LID[0] + 230, 850], { ms: 820, peak: 170, spin: 400 }).then(() => lid.classList.add("land"));
    }
    const burst = () => confetti($("hr-show"), { x: `${(CUP[0] + CUP[2] / 2) / G.w * 100}%`, y: `${(CUP[1] + 20) / G.h * 100}%` });

    // ---- the pick: he cranks the gacha machine. (A juggling version was
    // tried first: with two drawn frames the hands snap and the capsules
    // teleport between palms, so it read as a flipbook, not a juggle.)
    function gachaBeats(s, r, elapsed) {
      const pk = pkOf(s), hero = heroEl();
      // anticipation: he steps to the machine and grabs the dial; action: two
      // full turns, the globe rattling, a click a quarter turn
      beats.at("grab", pk, 250, elapsed, late => { pose("clown_twist"); if (!late) sfx.cursor(); });
      beats.at("crank", pk, 500, elapsed, late => {
        $("hr-dial")?.classList.add("turn");
        $("hr-caps")?.classList.add("shake");
        if (!late) for (let i = 0; i < 8; i++) setTimeout(() => { if ($("hr-dial")) sfx.tick(); }, 120 + i * 200);
      });
      beats.at("bump1", pk, 1100, elapsed, () => bump());
      // the performer's capsule drops out of the globe into the works…
      beats.at("drop", pk, TOSS_AT - 300, elapsed, () => { $("hr-caps")?.classList.remove("shake"); $("hr-caps")?.querySelector(".chosen")?.classList.add("drop"); });
      // …hands ready (he lets go of the dial and cups them)…
      beats.at("ready", pk, TOSS_AT - 150, elapsed, () => pose("clown_catch"));
      // …and it pops out of the chute, on a real arc, into his hands
      beats.at("out", pk, TOSS_AT, elapsed, late => {
        if (!hero) return;
        if (late) { caught(hero); return; }
        hero.classList.add("out");
        sfx.stamp();
        arcTo(hero, G, CHUTE, CATCH, { ms: 650, peak: 150, spin: 360, scale: [0.42, 1] })
          .then(() => { if (hero.isConnected && pkOf(game.s ?? {}) === pk) { bump(); sfx.pop(); buzz(30); } });
      });
    }

    function showPick(s, r, elapsed, fresh) {
      const pk = pkOf(s), name = s.players?.[r.performer]?.handle ?? "?";
      if (fresh || uiKey !== pk) { plaque(pk, ""); title(""); top(`turn <b>${r.no}</b> · who's it going to be…`); }
      gachaBeats(s, r, elapsed);
      // hold: up to the camera, their head in the dome, and he names them
      beats.at("show", pk, SHOW_AT, elapsed, late => {
        pose("clown_hold");
        hold(heroEl());
        $("hr-caps")?.classList.add("away");
        top(`turn <b>${r.no}</b> · <b>${esc(name)}</b>`);
        say($("np-bubble"), `${name}, you're up!`, { blip: late ? null : () => sfx.blip() });
        if (!late) { sfx.chime(); if (r.performer === ctx.me.id) buzz([60, 40, 120]); }
      });
    }

    // the performer's slip: rises out of the cup, unrolls on the way and lands
    // as their card on the wall, where it stays for the turn
    function slip(r, fly) {
      const w = $("hr-wall");
      if (!w) return null;
      let c = w.querySelector(".hr-slip");
      if (!c) {
        w.innerHTML = `<div class="hr-slip"><div class="hr-kick">ACT IT OUT</div><div class="hr-prompt" id="hr-slip-p">…</div><p class="hr-note">only you can see this · no talking, no spelling</p></div>`;
        c = w.firstChild;
        if (fly) { c.classList.add("unroll"); flyFrom(c, $("hr-cup")?.getBoundingClientRect(), { ms: 1100, tilt: 85 }); }
      }
      const sp = $("hr-slip-p"), t = secrets.get(r.key)?.text ?? "";
      if (sp && sp.dataset.t !== t) { sp.dataset.t = t; sp.textContent = t || "…"; }
      return c;
    }

    function showOpen(s, r, elapsed, perf, fresh) {
      const pk = pkOf(s), who = s.players?.[r.performer]?.handle ?? "?";
      if (fresh || uiKey !== pk) {
        plaque(pk, "");
        hush($("np-bubble"));
        pose("clown_hold", { bump: false });
        hold(heroEl());
        $("hr-caps")?.classList.add("away");
        top(perf ? "only <b>you</b> can see this" : `<b>${esc(who)}</b> is up · get ready to guess`);
      }
      if (perf) {
        // anticipation (a squeeze), action (he cracks it, the lid flies), the slip
        beats.at("wind", pk, 300, elapsed, late => { bump(); if (!late) sfx.cursor(); });
        beats.at("crack", pk, 700, elapsed, late => {
          pose("clown_open");
          heroEl()?.classList.add("gone");
          popLid(!late);
          if (!late) { sfx.gacha(); buzz([30, 30, 60]); burst(); }
        });
        beats.at("slip", pk, 850, elapsed, late => slip(r, !late));
        slip(r, false);
      } else {
        // he peeks in (only he sees it), a gasp, then a wink: "shhh"
        beats.at("peek", pk, 400, elapsed, late => { pose("clown_peek"); heroEl()?.classList.add("gone"); if (!late) sfx.cursor(); });
        beats.at("gasp", pk, 1300, elapsed, late => { bump(); if (!late) sfx.pop(); });
        beats.at("shh", pk, 1800, elapsed, late => { pose("clown_shh"); $("hr-shh")?.classList.add("on"); if (!late) sfx.whoosh(); });
      }
    }

    // ---- render ----
    let lastTurn = null;
    function renderHR(s) {
      const tk = `${s.ti}:${s.phase}`;
      if (tk !== lastTurn) {
        // per-phase local state resets on every phone, keyed off the state
        if (lastTurn?.split(":")[0] !== String(s.ti)) mine = [];
        lastTurn = tk;
      }
      const now = performance.now(); if (now - lastHud < 100) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const r = turn(s);
      const who = s.players?.[r?.performer]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || 1}`;
      ui.hud(`<div class="hq"><b>HUMILIATION RITUAL</b><span>${step}</span><span class="clk ${s.left < 10000 && s.phase === "act" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
      if (!r && s.phase !== "end") return;
      // the performer's phone fetches its prompt as soon as it's picked
      const secret = r && isPerformer(s) ? mySecret(r) : null;
      // render everyone's look early: the capsules need them by the toss
      if (r) for (const id of r.cast ?? [r.performer]) lookOf(s, id);
      if (r && ["act", "result"].includes(s.phase)) lookOf(s, r.performer, "full");

      if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        sceneTi = null;
        showResults(P, { title: "Humiliation Ritual", sub: "final scores", note: `right guess: ${RITUAL.GUESS_PTS}-${RITUAL.GUESS_PTS + RITUAL.GUESS_SPEED} · performer: ${RITUAL.PERFORM_PTS}-${RITUAL.PERFORM_PTS + RITUAL.PERFORM_SPEED} · faster = more` },
          `<img class="hr-end-clown" src="${ART}clown_hold.webp" alt=""><p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
        return;
      }

      const fresh = scene(s, r);
      const pk = pkOf(s);

      if (s.phase === "pick") {
        showPick(s, r, PICK_MS - s.left, fresh);

      } else if (s.phase === "open") {
        showOpen(s, r, OPEN_MS - s.left, isPerformer(s), fresh);

      } else if (s.phase === "act") {
        const gs = r.guesses ?? [];
        if (fresh || !String(uiKey).startsWith(pk)) {
          // the performer takes the stage: their own character, in the spot
          pose("clown_idle", { bump: !fresh });
          hush($("np-bubble"));
          $("hr-shh")?.classList.remove("on");
          heroEl()?.classList.add("gone");
          $("hr-caps")?.classList.add("away");
          $("hr-show")?.classList.add("acting");
          paint();
        }
        if (isPerformer(s)) {
          // PERFORMER: their card stays up, the clock, the live feed to tap.
          // Hints are worked out here, from this phone's own copy of the prompt.
          slip(r, false)?.classList.add("hr-card", "small");
          top(`<b>act it out</b> · tap the right guess`);
          if (plaque(`${pk}|perf`, `<div class="hr-plq-top"><span>tap the right guess</span><span class="np-clock hr-clock" id="hr-clock">${ui.clock(s.left)}</span></div>
              <div class="hr-feed" id="hr-feed"></div>`)) {
            $("hr-feed").onclick = e => {
              const b = e.target.closest("[data-gid]");
              if (!b || b.disabled) return;
              game.input("pick", { gid: b.dataset.gid }); sfx.chime(); buzz(60);
              $("hr-feed").querySelectorAll("[data-gid]").forEach(x => { x.disabled = true; });
              b.classList.add("picked");
            };
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
          // arriving from anyone else must NOT rebuild this plaque, or it
          // would wipe what this player is halfway through typing. My own
          // list is patched in place.
          title("Guess what they're doing!");
          top(`<b>${esc(who)}</b> is performing`);
          plaque(`${pk}|g`, `<div class="hr-plq-top"><span><b>${esc(who)}</b> taps the right one</span><span class="np-clock hr-clock" id="hr-clock">${ui.clock(s.left)}</span></div>
              ${ui.prompt("your guess…", text => { mine.push(text); game.input("guess", { text }); sfx.tick(); setTimeout(reopen, 0); }, { maxlength: GUESS_MAX, submitLabel: "guess" })}
              <div class="hr-mine" id="hr-mine"></div>`);
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
        const key = `${pk}|${r.answer ? 1 : 0}`;
        if (uiKey === key) return;
        const first = !String(uiKey).startsWith(pk);
        const g = r.won ? s.players[r.won.by] : null;
        const board = P.slice().sort((a, b) => b.score - a.score).map(p => `<li class="${r.won && (p.id === r.won.by || p.id === r.performer) ? "me" : ""}"><b>${esc(p.handle)}</b><span>${p.score}</span></li>`).join("");
        title(r.skipped ? `${who} left` : r.won ? `${g?.handle ?? "?"} got it!` : "time's up!");
        top(r.skipped ? "nobody scores this turn" : r.won ? `“${esc(r.won.text)}” · ${r.secs}s` : "nobody got it — no points this turn");
        $("hr-shh")?.classList.remove("on");
        const w = $("hr-wall");
        if (r.skipped) {
          pose("clown_shh");
          if (w) w.innerHTML = `<div class="hr-reveal"><small>the prompt stays a secret</small><b>🤫</b></div>`;
        } else if (!r.answer) {
          // the capsule's back in his hands, waiting for the performer's phone
          if (first) { pose("clown_hold"); const h = heroEl(); if (h) { h.classList.remove("gone"); hold(h); } }
          if (w) w.innerHTML = `<div class="hr-reveal waiting"><small>it was</small><b>…</b></div>`;
        } else {
          // the reveal: he cracks it open for everyone and the answer flies up
          pose("clown_open");
          heroEl()?.classList.add("gone");
          const fly = !first || s.left > RESULT_MS - 1500;
          popLid(fly);
          if (w) {
            w.innerHTML = `<div class="hr-reveal"><small>it was</small><b>${esc(r.answer)}</b></div>`;
            if (fly) { flyFrom(w.firstChild, $("hr-cup")?.getBoundingClientRect(), { ms: 900, tilt: 80 }); sfx.gacha(); if (r.won) burst(); }
          }
        }
        plaque(key, r.won
          ? `<div class="hr-pts"><span><b>${esc(g?.handle ?? "?")}</b> +${r.pts}</span><span><b>${esc(who)}</b> +${r.perfPts}</span></div><ol class="sq-board">${board}</ol>`
          : `<ol class="sq-board">${board}</ol>`);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "pick", left: PICK_MS, players: {}, turns: 0, ti: 0, weights: {}, turn: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => { game.stop(); ui.hide(); o(r); };
  },
};
