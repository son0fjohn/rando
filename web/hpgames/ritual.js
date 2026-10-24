// Humiliation Ritual (3+) — charades, in public.
//
// The host is The Boss (boss.js): an old mafia boss in clown face paint,
// sitting back behind a folding table in a gray basement, a cardboard box
// full of gacha capsules in front of him. He talks through the dialog box
// (dialog.js). Each turn he picks the performer (random but fair, see
// fairpick.js): "Pick a capsule. Any capsule." He reaches into the box,
// pulls one out and holds it up to the camera; it spins, players' faces
// flicking through it like a slot machine (their own 3D faces,
// charrender.js), slowing over a drumroll, and lands on the performer's: a
// flash, a little shake, their name slams onto the screen. Their own 3D
// character pops in in front of his table under one harsh spotlight and
// stays for the turn; he takes a slow drag on his cigar: "[Name]. You're
// up." Their phone goes to a red spotlight, "YOU'RE UP"; everyone else's
// says "[Name] is performing". Then he twists it open, pop, confetti. On
// the performer's phone a slip unrolls out of it and flies at the camera,
// filling the screen, and a red ACT IT OUT stamp slams onto it. On everyone
// else's he peeks inside, smirks and goes "Shhh.", and the guess box slides
// up: type guesses, as many as you like, for 60 seconds. A slow approving
// nod closes the turn. The pick and the reveal take about 8 s; the host can
// skip ahead. Players can look around (orbit) the whole time.
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
import { Beats, flyFrom, confetti, impact, nameSlam, takeover, banner, stampOn } from "./../npcscene.js";
import { dialogBox } from "./../dialog.js";
import { renderLook } from "./../charrender.js";
import { fairPick } from "./../fairpick.js";
import { maxLevelFor } from "./secretdiary.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

// the Boss's pick: "Pick a capsule. Any capsule.", he reaches into the box,
// takes one out and holds it up to the camera, it spins through the faces
export const PICK_MS = 5200;
export const REACH_AT = 150;   // he leans in and reaches into the box
export const TAKE_AT = 900;    // ...comes out with a capsule, held up: it spins, faces flicking (a drumroll)
export const SHOW_AT = 3400;   // ...it lands on the performer: "[Name]. You're up." (the name holds ~1.5 s)
// he twists it open: the slip for the performer, peek/smirk/shhh for the rest
export const OPEN_MS = 2800;
const POP_AT = 650, SLIP_AT = 750, STAMP_AT = 1500;
const ACT_MS = RITUAL.ACT_MS;
const CAST_MAX = 5;          // the turn's cast: whose capsules are in play (the performer's among them)
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
// What he says, in English or Korean (the phone's language); the prompts
// themselves are as written in the pool.
const KO = /^ko\b/i.test(globalThis.navigator?.language ?? "");
const LINES = {
  en: {
    name: "The Boss",
    pick: "Pick a capsule. Any capsule.",
    up: n => `${n}. You're up.`,
    shh: "Shhh.",
    upBig: "YOU'RE UP", performing: n => `${n} is performing`, act: "ACT IT OUT", skip: "skip ▸▸",
    yours: "That one's yours. No talking. Sell it.",
    got: (g, n) => `${g} got it. ${n}, not bad.`,
    nobody: "Nobody? That's a shame.",
    left: n => `${n} walked out. Nobody scores.`,
    end: "That's the night. Everybody did their part.",
    // tap him between beats
    quips: ["Patience. Business takes time.", "You owe me a laugh, kid.", "Nobody leaves until somebody performs."],
  },
  ko: {
    name: "보스",
    pick: "캡슐 하나 골라. 아무거나.",
    up: n => `${n}. 네 차례야.`,
    shh: "쉿.",
    upBig: "네 차례야", performing: n => `${n} 공연 중`, act: "연기해", skip: "넘기기 ▸▸",
    yours: "이건 네 거야. 말하지 말고, 팔아 봐.",
    got: (g, n) => `${g}, 맞혔네. ${n}, 나쁘지 않아.`,
    nobody: "아무도 못 맞혔어? 아쉽네.",
    left: n => `${n} 나가 버렸어. 이번엔 점수 없음.`,
    end: "오늘 밤은 여기까지. 다들 제 몫은 했어.",
    quips: ["인내심. 사업엔 시간이 걸려.", "너 나한테 웃음 하나 빚졌다, 꼬마야.", "누군가 하기 전엔 아무도 못 나가."],
  },
};
const T = KO ? LINES.ko : LINES.en;
export const bossLines = LINES;
// the players' faces in the capsule, lit like his room: soft, no coloured rim
const LOOK_RIM = 0xe8e8ee;
// The Boss's basement in 3D fills the screen (boss.js). Until it's up, or if
// this phone can't draw it, the room is plain gray: never a picture of him.
const sceneHtml = ctx => `<div class="np-room hr-room">
    <div class="hr-3d" id="hr-3d"></div>
    <div class="np-pill" id="np-pill"></div>
    <h2 class="np-title" id="np-title"></h2>
    <div class="hr-wall" id="hr-wall"></div>
    <div class="hr-low">${hostSkip(ctx)}<div class="hr-ui" id="hr-ui"></div><div class="hr-dlg" id="hr-dlg"></div></div>
  </div>`;


