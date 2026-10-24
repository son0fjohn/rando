// Side Quest (3+) — The Prophet hands out real-life dares.
//
// He sits in his back room behind a folding table with a crystal ball on it
// (prophet.js) and talks through the dialog box at the bottom of the screen
// (dialog.js). Each turn the ball first flicks through everyone's faces
// (their own 3D characters, charrender.js) and lands on whoever is up
// (random but fair — see fairpick.js): "Relax. The ball already knows who's
// next... [name]." He points at them. Then the quest card rises out of the
// ball and stays on screen for the rest of the turn: "SIDE QUEST: [dare]".
//
// The one on the quest gets Accept / Give up and 3 minutes, out in the
// world, while the others film on their own phones. Rating opens the moment
// the turn starts: everyone watching taps 1-5 ("how hard did they commit?")
// as soon as they've seen enough, and one tap locks it in. The turn ends once
// everyone has rated; the timer only ends it if they haven't. Giving up is an
// automatic 0 and skips the rating. Points are the average stars x
// SIDEQUEST.POINTS_PER_STAR. He closes each turn with a smug nod.
//
// Before the first turn the host sees the quest pool grouped by category,
// everything on; they can switch single quests or whole categories off and
// set the number of turns (default: everyone once), or just tap Start.
// Unhinged quests only exist for parties that allow 18+ content.
//
// The quests live in web/data/side_quests.json; their ids are permanent.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { SIDEQUEST } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash } from "./../hpkit.js";
import { fairPick } from "./../fairpick.js";
import { Beats, flyFrom } from "./../npcscene.js";
import { dialogBox } from "./../dialog.js";
import { renderLook } from "./../charrender.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));

const SETUP_MS = 5 * 60 * 1000;   // nobody taps Start: go with what's on
const SPIN_MS = 6800;
const SPIN_LAND_MS = 3200;        // of SPIN_MS: faces flick past, it lands, he names them, a beat
const QUEST_MS = 5600;
const SWIRL_MS = 1700;            // of QUEST_MS: the ball swirls again, then the card
const RESULT_MS = 8000;
const END_MS = 22000;
const STARS = SIDEQUEST.STARS, PPS = SIDEQUEST.POINTS_PER_STAR;

// what he says, in English or Korean (the phone's language); the quests
// themselves are as written in the pool
const KO = /^ko\b/i.test(globalThis.navigator?.language ?? "");
const LINES = {
  en: {
    name: "The Prophet", kicker: "SIDE QUEST:",
    wait: "Sit down, kid. Fate's got a job for you.",
    relax: "Relax. The ball already knows who's next...",
    quest: q => `SIDE QUEST: ${q}`,
    accept: "Accept", giveUp: "Give up", again: "Tap again to give up",
    go: "Clock's running. Go. They're filming.",
    rate: n => `How hard is ${n} committing?`,
    lbl: ["Barely", "A little", "Decent", "Properly", "FULL SEND"],
    locked: l => `${l}. Locked in. It ends when everyone's rated.`,
    youGaveUp: "You gave up. That's a zero.",
    theyGaveUp: n => `${n} gave up. No rating this time.`,
    left: n => `${n} left. Nobody scores this one.`,
    zero: "Gave up. Zero points. The ball saw it coming.",
    verdict: (a, p) => `${a} out of 5. +${p}.`,
    nobody: "Nobody rated it. Zero.",
    rated: (k, n) => `${k}/${n} rated`,
    // tap him between beats
    quips: ["Patience.", "Don't rush fate, kid.", "I already know what you're gonna ask.", "The ball doesn't like fingerprints.", "Mm-hm."],
  },
  ko: {
    name: "예언자", kicker: "사이드 퀘스트:",
    wait: "앉아, 꼬마야. 운명이 너한테 시킬 일이 있어.",
    relax: "진정해. 공은 이미 다음이 누군지 알고 있어...",
    quest: q => `사이드 퀘스트: ${q}`,
    accept: "수락", giveUp: "포기", again: "한 번 더 누르면 포기",
    go: "시간 간다. 가. 다들 찍고 있어.",
    rate: n => `${n}, 얼마나 진심이야?`,
    lbl: ["겨우", "조금", "괜찮게", "제대로", "풀 센드"],
    locked: l => `${l}. 확정. 다 평가하면 끝나.`,
    youGaveUp: "포기했네. 0점이야.",
    theyGaveUp: n => `${n} 포기했어. 이번엔 평가 없음.`,
    left: n => `${n} 나갔어. 이번 판은 점수 없음.`,
    zero: "포기. 0점. 공은 이미 알고 있었지.",
    verdict: (a, p) => `5점 만점에 ${a}. +${p}.`,
    nobody: "아무도 평가 안 했어. 0점.",
    rated: (k, n) => `${k}/${n} 평가`,
    quips: ["인내심.", "운명을 서두르지 마, 꼬마야.", "네가 뭘 물어볼지 이미 알아.", "공에 지문 묻히지 마.", "음-흠."],
  },
};
const T = KO ? LINES.ko : LINES.en;
export const prophetLines = LINES;