export const HUMILIATION_RITUAL = {
  id: "ritual", title: "Humiliation Ritual",
  blurb: "charades, in public. the Boss picks a performer, only they get the secret prompt, everyone types guesses, the performer taps the right one.",
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
    let lastHud = 0, mine = [], sceneTi = null, uiKey = null, dlgKey = null, phaseNow = "pick", quipN = Math.floor(Math.random() * 3);
    const beats = new Beats(), looks = new Map();
    // what only this phone knows: the prompt it drew for its own turn(s)
    const secrets = new Map();      // turn key -> { id, text } | null while drawing
    const drawnHere = new Set();    // prompt ids this phone drew (offline draws avoid repeats)
    const answered = new Map();     // turn key -> when the answer was last sent
    // the host's phone deals the bots' prompts itself (bots only exist in the
    // offline demo); kept in memory, never in the synced state
    const botSecrets = new Map();
    // one Boss and one dialog box for the whole game, moved into each turn's
    // freshly built scene. He loads (model, room, shaders) as the game starts.
    let boss = null, bossP = null;
    const holder = document.createElement("div");
    const dlg = dialogBox(document.createElement("div"), { name: T.name, blip: () => sfx.blip() });
    const loadBoss = () => (bossP ??= import("./../boss.js").then(m => m.bossScene(holder)).then(b => { boss = b; return b; })
      .catch(e => { console.warn("[ritual] no 3D basement, the plain room stays:", e?.message ?? e); return null; }));
    loadBoss();
    // what the scene should show; re-applied whenever he's (re)mounted
    const want = { pose: "idle", cap: "hidden", face: null, name: "", guest: null };
    const room$ = () => $("game-panel")?.querySelector(".hr-room");
    // taps on the scene, between beats only: him (a line, and a drag on the
    // cigar or a slow nod), the box (a rattle), the cup (a sip), the lamp
    const busy = () => ["pick", "open", "end"].includes(phaseNow);
    const onTap = kind => {
      if (kind === "lamp") { sfx.cursor(); return true; }
      if (kind === "box") { for (let i = 0; i < 4; i++) setTimeout(() => sfx.tick(), i * 70); buzz(12); return true; }
      if (busy()) return false;
      if (kind === "cup") { sfx.blip(); return true; }
      if (kind !== "boss") return false;
      const q = T.quips[quipN++ % T.quips.length];
      if (dlg.el.hidden) { dlg.show(); dlg.say(q); const k = phaseNow; setTimeout(() => { if (phaseNow === k && k === "act") dlg.hide(); }, 2600); }
      else if (dlg.done) dlg.quip(q);
      else return false;
      sfx.blip(); buzz(15);
      return true;
    };
    function mount3d() {
      loadBoss().then(b => {
        const at = $("hr-3d");
        if (!b || !at) return;
        const first = !b.stage.canvas.isConnected && !room$()?.classList.contains("r3d");
        if (first) b.stage.canvas.style.opacity = "0";   // the first time: fade in over the plain room
        b.attach(at);
        b.setPose(want.pose); b.capsuleState(want.cap); b.capsule(want.face, want.name);
        if (want.guest) b.guest.show(want.guest.id, want.guest.avatar, { pop: false });
        b.onTap = onTap;
        globalThis.__boss = b;                             // for the tests
        requestAnimationFrame(() => requestAnimationFrame(() => { b.stage.canvas.style.opacity = ""; room$()?.classList.add("r3d"); }));
      });
    }
    trash.add(() => { mine = []; secrets.clear(); botSecrets.clear(); looks.clear(); dlg.dispose(); bossP?.then(b => b?.dispose()); boss = null; bossP = null; if (globalThis.__boss) globalThis.__boss = null; });

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

    // the next turn: a fair pick of the performer, and the turn's cast (up to
    // 5 players, the performer among them). No prompt here.
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

    // ---- the Boss's show (every phone plays it from the synced clock) ----
    const avatarOf = (s, id) => s?.players?.[id]?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? room.members?.find(m => m.id === id)?.avatar ?? {};
    // everyone's own 3D head, rendered once, for the capsule
    const lookOf = (s, id) => {
      if (!looks.has(id)) { looks.set(id, null); renderLook(avatarOf(s, id), { frame: "head", rim: LOOK_RIM }).then(u => { if (looks.has(id)) { looks.set(id, u); if (want.cap !== "hidden" && game.s?.turn?.performer === id) capsule(game.s, id); } }); }
      return looks.get(id);
    };
    // the scene: built once per turn, then patched beat by beat, so the
    // performer's slip is their card all turn
    function scene(s) {
      if (sceneTi === s.ti && room$()) return false;
      sceneTi = s.ti; uiKey = null; dlgKey = null;
      ui.panel(sceneHtml(ctx), "np-full");
      bindHostSkip(game);
      dlg.attach($("hr-dlg"));
      mount3d();
      return true;
    }
    const pkOf = s => `${s.ti}:${s.phase}`;
    const pose = name => { want.pose = name === "nod" ? "idle" : name; boss?.setPose(name); };
    const play = name => boss?.play(name);
    const capState = st => { want.cap = st; boss?.capsuleState(st); };
    const capsule = (s, id) => { want.face = lookOf(s, id); want.name = s.players?.[id]?.handle ?? ""; boss?.capsule(want.face, want.name); };
    // the performer, standing in front of his table (null: nobody)
    const guest = (s, id, { pop = false, react = null } = {}) => {
      if (!id) { if (want.guest) { want.guest = null; boss?.guest.hide(); } return; }
      if (want.guest?.id === id && !pop && !react) return;
      want.guest = { id, avatar: avatarOf(s, id) };
      boss?.guest.show(id, want.guest.avatar, { pop, react });
    };
    // a face flicking past in the spinning capsule (no name under it yet)
    const flickFace = (s, id) => { const u = lookOf(s, id); if (u) { want.face = u; want.name = ""; boss?.capsule(u, ""); } };
    let spinTok = 0;
    const skipLabel = txt => { const b = $("hp-skip"); if (b && b.textContent !== txt) b.textContent = txt; };
    const top = pill => { const p = $("np-pill"); if (p && p._v !== pill) { p._v = pill; p.innerHTML = pill; } };
    const title = t => { const h = $("np-title"); if (h && h.textContent !== t) h.textContent = t; };
    // the panel over the dialog (feed, guess box, points), rebuilt only when its key changes
    const plaque = (key, html) => {
      if (uiKey === key) return false;
      uiKey = key;
      const u = $("hr-ui");
      if (u) u.innerHTML = html ? `<div class="np-plaque hr-plaque enter">${html}</div>` : "";
      return true;
    };
    // what he says, once per key: `late` (arrived mid-beat) shows it at once
    const line = (key, text, { late = false } = {}) => {
      if (dlgKey === key) return false;
      dlgKey = key;
      dlg.show(); dlg.say(text, { instant: late });
      return true;
    };
    // where the capsule is on screen (the slip and the confetti come out of it)
    const capRect = () => boss?.capsuleRect() ?? (() => { const r = room$()?.getBoundingClientRect(); return r && { left: r.left + r.width * 0.45, top: r.top + r.height * 0.4, width: r.width * 0.1, height: r.width * 0.1 }; })();
    const burst = () => {
      const rm = room$(), c = capRect();
      if (!rm || !c) return;
      const r = rm.getBoundingClientRect();
      confetti(rm, { n: 18, x: `${((c.left + c.width / 2 - r.left) / r.width * 100).toFixed(1)}%`, y: `${((c.top + c.height / 2 - r.top) / r.height * 100).toFixed(1)}%` });
    };

    // ---- the pick: "Pick a capsule. Any capsule." He reaches into the box,
    // comes out with one, and holds it up: their face inside, their name
    function showPick(s, r, elapsed, fresh) {
      const pk = pkOf(s), name = s.players?.[r.performer]?.handle ?? "?";
      if (fresh || uiKey !== pk) {
        plaque(pk, ""); title(""); top(`turn <b>${r.no}</b> · who's it going to be…`); $("hr-wall") && ($("hr-wall").innerHTML = "");
        $("hr-wall")?.classList.remove("full");
        guest(s, null);                                    // last turn's performer leaves
      }
      if (elapsed < TAKE_AT) { capState("hidden"); }
      if (elapsed < SHOW_AT) line(`${pk}:pick`, T.pick, { late: elapsed > 1200 });
      beats.at("reach", pk, REACH_AT, elapsed, late => { pose("reach"); if (!late) { for (let i = 0; i < 3; i++) setTimeout(() => sfx.tick(), 200 + i * 90); } });
      // held up to the camera, it spins: the cast's faces flick through it,
      // fast then slowing, over a drumroll, landing on the performer's
      beats.at("take", pk, TAKE_AT, elapsed, late => {
        capState("inhand"); pose("hold");
        if (late && elapsed > SHOW_AT - 300) return;
        boss?.capsuleSpin(true);
        const ids = (r.cast?.length ? r.cast : [r.performer]).filter(id => s.players?.[id]);
        const tok = ++spinTok, steps = [];
        let t = TAKE_AT + 100, d = 60, i = Math.floor(Math.random() * ids.length);
        while (t + d < SHOW_AT - 120) { steps.push([t, ids[i++ % ids.length]]); t += d; d *= 1.13; }
        for (const [at, id] of steps) {
          if (at < elapsed) continue;
          setTimeout(() => { if (tok === spinTok) { flickFace(s, id); sfx.tick(); } }, at - elapsed);
        }
        flickFace(s, steps.find(([at]) => at >= elapsed)?.[1] ?? r.performer);
        if (!late) { sfx.pop(); sfx.drumroll((SHOW_AT - elapsed) / 1000 - 0.1); }
      });
      beats.at("show", pk, SHOW_AT, elapsed, late => {
        spinTok++; boss?.capsuleSpin(false);
        capsule(s, r.performer); capState("inhand"); pose("hold");
        top(`turn <b>${r.no}</b> · <b>${esc(name)}</b>`);
        line(`${pk}:up`, T.up(name), { late });
        guest(s, r.performer, { pop: !late, react: late ? null : "surprised" });
        play("drag");                                      // a slow drag on the cigar
        const room = room$(), mine = r.performer === ctx.me.id;
        if (!late) { sfx.chime(); sfx.slam(); impact(room, { from: capRect(), color: "rgba(255, 250, 240, .9)" }); }
        // held ~1.5 s from the landing; a phone that got here late still shows it, briefly
        const ms = Math.max(600, SHOW_AT + 1500 - elapsed), msT = Math.max(700, SHOW_AT + 2000 - elapsed);
        if (mine) { takeover(room, T.upBig, { kind: "red", late, ms: msT }); if (!late) buzz([90, 40, 220]); }
        else { nameSlam(room, name, { late, ms }); banner(room, T.performing(name), { cls: "red", ms: msT + 400 }); }
      });
      if (elapsed >= SHOW_AT) capsule(s, r.performer);
    }

    // the performer's slip: it unrolls out of the capsule toward the camera
    // and lands as their card on the wall, where it stays for the turn
    function slip(r, fly, { stamped = true } = {}) {
      const w = $("hr-wall");
      if (!w) return null;
      let c = w.querySelector(".hr-slip");
      if (!c) {
        w.innerHTML = `<div class="hr-slip"><div class="hr-prompt" id="hr-slip-p">…</div><p class="hr-note">only you can see this · no talking, no spelling</p></div>`;
        c = w.firstChild;
        if (fly) { c.classList.add("unroll"); flyFrom(c, capRect(), { ms: 800, tilt: 85 }); }
      }
      if (stamped && !c.querySelector(".hr-kick")) stampOn(c, T.act, { cls: "red hr-kick", late: true });
      const sp = $("hr-slip-p"), t = secrets.get(r.key)?.text ?? "";
      if (sp && sp.dataset.t !== t) { sp.dataset.t = t; sp.textContent = t || "…"; }
      return c;
    }

    // ---- the open: he twists it open, pop. The performer gets the slip;
    // everyone else sees him peek, smirk and go "shhh"
    function showOpen(s, r, elapsed, perf, fresh) {
      const pk = pkOf(s), who = s.players?.[r.performer]?.handle ?? "?";
      if (fresh || uiKey !== pk) {
        plaque(pk, "");
        capsule(s, r.performer);
        if (elapsed < 900) { capState("inhand"); pose("hold"); }
        top(perf ? "only <b>you</b> can see this" : `<b>${esc(who)}</b> is up · get ready to guess`);
      }
      guest(s, r.performer);
      beats.at("twist", pk, 150, elapsed, late => { if (!late) { play("twist"); sfx.cursor(); } });
      beats.at("pop", pk, POP_AT, elapsed, late => { capState("open"); if (!late) { sfx.gacha(); buzz([30, 30, 60]); burst(); } });
      if (perf) {
        // the slip unrolls out of the capsule and flies at the camera, filling
        // the screen; ACT IT OUT slams onto it
        beats.at("slip", pk, SLIP_AT, elapsed, late => { $("hr-wall")?.classList.add("full"); slip(r, !late, { stamped: late }); line(`${pk}:yours`, T.yours, { late }); if (!late) sfx.whoosh(); });
        beats.at("stamp", pk, STAMP_AT, elapsed, late => {
          const c = slip(r, false, { stamped: false });
          if (c && !c.querySelector(".hr-kick")) stampOn(c, T.act, { cls: "red hr-kick", late });
          if (!late) { sfx.thud(); buzz(40); }
        });
        if (elapsed >= SLIP_AT) slip(r, false, { stamped: elapsed >= STAMP_AT });
      } else {
        beats.at("peek", pk, SLIP_AT, elapsed, late => { pose("peek"); if (!late) sfx.cursor(); });
        beats.at("smirk", pk, 1300, elapsed, late => { if (!late) { play("smirk"); sfx.pop(); } });
        beats.at("shh", pk, 1800, elapsed, late => { capState("hidden"); pose("shhh"); line(`${pk}:shh`, T.shh, { late }); if (!late) sfx.whoosh(); });
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
      phaseNow = s.phase;
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
      // render the performer's look early: the capsule needs it by the take
      if (r) lookOf(s, r.performer);

      if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        sceneTi = null;
        showResults(P, { title: "Humiliation Ritual", sub: "final scores", note: `right guess: ${RITUAL.GUESS_PTS}-${RITUAL.GUESS_PTS + RITUAL.GUESS_SPEED} · performer: ${RITUAL.PERFORM_PTS}-${RITUAL.PERFORM_PTS + RITUAL.PERFORM_SPEED} · faster = more` },
          `<p class="ab-sub">${esc(T.end)}</p><p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
        return;
      }

      const fresh = scene(s);
      const pk = pkOf(s);
      if (["pick", "open"].includes(s.phase)) skipLabel(T.skip);
      else if ($("hp-skip")?.textContent === T.skip) skipLabel("host: skip ahead");

      if (s.phase === "pick") {
        showPick(s, r, PICK_MS - s.left, fresh);

      } else if (s.phase === "open") {
        showOpen(s, r, OPEN_MS - s.left, isPerformer(s), fresh);

      } else if (s.phase === "act") {
        const gs = r.guesses ?? [];
        if (fresh || !String(uiKey).startsWith(pk)) {
          // the acting: he sits back with his cigar and watches; the dialog
          // steps aside for the feed / the guess box
          pose("idle"); capState("hidden");
          dlg.hide(); dlgKey = null;
          $("hr-wall")?.classList.remove("full");
          guest(s, r.performer);
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
        const w = $("hr-wall");
        // a slow approving nod to close the turn, and his verdict
        if (first) { capState("hidden"); pose(r.skipped ? "shhh" : "idle"); if (!r.skipped) play("nod"); $("hr-wall")?.classList.remove("full"); if (r.skipped) guest(s, null); }
        line(`${pk}:said`, r.skipped ? T.left(who) : r.won ? T.got(g?.handle ?? "?", who) : T.nobody, { late: s.left < RESULT_MS - 1500 });
        if (r.skipped) {
          if (w) w.innerHTML = `<div class="hr-reveal"><small>the prompt stays a secret</small><b>🤫</b></div>`;
        } else if (!r.answer) {
          // waiting for the performer's phone to say what it was
          if (w) w.innerHTML = `<div class="hr-reveal waiting"><small>it was</small><b>…</b></div>`;
        } else if (w) {
          // the reveal: the answer drops in for everyone
          const fly = !first || s.left > RESULT_MS - 1500;
          w.innerHTML = `<div class="hr-reveal"><small>it was</small><b>${esc(r.answer)}</b></div>`;
          if (fly) { flyFrom(w.firstChild, capRect(), { ms: 900, tilt: 80 }); sfx.gacha(); if (r.won) burst(); }
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