// ---------------------------------------------------------------- the pool
let POOL = null, CATS = [];
const poolReady = fetch(new URL(`../${SIDEQUEST.POOL_URL}`, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => {
    CATS = (j.categories || []).filter(c => c && c.id);
    POOL = (j.quests || []).filter(q => q && q.id && q.text && CATS.some(c => c.id === q.category));
    return POOL;
  })
  .catch(e => { console.warn("[sidequest] couldn't load the quest pool", e); POOL = []; return POOL; });
export const questPool = () => poolReady.then(() => ({ quests: POOL, categories: CATS }));

// what this party may draw from: unhinged quests need the party's 18+ setting
export const questsFor = (pool, meta = {}) => pool.filter(q => q.level !== "unhinged" || !!meta?.settings?.adult);
// average stars -> points
export const questPoints = avg => Math.round((avg ?? 0) * PPS);

// ---------------------------------------------------------------- the scene
// The Prophet's back room in 3D fills the screen (prophet.js). Until it's up,
// or if this phone can't draw it, the room is plain gray with a simple
// glowing ball (#sq-orb): never a picture of him.
const sceneHtml = ctx => `<div class="np-room sq-room">
    <div class="sq-3d" id="sq-3d"></div>
    <div class="sq-orb" id="sq-orb"><img class="sq-face" id="sq-face" alt=""></div>
    <div class="sq-wall" id="sq-wall"></div>
    <div class="sq-low">${hostSkip(ctx)}<div class="sq-ui" id="sq-ui"></div><div class="sq-dlg" id="sq-dlg"></div></div>
  </div>`;
const cardHtml = (q, cls = "") => `<div class="sq-card ${cls}"><div class="sq-kicker">${esc(T.kicker)}</div><div class="sq-text">${esc(q?.text ?? "…")}</div>${q?.level && q.level !== "mild" ? `<em class="sq-lv ${esc(q.level)}">${esc(q.level)}</em>` : ""}</div>`;
const starsHtml = (fill, cls = "") => `<div class="sq-stars ${cls}" style="--fill:${Math.max(0, Math.min(1, fill)) * 100}%"><span class="sq-st-bg">${"★".repeat(STARS)}</span><span class="sq-st-fg">${"★".repeat(STARS)}</span></div>`;
// the players' faces in the ball, lit like his room: soft, no coloured rim
const LOOK_RIM = 0xe8e8ee;

export const SIDE_QUEST = {
  id: "sidequest", title: "Side Quest",
  blurb: "the Prophet hands out a real-life dare. one player has 3 minutes to do it — everyone films and rates how hard they committed.",
  minPlayers: 3, maxPlayers: 12, length: "~4 min per turn",
  // picking the quests is the host's own setup: everyone else waits in the
  // lobby, and the host can back out of it (party.js)
  hostSetup: ["setup"],
  describe: meta => (meta?.settings?.adult ? "unhinged quests on" : ""),

  start(ctx) {
    if (!POOL) { ui.show(); ui.stage("Side Quest", `<p class="ab-sub">the Prophet is lighting his pipe…</p>`, "loading"); poolReady.then(() => this._start(ctx)); return; }
    this._start(ctx);
  },

  _start(ctx) {
    ui.show(); ui.theme("chaos");
    const room = ctx.room;
    const meta = ctx.party ?? {};
    const AVAIL = questsFor(POOL, meta);
    const cats = CATS.filter(c => AVAIL.some(q => q.category === c.id));
    let lastHud = 0, lastTurn = null, myVote = null, giveUpArmed = 0, accepted = null, openCats = new Set(), spinTok = 0;
    let sceneTi = null, uiKey = null, dlgKey = null, chKey = null;
    const beats = new Beats(), looks = new Map();
    // one Prophet and one dialog box for the whole game, moved into each
    // turn's freshly built scene. He loads (model, room, shaders) as soon as
    // the game starts, while the host picks the quests, so the first spin
    // never waits on him.
    let prophet = null, prophetP = null;
    const holder = document.createElement("div");
    const dlg = dialogBox(document.createElement("div"), { name: T.name, blip: () => sfx.blip() });
    const loadProphet = () => (prophetP ??= import("./../prophet.js").then(m => m.prophetScene(holder)).then(p => { prophet = p; return p; })
      .catch(e => { console.warn("[sidequest] no 3D back room, the plain one stays:", e?.message ?? e); return null; }));
    loadProphet();
    let lastPose = "idle", lastOrb = "idle", lastFace = null, lastPush = 0, lastHold = false, phaseNow = "setup", quipN = Math.floor(Math.random() * 5);
    // taps on the scene: him (a line, between beats only), the ball, the lamp
    const onTap = kind => {
      if (kind === "ball") { sfx.chime(); return true; }
      if (kind === "lamp") { sfx.cursor(); return true; }
      if (kind === "tv") { sfx.blip(); return true; }
      if (kind !== "prophet" || ["spin", "quest", "end"].includes(phaseNow) || !dlg.done) return false;
      dlg.quip(T.quips[quipN++ % T.quips.length]);
      sfx.blip(); buzz(15);
      return true;
    };
    function mount3d() {
      loadProphet().then(p => {
        const at = $("sq-3d");
        if (!p || !at) return;
        const first = !p.stage.canvas.isConnected && !room$()?.classList.contains("r3d");
        if (first) p.stage.canvas.style.opacity = "0";   // the first time: fade in over the plain room
        p.attach(at);
        p.setPose(lastPose); p.orb(lastOrb); p.push(lastPush); p.hold(lastHold); if (lastFace) p.face(lastFace);
        p.onTap = onTap;
        globalThis.__prophet = p;                          // for the tests
        requestAnimationFrame(() => requestAnimationFrame(() => { p.stage.canvas.style.opacity = ""; room$()?.classList.add("r3d"); }));
      });
    }
    trash.add(() => { myVote = null; looks.clear(); dlg.dispose(); prophetP?.then(p => p?.dispose()); prophet = null; prophetP = null; if (globalThis.__prophet) globalThis.__prophet = null; });

    const turn = s => s.turn ?? null;
    const isMe = s => turn(s)?.who === ctx.me.id;
    const voters = s => active(s).filter(p => p.id !== turn(s)?.who);
    const avatarOf = (s, id) => s?.players?.[id]?.avatar ?? room.members.find(m => m.id === id)?.avatar ?? ctx.humans.find(h => h.id === id)?.avatar ?? {};
    // everyone's 3D head for the ball, rendered once (and early: during setup)
    const lookOf = (s, id) => {
      if (!looks.has(id)) { looks.set(id, null); renderLook(avatarOf(s, id), { frame: "head", rim: LOOK_RIM }).then(u => { if (looks.has(id)) looks.set(id, u); }); }
      return looks.get(id);
    };

    const rounds = new Rounds([
      { name: "setup", ms: SETUP_MS, done: s => !!s.setup.go, next: s => { begin(s); return "spin"; } },
      // first who (the ball lands on a face), then what (it swirls up the quest)
      { name: "spin", ms: SPIN_MS, enter: s => pick(s), next: () => "quest" },
      { name: "quest", ms: QUEST_MS, enter: s => deal(s), next: () => "do" },
      {
        // the quest and the rating at once: done when they give up, or when
        // everyone watching has rated (the timer is only the backstop)
        name: "do", ms: SIDEQUEST.DO_MS,
        done: s => turn(s)?.status === "gaveup" || (voters(s).length > 0 && voters(s).every(p => turn(s)?.votes[p.id] !== undefined)),
        next: s => { const t = turn(s); if (t && !t.status) t.status = voters(s).every(p => t.votes[p.id] !== undefined) ? "rated" : "timeup"; tally(s); return "result"; },
      },
      { name: "result", ms: RESULT_MS, next: s => (s.ti + 1 < s.turns ? (s.ti++, "spin") : "end") },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "spin") sfx.open();
        if (name === "quest") sfx.whoosh();
        if (name === "do") { sfx.now(); buzz([30, 40, 30]); }
        if (name === "result") sfx.pop();
        if (name === "end") sfx.win();
      },
    });

    const seat = (id, handle, isBot, avatar = null) => ({ id, handle, isBot, score: 0, gone: false, ...(isBot && avatar ? { avatar } : {}) });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true, b.avatar);
        s.setup = { off: [], turns: null, go: false };
        s.weights = {}; s.deck = []; s.used = []; s.ti = 0; s.turns = 0; s.turn = null;
        rounds.enter(s, "setup");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        const t = turn(s);
        // the player on the quest left: skip the turn, nobody scores it
        if (t && s.players[t.who]?.gone && ["spin", "quest", "do"].includes(s.phase)) {
          t.skipped = true; t.pts = 0;
          rounds.enter(s, "result");
          return;
        }
        if (t && s.phase === "do" && s.players[t.who]?.isBot && !t.status && game.rng() < dt * 0.02) {
          t.status = "gaveup";
          t.doneAt = Date.now();
        }
        if (t && s.phase === "do" && !t.status)
          for (const p of voters(s))
            if (p.isBot && t.votes[p.id] === undefined && game.rng() < dt * 0.15) t.votes[p.id] = 2 + Math.floor(game.rng() * 4);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const fromHost = m.from === room.hostId;
        if (m.in === "skip" && fromHost) { s.left = 0; return; }
        if (s.phase === "setup" && fromHost) {
          const off = new Set(s.setup.off);
          if (m.in === "sq-q" && AVAIL.some(q => q.id === m.id)) { if (m.on) off.delete(m.id); else off.add(m.id); }
          if (m.in === "sq-cat") for (const q of AVAIL) if (q.category === m.cat) { if (m.on) off.delete(q.id); else off.add(q.id); }
          if (m.in === "sq-all") { if (m.on) off.clear(); }
          s.setup.off = [...off];
          if (m.in === "sq-turns") { const n = Math.round(Number(m.n)); if (Number.isFinite(n)) s.setup.turns = Math.max(1, Math.min(SIDEQUEST.MAX_TURNS, n)); }
          if (m.in === "sq-go" && enabled(s).length) s.setup.go = true;
          return;
        }
        const t = turn(s), p = s.players[m.from];
        if (!t || !p) return;
        if (m.in === "giveup" && s.phase === "do" && m.from === t.who && !t.status) {
          t.status = "gaveup";
          t.doneAt = Date.now();
        }
        // one tap locks a rating in: a second one is ignored
        if (m.in === "rate" && s.phase === "do" && !t.status && m.from !== t.who && t.votes[p.id] === undefined) {
          const v = Math.round(Number(m.v));
          if (v >= 1 && v <= STARS) t.votes[p.id] = v;
        }
      },
      render(s) { renderSQ(s); },
      onEvent() {},
    }, { hz: 4 });

    const enabled = s => { const off = new Set(s.setup.off); return AVAIL.filter(q => !off.has(q.id)); };

    // setup's done: lock in the deck and the number of turns
    function begin(s) {
      let qs = enabled(s);
      if (!qs.length) qs = AVAIL;
      s.deck = shuffle(game.rng, qs.map(q => q.id));
      s.turns = s.setup.turns ?? Math.max(1, active(s).length);
      s.ti = 0;
    }
    // a new turn: first the fair pick of who's up…
    function pick(s) {
      const { id, weights } = fairPick(s.weights, active(s).map(p => p.id), game.rng);
      s.weights = weights;
      s.turn = { no: s.ti + 1, quest: null, who: id, status: null, doneAt: 0, votes: {}, avg: null, n: 0, pts: 0, skipped: false };
    }
    // …then their quest, the next one off the deck
    function deal(s) {
      const t = turn(s);
      if (!t || t.quest) return;
      if (!s.deck.length) s.deck = shuffle(game.rng, (enabled(s).length ? enabled(s) : AVAIL).map(q => q.id));
      const qid = s.deck.shift();
      const q = AVAIL.find(x => x.id === qid) ?? AVAIL[0];
      s.used.push(q.id);
      t.quest = { id: q.id, text: q.text, category: q.category, level: q.level };
    }
    // the stars -> points; giving up is 0 and nobody votes
    function tally(s) {
      const t = turn(s);
      if (!t) return;
      if (t.status === "gaveup") { t.avg = 0; t.n = 0; t.pts = 0; }
      else {
        const vs = Object.values(t.votes).filter(v => Number.isFinite(v));
        t.n = vs.length;
        t.avg = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
        t.pts = questPoints(t.avg);
      }
      const p = s.players[t.who];
      if (p) p.score += t.pts;
    }

    // ---- the scene: built once per turn, then patched phase by phase, so
    // the card that rises out of the ball is the same card for the whole turn
    const room$ = () => $("game-panel")?.querySelector(".sq-room");
    function scene(s) {
      if (sceneTi === s.ti && room$()) return false;
      sceneTi = s.ti; uiKey = null;
      ui.panel(sceneHtml(ctx), "np-full");
      bindHostSkip(game);
      dlg.attach($("sq-dlg"));
      mount3d();
      return true;
    }
    const pose = name => { lastPose = name === "nod" ? "idle" : name; prophet?.setPose(name); };
    const orb = mode => { lastOrb = mode; prophet?.orb(mode); const o = $("sq-orb"); if (o) o.className = `sq-orb ${mode}`; };
    const push = k => { lastPush = k; prophet?.push(k); };
    // the key moments (the pick, the reveal): the camera glides home and stays
    const hold = on => { if (on !== lastHold) { lastHold = on; prophet?.hold(on); } };
    const face = (s, id, pop = false) => {
      const img = $("sq-face"), url = lookOf(s, id);
      if (url) { lastFace = url; prophet?.face(url, pop); }
      if (!img) return;
      if (url && img.getAttribute("src") !== url) img.src = url;
      img.classList.toggle("none", !url);
      if (pop) { img.classList.remove("pop"); void img.offsetWidth; img.classList.add("pop"); }
    };
    // the panel over the dialog (clock, verdict), rebuilt only when its key changes
    const panel = (key, html, cls = "") => {
      if (uiKey === key) return false;
      uiKey = key;
      const u = $("sq-ui");
      if (u) u.innerHTML = html ? `<div class="sq-panel ${cls}">${html}</div>` : "";
      return true;
    };
    // what he says, once per key: `late` (arrived mid-beat) shows it at once
    const line = (key, text, { late = false, cont = false } = {}) => {
      if (dlgKey === key) return false;
      dlgKey = key; chKey = null;
      dlg.say(text, { instant: late, cont });
      return true;
    };
    const choices = (key, list, onPick, opts = {}) => {
      if (chKey === key) return;
      chKey = key;
      dlg.choose(list, { onPick, ...opts });
    };
    const noChoices = () => { if (chKey) { chKey = null; dlg.clearChoices(); } };
    // the quest card; the first time it rises out of the ball
    function card(t, { rise = false, small = false } = {}) {
      const w = $("sq-wall");
      if (!w || !t?.quest) return;
      let c = w.querySelector(".sq-card");
      if (!c) {
        w.innerHTML = cardHtml(t.quest);
        c = w.querySelector(".sq-card");
        if (rise) { const o = prophet ? prophet.ballRect() : $("sq-orb")?.getBoundingClientRect(); flyFrom(c, o && { left: o.left, top: o.top, width: o.width, height: o.height * 0.6 }, { ms: 1000, tilt: 75 }); }
      }
      c.classList.toggle("small", small);
    }

    // ---- the flick: the ball shows everyone's heads, slowing down, and
    // lands on `target` exactly at SPIN_LAND_MS
    function flick(s, ids, target, elapsed) {
      const tok = ++spinTok;
      const steps = [];
      let t = 0, d = 70, i = Math.floor(Math.random() * ids.length);
      while (t + d < SPIN_LAND_MS - 120) { steps.push([t, ids[i++ % ids.length]]); t += d; d *= 1.17; }
      for (const [at, id] of steps) {
        if (at < elapsed) continue;
        setTimeout(() => { if (tok === spinTok) { face(s, id); sfx.cursor(); } }, at - elapsed);
      }
      face(s, steps.find(([at]) => at >= elapsed)?.[1] ?? target);
    }

    // ---- render ----
    function renderSQ(s) {
      // per-turn local state resets on every phone, keyed off the state
      const tk = `${s.ti}:${s.phase}`;
      if (tk !== lastTurn) { lastTurn = tk; if (s.phase !== "do") myVote = null; giveUpArmed = 0; }
      phaseNow = s.phase;
      hold(s.phase === "spin" || s.phase === "quest");
      const now = performance.now(); if (now - lastHud < 120) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const t = turn(s), who = s.players?.[t?.who]?.handle ?? "?";
      const step = s.phase === "end" ? "final" : s.phase === "setup" ? "setup" : `turn ${Math.min((s.ti ?? 0) + 1, s.turns || 1)}/${s.turns || "?"}`;
      ui.hud(`<div class="hq"><b>SIDE QUEST</b><span>${step}</span><span class="clk ${s.left < 10000 && !["end", "setup"].includes(s.phase) ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${me?.score ?? 0} pts</span></div>`);
      // start rendering everyone's head now, so the ball has them in time
      for (const p of P) if (!p.gone) lookOf(s, p.id);

      if (s.phase === "setup") {
        const isHost = ctx.isHost();
        const off = new Set(s.setup?.off ?? []);
        const n = active(s).length, turns = s.setup?.turns ?? n;
        if (!isHost) {
          // he waits in his back room
          if (scene({ ti: "setup" })) { orb("idle"); pose("idle"); push(0); }
          line("setup", T.wait);
          return;
        }
        if (!ui.once(`su:${[...off].sort().join(",")}:${turns}:${[...openCats].join(",")}:${n}`, () => {})) return;
        sceneTi = null;
        const on = AVAIL.filter(q => !off.has(q.id)).length;
        ui.stage("choose the quests", `
          <div class="sq-setup">
            <button type="button" class="pt-btn pt-primary sq-go" id="sq-go" ${on ? "" : "disabled"}>start · ${on} quest${on === 1 ? "" : "s"}</button>
            <div class="sq-turns"><span>turns</span>
              <button type="button" class="sq-step" data-turns="${turns - 1}" ${turns <= 1 ? "disabled" : ""}>−</button>
              <b>${turns}</b>
              <button type="button" class="sq-step" data-turns="${turns + 1}" ${turns >= SIDEQUEST.MAX_TURNS ? "disabled" : ""}>+</button>
              <small>${s.setup?.turns == null || turns === n ? "everyone once" : `${n} players`}</small></div>
            ${cats.map(c => {
              const qs = AVAIL.filter(q => q.category === c.id), k = qs.filter(q => !off.has(q.id)).length, open = openCats.has(c.id);
              return `<section class="sq-cat ${k ? "" : "off"}">
                <header><button type="button" class="sq-chk ${k === qs.length ? "on" : k ? "some" : ""}" data-cat="${esc(c.id)}" aria-label="all ${esc(c.label)} quests"></button>
                  <button type="button" class="sq-cat-name" data-open="${esc(c.id)}"><b>${esc(c.label)}</b><small>${k}/${qs.length} · ${esc(c.hint ?? "")}</small><i>${open ? "▴" : "▾"}</i></button></header>
                ${open ? `<ul>${qs.map(q => `<li><button type="button" class="sq-q ${off.has(q.id) ? "" : "on"}" data-q="${esc(q.id)}"><i class="sq-chk-s"></i><span>${esc(q.text)}</span>${q.level !== "mild" ? `<em class="sq-lv ${esc(q.level)}">${esc(q.level)}</em>` : ""}</button></li>`).join("")}</ul>` : ""}
              </section>`;
            }).join("")}
            ${meta?.settings?.adult ? "" : `<p class="ab-sub">unhinged quests appear when the party allows 18+</p>`}
          </div>`, "the Prophet's list");
        const panelEl = $("game-panel");
        $("sq-go").onclick = () => { sfx.confirm(); game.input("sq-go"); };
        panelEl.querySelectorAll("[data-turns]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("sq-turns", { n: +b.dataset.turns }); });
        panelEl.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("sq-cat", { cat: b.dataset.cat, on: !b.classList.contains("on") }); });
        panelEl.querySelectorAll("[data-open]").forEach(b => b.onclick = () => { const id = b.dataset.open; if (openCats.has(id)) openCats.delete(id); else openCats.add(id); sfx.cursor(); ui.resetKey(); });
        panelEl.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { sfx.cursor(); game.input("sq-q", { id: b.dataset.q, on: !b.classList.contains("on") }); });
        return;
      }

      if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        sceneTi = null; dlgKey = null;
        showResults(P, { title: "Side Quest", sub: "final scores", note: `average stars × ${PPS} per quest · give up = 0` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
        return;
      }
      if (!t) return;

      const fresh = scene(s);
      const pk = `${s.ti}:${s.phase}`;
      const name = s.players?.[t.who]?.handle ?? "you";

      if (s.phase === "spin") {
        // 1. who. Anticipation: he leans in, hands over the ball, the camera
        // pushes in, and he starts his line. Action: heads flick past in the
        // ball, slowing. Hold: it lands on them and he points: "...[name]."
        const elapsed = SPIN_MS - s.left;
        if (fresh || uiKey !== pk) {
          panel(pk, "");
          pose("reveal"); orb("spin"); push(1);
          const ids = P.filter(p => !p.gone).map(p => p.id);
          if (elapsed < SPIN_LAND_MS) { flick(s, ids.length ? ids : [t.who], t.who, elapsed); line(pk, T.relax, { late: elapsed > 1800 }); }
        }
        beats.at("land", pk, SPIN_LAND_MS, elapsed, late => {
          spinTok++;
          face(s, t.who, !late);
          orb("landed");
          pose("point");
          line(`${pk}:who`, `${T.relax} ${name}.`, { late, cont: true });
          if (!late) { sfx.chime(); if (t.who === ctx.me.id) buzz([60, 40, 120]); }
        });
        // the chosen head keeps resolving in while its render finishes
        if (elapsed >= SPIN_LAND_MS) face(s, t.who);

      } else if (s.phase === "quest") {
        // 2. what. Anticipation: hands back over the ball, it swirls hard.
        // Action: the ball flares and the card rises out of it. Hold: it
        // stays on screen for the rest of the turn while he reads it out.
        const elapsed = QUEST_MS - s.left;
        if (fresh || uiKey !== pk) {
          panel(pk, "");
          face(s, t.who);
          if (elapsed < SWIRL_MS) { pose("reveal"); orb("swirl"); push(1); }
          if (fresh) line(`${s.ti}:spin:who`, `${T.relax} ${name}.`, { late: true });
        }
        beats.at("rise", pk, SWIRL_MS, elapsed, late => {
          pose("reveal");
          orb("burst");
          card(t, { rise: !late });
          line(`${pk}:q`, T.quest(t.quest?.text ?? "…"), { late });
          if (!late) sfx.ping();
        });
        beats.at("settle", pk, SWIRL_MS + 1400, elapsed, () => { pose("idle"); orb("landed"); push(0); });

      } else if (s.phase === "do") {
        const mine = isMe(s);
        const held = t.votes[ctx.me.id] ?? myVote;
        if (fresh || uiKey === null || !String(uiKey).startsWith(pk)) { card(t); face(s, t.who); orb("landed"); pose("idle"); push(0); }
        const key = `${pk}:${t.status ?? "-"}:${mine ? 1 : 0}:${held ?? "-"}`;
        if (mine) {
          if (t.status) { line(`${pk}:gu`, T.youGaveUp); noChoices(); panel(key, ""); }
          else {
            panel(key, `<div class="sq-clock" id="sq-clock">${ui.clock(s.left)}</div><p class="sq-note"><b id="sq-vcount"></b></p>`);
            // the quest (read out in the last phase), then Accept / Give up;
            // after Accept, just Give up (two taps)
            if (accepted !== s.ti) line(`${s.ti}:quest:q`, T.quest(t.quest?.text ?? "…"), { late: true });
            else line(`${pk}:go`, T.go);
            const gu = { label: giveUpArmed ? T.again : T.giveUp, value: "no", cls: `warn${giveUpArmed ? " armed" : ""}`, keep: true };
            choices(`${pk}:${accepted === s.ti ? "go" : "ask"}:${giveUpArmed ? 1 : 0}`,
              accepted === s.ti ? [gu] : [{ label: T.accept, value: "ok" }, gu],
              v => {
                if (v === "ok") { accepted = s.ti; giveUpArmed = 0; sfx.confirm(); buzz(30); lastHud = 0; renderSQ(game.s ?? s); return; }
                if (giveUpArmed && performance.now() - giveUpArmed < 3500) { game.input("giveup"); sfx.back(); giveUpArmed = 0; return; }
                giveUpArmed = performance.now(); sfx.cursor(); chKey = null; lastHud = 0; renderSQ(game.s ?? s);
                setTimeout(() => { if (giveUpArmed && performance.now() - giveUpArmed >= 3400) { giveUpArmed = 0; chKey = null; lastHud = 0; if (game.s) renderSQ(game.s); } }, 3500);
              });
          }
        } else if (t.status === "gaveup") {
          line(`${pk}:gu`, T.theyGaveUp(who)); noChoices(); panel(key, "");
        } else {
          panel(key, `<span class="sq-film">● REC</span><span class="sq-clock small" id="sq-clock">${ui.clock(s.left)}</span><p class="sq-note"><b id="sq-vcount"></b></p>`, "chip");
          if (held) { line(`${pk}:held`, T.locked(T.lbl[held - 1] ?? "")); noChoices(); }
          else {
            line(`${pk}:rate`, T.rate(who));
            choices(`${pk}:stars`, Array.from({ length: STARS }, (_, i) => ({ label: `★${i + 1}`, value: i + 1, cls: "sq-star" })), v => {
              if (myVote || t.votes[ctx.me.id] !== undefined) return;
              myVote = v; game.input("rate", { v }); sfx.pop(); buzz(20); lastHud = 0; renderSQ(game.s ?? s);
            }, { row: true });
          }
        }
        // the timer and the count tick in place (rebuilding would eat taps)
        const c = $("sq-clock");
        if (c) { c.textContent = ui.clock(s.left); c.classList.toggle("urgent", s.left < 30000); }
        const vc = $("sq-vcount");
        if (vc) vc.textContent = T.rated(Object.keys(t.votes).length, voters(s).length);

      } else if (s.phase === "result") {
        // 3. the verdict, and his smug nod to close the turn
        if (fresh || uiKey !== pk) {
          card(t, { small: true });
          face(s, t.who);
          noChoices(); push(0);
          const board = P.slice().sort((a, b) => b.score - a.score).map(p => `<li class="${p.id === t.who ? "me" : ""}"><b>${esc(p.handle)}</b><span>${p.score}</span></li>`).join("");
          if (t.skipped) {
            orb("dim"); pose("idle");
            line(pk, T.left(who));
            panel(pk, `<ol class="sq-board">${board}</ol>`);
          } else if (t.status === "gaveup") {
            orb("dim"); pose("nod");
            line(pk, T.zero);
            panel(pk, `<div class="sq-stamp">GAVE UP</div><div class="sq-pts on">+0</div><ol class="sq-board">${board}</ol>`);
          } else {
            const avg = Math.round((t.avg ?? 0) * 10) / 10;
            pose("nod");
            orb(t.pts ? "burst" : "landed");
            line(pk, t.n ? T.verdict(avg.toFixed(1), t.pts) : T.nobody);
            panel(pk, `${starsHtml(0, "fill")}
              <div class="sq-avg"><b id="sq-avg">0.0</b><span>/ ${STARS}</span> <em class="sq-pts" id="sq-pts">+${t.pts}</em></div>
              <p class="sq-note">${t.n ? `${t.n} rating${t.n === 1 ? "" : "s"} · avg × ${PPS}` : ""}</p>
              <ol class="sq-board">${board}</ol>`);
            // the dramatic bit: the stars fill to the average, the number counts up
            const st = $("sq-ui").querySelector(".sq-stars.fill"), av = $("sq-avg");
            requestAnimationFrame(() => requestAnimationFrame(() => { if (st) st.style.setProperty("--fill", `${(t.avg ?? 0) / STARS * 100}%`); }));
            const t0 = performance.now();
            const up = n => { const k = Math.min(1, (n - t0) / 1600); if (av) av.textContent = (avg * k).toFixed(1); if (k < 1) requestAnimationFrame(up); else { $("sq-pts")?.classList.add("on"); if (t.pts) sfx.chime(); } };
            requestAnimationFrame(up);
          }
        }
      }
    }

    trash.add(() => { spinTok++; game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "setup", left: SETUP_MS, players: {}, setup: { off: [], turns: null, go: false }, weights: {}, deck: [], used: [], ti: 0, turns: 0, turn: null });
    const o = ctx.onEnd;
    ctx.onEnd = r => { spinTok++; game.stop(); ui.hide(); o(r); };
  },
};
