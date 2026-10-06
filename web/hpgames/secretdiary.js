// Secret Diary (3+) — house party game 1.
//
// A game is ROUNDS rounds; each round is ONE prompt from the editable pool in
// web/data/diary_prompts.json. Two round types:
//
//   written — everyone writes a short anonymous answer; all answers appear at
//             once, unattributed, in random order; everyone privately matches
//             answers to players. Score = correct matches.
//   yes/no  — everyone secretly taps yes or no; only the COUNT is revealed;
//             everyone privately picks who they think said yes. Score = one
//             point per person read right (picked & said yes, or left & said no).
//
// Nothing about any individual is ever revealed: not who wrote what, not who
// said yes, not which of your guesses were right. Scores stay hidden until the
// final results screen, because a running score would let you subtract your
// way to which guess landed.
//
// Each round starts with a short preview only the host sees, with Skip. If
// the host does nothing it goes to everyone after PREVIEW_MS. Everything else
// is on timers that also end early once everyone's in, so nobody has to tap
// anything for the game to keep moving; a player who doesn't submit just
// doesn't score that round.
//
// Levels escalate (rounds 1-2 mild, 3-4 up to spicy, 5+ up to the host's max),
// roughly 1 round in 3 is yes/no, and no prompt repeats within a party
// session — shown or skipped (ctx.session carries the used set between games).
//
// Every prompt shown or skipped is logged (hplog.js) for later tuning.
//
// PRIVACY, honestly: "never revealed" is a UI promise. Rooms are broadcast
// channels and the host must know the answers to score, so the current
// round's answers are in the synced state and readable with devtools. They're
// wiped from the state as soon as the round is scored.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { DIARY } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, pick, shuffle, showResults, hostSkip, bindHostSkip, trash, tally } from "./../hpkit.js";
import { promptLog } from "./../hplog.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));
const ANSWER_MAX = 140;
const END_MS = 22000;
const LV = DIARY.LEVELS;
const rank = l => LV.indexOf(l);

// ---------------------------------------------------------------- the pool
// Loaded once, at import, relative to this module (works at / in production
// and under /web/ in the test harness). Every client loads it, so whoever
// ends up host can deal.
let POOL = null;
const poolReady = fetch(new URL(`../${DIARY.POOL_URL}`, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(j => {
    POOL = (j.prompts || []).filter(p => p && p.id && p.text && (p.type === "written" || p.type === "yesno") && LV.includes(p.level));
    return POOL;
  })
  .catch(e => { console.warn("[diary] couldn't load the prompt pool", e); POOL = []; return POOL; });
export const diaryPool = () => poolReady;

// ---------------------------------------------------------------- levels
// the host's max level for this party, with the defaults applied
export function maxLevelFor(meta = {}) {
  const vis = meta.privacy === "public" ? "public" : "private";
  let max = meta.settings?.diaryMax || DIARY.DEFAULT_MAX[vis];
  if (!LV.includes(max)) max = DIARY.DEFAULT_MAX[vis];
  if (max === "unhinged" && !meta.settings?.adult) max = "spicy";     // 18+ only
  return max;
}
// the escalation curve: the cap for round r, never above the host's max
export function capFor(round, max) {
  const step = DIARY.CURVE.find(c => round <= c.upTo) ?? DIARY.CURVE[DIARY.CURVE.length - 1];
  const cap = step.cap === "max" ? max : step.cap;
  return rank(cap) < rank(max) ? cap : max;
}
// the yes/no count, softened at the edges. Showing 0 exactly would reveal
// every answer, but showing 1 exactly while 0 is softened would ALSO reveal
// it (the soft wording would only ever mean 0). So 0-1 and all-or-all-but-one
// share the soft wording; anything in between is an exact count.
export function countLine(yes, of) {
  if (yes <= 1) return "nobody or almost nobody said yes";
  if (yes >= of - 1) return "everyone or almost everyone said yes";
  return `${yes} of ${of} said yes`;
}

const BOT_FILLER = ["no comment", "this one stays in the diary", "ask me again in an hour", "i plead the fifth", "too real, next", "honestly? everyone here"];

export const SECRET_DIARY = {
  id: "secretdiary", title: "Secret Diary",
  blurb: "anonymous answers and secret yes/no — guess who said what. nobody ever finds out.",
  minPlayers: 3, maxPlayers: 12, length: "~10 min",
  // shown under "up next" in the lobby
  describe: meta => `up to ${maxLevelFor(meta)}`,

  start(ctx) {
    // the pool is fetched at import; on the rare cold start, wait for it
    if (!POOL) { ui.show(); ui.stage("Secret Diary", `<p class="ab-sub">opening the diary…</p>`, "loading"); poolReady.then(() => this._start(ctx)); return; }
    this._start(ctx);
  },

  _start(ctx) {
    ui.show(); ui.theme("chill");
    const room = ctx.room;
    const session = ctx.session ?? (ctx.session = {});
    session.diaryUsed ??= new Set();

    // client-local
    let myText = null, myYN = null, myGuesses = {}, myLocked = false, lastHud = 0, lastRound = null;
    trash.add(() => { myText = null; myYN = null; myGuesses = {}; myLocked = false; });
    const resetLocal = () => { myText = null; myYN = null; myGuesses = {}; myLocked = false; };

    const answerers = s => Object.values(s.players).filter(p => p.answer !== null && p.answer !== undefined);
    const writersFor = (s, me) => answerers(s).filter(p => p.id !== me?.id);
    const authorOf = (s, eid) => Object.values(s.players).find(p => p.myEid === eid)?.id;
    const toMatch = (s, p) => (s.entries || []).filter(e => e.eid !== p?.myEid);
    // "submitted" for the guess phase: written = matched everything you can;
    // yes/no = tapped lock in
    const guessed = (s, p) => s.cur?.type === "yesno" ? !!p.locked : toMatch(s, p).every(e => p.guesses[e.eid]);

    const rounds = new Rounds([
      {
        name: "preview", ms: DIARY.PREVIEW_MS,
        next: s => s.cur ? "answer" : "end",
      },
      {
        name: "answer", ms: s => s.cur?.type === "yesno" ? DIARY.YESNO_MS : DIARY.WRITE_MS,
        enter: s => {
          s.startedAt = Date.now();
          for (const p of Object.values(s.players)) { p.answer = null; p.at = null; p.myEid = null; p.guesses = {}; p.locked = false; }
          s.entries = []; s.countLabel = null;
        },
        done: s => active(s).every(p => p.answer !== null),
        // collect HERE, not in an exit hook: Rounds evaluates next() before it
        // runs exit(), and the "enough answers?" check needs the collected set
        next: s => { collect(s); return enough(s) ? "reveal" : finishRound(s); },
      },
      {
        name: "reveal",
        ms: s => s.cur?.type === "yesno" ? 5000 : Math.max(8000, Math.min(20000, 5000 + 1200 * (s.entries?.length ?? 0))),
        next: () => "guess",
      },
      {
        name: "guess", ms: DIARY.GUESS_MS,
        done: s => active(s).every(p => guessed(s, p)),
        next: s => { score(s); return finishRound(s); },
      },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "answer") { sfx.ping(); buzz(30); }
        if (name === "reveal") { sfx.chime(); buzz(40); }
        if (name === "guess") sfx.tick();
        if (name === "end") sfx.win();
      },
    });

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true);
        const meta = ctx.party ?? {};
        s.visibility = meta.privacy === "public" ? "public" : "private";
        s.maxLevel = maxLevelFor(meta);
        s.gameId = Math.random().toString(36).slice(2, 10);
        s.totalRounds = DIARY.ROUNDS;
        // one yes/no slot per block of YESNO_EVERY rounds, at a random spot
        s.yesnoSlots = [];
        for (let b = 0; b * DIARY.YESNO_EVERY < s.totalRounds; b++) {
          const slot = b * DIARY.YESNO_EVERY + 1 + Math.floor(game.rng() * DIARY.YESNO_EVERY);
          if (slot <= s.totalRounds) s.yesnoSlots.push(slot);
        }
        s.used = []; s.skipped = [];
        s.round = 1; s.entries = []; s.countLabel = null; s.why = null;
        s.cur = dealPrompt(s);
        if (!s.cur) s.why = "no prompts left at this level — raise the max level or start a new party";
        rounds.enter(s, s.cur ? "preview" : "end");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        if (s.phase === "answer") botsAnswer(s, dt);
        if (s.phase === "guess") botsGuess(s, dt);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }   // "send it now" / skip ahead
        // the host bins the previewed prompt and gets another
        if (m.in === "skipPrompt" && m.from === room.hostId && s.phase === "preview" && s.cur) {
          logPrompt(s, s.cur, { skipped: true });
          s.skipped.push(s.cur.id);
          s.cur = dealPrompt(s);
          if (!s.cur) { s.why = "ran out of prompts at this level"; rounds.enter(s, "end"); return; }
          s.left = DIARY.PREVIEW_MS;
          return;
        }
        const p = s.players[m.from];
        if (!p) return;
        if (m.in === "answer" && s.phase === "answer" && p.answer === null) {
          if (s.cur.type === "written") {
            const t = String(m.text ?? "").trim().slice(0, ANSWER_MAX);
            if (t) { p.answer = t; p.at = Date.now(); }
          } else if (m.yn === "yes" || m.yn === "no") { p.answer = m.yn; p.at = Date.now(); }
        }
        if (m.in === "guess" && s.phase === "guess" && s.cur.type === "written") {
          const e = (s.entries || []).find(x => x.eid === m.eid);
          const w = s.players[m.who];
          if (e && e.eid !== p.myEid && w && w.id !== p.id && w.answer !== null) p.guesses[m.eid] = w.id;
        }
        if (m.in === "pickyes" && s.phase === "guess" && s.cur.type === "yesno" && !p.locked) {
          const w = s.players[m.who];
          if (w && w.id !== p.id && w.answer !== null) { if (m.on) p.guesses[w.id] = true; else delete p.guesses[w.id]; }
        }
        if (m.in === "lock" && s.phase === "guess" && s.cur.type === "yesno") p.locked = true;
      },
      render(s) { renderSD(s); },
      onEvent() {},
    }, { hz: 3 });

    const seat = (id, handle, isBot) => ({ id, handle, isBot, gone: false, score: 0, answer: null, at: null, myEid: null, guesses: {}, locked: false });

    // ---- host: dealing ----
    // pick the next prompt for s.round: within the escalation cap, honouring
    // the yes/no slots, never anything used or skipped this session
    function dealPrompt(s) {
      const used = new Set([...session.diaryUsed, ...s.used, ...s.skipped]);
      const cap = capFor(s.round, s.maxLevel);
      const wantYN = s.yesnoSlots.includes(s.round);
      const avail = type => POOL.filter(p => p.type === type && rank(p.level) <= rank(cap) && !used.has(p.id));
      // yes/no slot: yes/no if any is available, else written. Written slot:
      // written, falling back to yes/no only if written has run dry.
      for (const type of wantYN ? ["yesno", "written"] : ["written", "yesno"]) {
        const c = avail(type);
        if (!c.length) continue;
        const atCap = c.filter(p => p.level === cap);
        const list = atCap.length && game.rng() < DIARY.CAP_BIAS ? atCap : c;
        const p = pick(game.rng, list);
        return { id: p.id, text: p.text, type: p.type, level: p.level };
      }
      return null;
    }
    // a round is playable with at least two answers — otherwise there's
    // nothing to match or guess, and it moves straight on
    const enough = s => s.cur?.type === "yesno" ? answerers(s).length >= 2 : (s.entries?.length ?? 0) >= 2;

    // close the answer window: written answers become anonymous entries (ids
    // assigned after the shuffle); yes/no becomes a softened count
    function collect(s) {
      const A = shuffle(game.rng, answerers(s));
      if (s.cur.type === "written") {
        s.entries = A.map((p, i) => ({ eid: `e${s.round}-${i}`, text: p.answer }));
        A.forEach((p, i) => { p.myEid = `e${s.round}-${i}`; });
      } else {
        s.countLabel = countLine(A.filter(p => p.answer === "yes").length, A.length);
        s.countOf = A.length;
      }
    }

    function score(s) {
      if (s.cur.type === "written") {
        for (const p of Object.values(s.players))
          for (const e of toMatch(s, p)) if (p.guesses[e.eid] && p.guesses[e.eid] === authorOf(s, e.eid)) p.score++;
      } else {
        for (const p of Object.values(s.players)) {
          // a player who never touched the guessing is skipped, not scored
          if (!p.locked && !Object.keys(p.guesses).length) continue;
          for (const q of answerers(s)) if (q.id !== p.id && !!p.guesses[q.id] === (q.answer === "yes")) p.score++;
        }
      }
    }

    // log, wipe the round's answers out of the state, deal the next round
    function finishRound(s) {
      logPrompt(s, s.cur, { skipped: false });
      s.used.push(s.cur.id);
      for (const p of Object.values(s.players)) { p.answer = null; p.myEid = null; p.guesses = {}; p.locked = false; p.at = null; }
      s.entries = []; s.countLabel = null;
      if (s.round >= s.totalRounds) return "end";
      s.round++;
      s.cur = dealPrompt(s);
      if (!s.cur) { s.why = "ran out of prompts at this level — raise the max level or start a new party"; return "end"; }
      return "preview";
    }

    // logging: one row per prompt shown or skipped. Aggregates use human
    // players only; bot seats are counted separately so they can be filtered.
    function logPrompt(s, cur, { skipped }) {
      const humans = Object.values(s.players).filter(p => !p.isBot);
      const ans = humans.filter(p => p.answer !== null && p.at !== null);
      const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      const avgMs = skipped ? null : mean(ans.map(p => p.at - (s.startedAt ?? p.at)));
      const avgLen = skipped || cur.type !== "written" ? null : mean(ans.map(p => String(p.answer).length));
      promptLog.log({
        prompt_id: cur.id, level: cur.level, type: cur.type,
        party_size: humans.length, bots: Object.values(s.players).length - humans.length,
        visibility: s.visibility, skipped, round: s.round,
        answered: skipped ? null : ans.length,
        avg_submit_ms: avgMs === null ? null : Math.round(avgMs),
        avg_answer_len: avgLen === null ? null : Math.round(avgLen * 10) / 10,
        game_id: s.gameId,
      });
    }

    function botsAnswer(s, dt) {
      const others = Object.values(s.players).map(p => p.handle);
      for (const p of Object.values(s.players)) {
        if (!p.isBot || p.answer !== null) continue;
        if (game.rng() < dt * (s.cur.type === "yesno" ? 0.5 : 0.3)) {
          p.answer = s.cur.type === "yesno" ? (game.rng() < 0.4 ? "yes" : "no")
            : (game.rng() < 0.5 ? pick(game.rng, others.filter(h => h !== p.handle)) : pick(game.rng, BOT_FILLER));
          p.at = Date.now();
        }
      }
    }
    function botsGuess(s, dt) {
      for (const p of Object.values(s.players)) {
        if (!p.isBot || guessed(s, p) || game.rng() > dt * 0.4) continue;
        if (s.cur.type === "written") {
          const ws = writersFor(s, p).map(w => w.id);
          for (const e of toMatch(s, p)) if (!p.guesses[e.eid] && ws.length) p.guesses[e.eid] = pick(game.rng, ws);
        } else {
          for (const q of writersFor(s, p)) if (game.rng() < 0.4) p.guesses[q.id] = true;
          p.locked = true;
        }
      }
    }

    // ---- render (everyone) ----
    const levelPill = l => `<span class="sd-level ${l}">${l}</span>`;
    const typePill = t => `<span class="sd-type">${t === "yesno" ? "yes or no" : "written"}</span>`;
    function renderSD(s) {
      // every client remembers what's been used, so no repeats in this
      // party session even if someone else hosts the next game
      for (const id of [...(s.used ?? []), ...(s.skipped ?? [])]) session.diaryUsed.add(id);
      // per-round local state resets HERE, on every phone. (Rounds' onPhase
      // only runs on the host, so resetting there left guests showing
      // "locked in" on a round they hadn't answered.)
      const rk = `${s.round}:${s.cur?.id ?? "-"}`;
      if (rk !== lastRound) { lastRound = rk; resetLocal(); }
      const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const isHost = ctx.isHost();
      const label = { preview: "next up", answer: s.cur?.type === "yesno" ? "yes or no" : "writing", reveal: "reveal", guess: s.cur?.type === "yesno" ? "who said yes?" : "matching", end: "final" }[s.phase] ?? "";
      ui.hud(`<div class="hq"><b>SECRET DIARY</b><span>${s.phase === "end" ? "" : `round ${s.round ?? 1}/${s.totalRounds ?? DIARY.ROUNDS}`}</span><span>${label}</span><span class="clk ${s.left < 8000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span></div>`);
      const cur = s.cur;
      const promptCard = () => `<div class="sd-prompt ${cur.type}"><div class="sd-pills">${typePill(cur.type)}${levelPill(cur.level)}</div>${esc(cur.text)}</div>`;

      if (s.phase === "preview") {
        if (!ui.once(`pv:${s.round}:${cur?.id}:${isHost ? 1 : 0}`, () => {})) {
          const c = $("sd-cd"); if (c) c.textContent = Math.max(0, Math.ceil(s.left / 1000));
          return;
        }
        if (isHost && cur) {
          ui.stage(`round ${s.round} of ${s.totalRounds}`, promptCard()
            + `<p class="ab-sub">only you can see this. goes to everyone in <b id="sd-cd">${Math.ceil(s.left / 1000)}</b>s</p>
            <div class="sd-preview-btns">
              <button type="button" class="pt-btn" id="sd-skip">skip this one</button>
              <button type="button" class="pt-btn pt-primary" id="sd-send">send it now</button>
            </div>`, "host preview");
          $("sd-skip").onclick = () => { game.input("skipPrompt"); sfx.tick(); ui.resetKey(); };
          $("sd-send").onclick = () => { game.input("skip"); sfx.pop(); };
        } else {
          ui.stage(`round ${s.round} of ${s.totalRounds}`, `<div class="sd-incoming">next prompt incoming…</div>`, "get ready");
        }

      } else if (s.phase === "answer") {
        const mine = me?.answer ?? (cur.type === "yesno" ? myYN : myText);
        // the "N answered" count is patched in place, never part of the key:
        // someone else answering must not rebuild a half-typed answer away
        if (!ui.once(`a:${s.round}:${mine ? 1 : 0}`, () => {})) { const t = $("sd-tally"); if (t) t.textContent = tally(s, p => p.answer !== null); return; }
        const tl = `<span id="sd-tally">${tally(s, p => p.answer !== null)}</span> answered`;
        if (mine) {
          ui.stage("locked in", promptCard() + `<p class="ab-sub">${tl} · waiting on the rest — it moves on by itself</p>${hostSkip(ctx)}`, `${label} · ${ui.clock(s.left)}`);
        } else if (cur.type === "written") {
          ui.stage("write it", promptCard()
            + ui.prompt("a few words…", text => { myText = text; game.input("answer", { text }); sfx.pop(); ui.resetKey(); }, { maxlength: ANSWER_MAX, submitLabel: "lock in" })
            + `<p class="ab-sub">nobody will ever see your name next to this · ${tl}</p>${hostSkip(ctx)}`, `writing · ${ui.clock(s.left)}`);
        } else {
          ui.stage("yes or no?", promptCard()
            + `<div class="sd-yn"><button type="button" class="yes" data-yn="yes">yes</button><button type="button" class="no" data-yn="no">no</button></div>
            <p class="ab-sub">secret — only the total is ever shown · ${tl}</p>${hostSkip(ctx)}`, `tap · ${ui.clock(s.left)}`);
          $("game-panel").querySelectorAll("[data-yn]").forEach(b => b.onclick = () => { myYN = b.dataset.yn; game.input("answer", { yn: b.dataset.yn }); sfx.pop(); buzz(20); ui.resetKey(); });
        }
        bindHostSkip(game);

      } else if (s.phase === "reveal") {
        if (!ui.once(`r:${s.round}`, () => {})) return;
        if (cur.type === "written") {
          ui.stage(`${s.entries.length} answers`, promptCard() + s.entries.map(e => `<div class="sd-entry">${esc(e.text)}</div>`).join("")
            + `<p class="ab-sub">unsigned, in random order — read them out loud</p>${hostSkip(ctx)}`, "reveal");
        } else {
          ui.stage("the count", promptCard() + `<div class="sd-count">${esc(s.countLabel ?? "")}</div>
            <p class="ab-sub">${s.countOf} answered · now guess who</p>${hostSkip(ctx)}`, "reveal");
        }
        bindHostSkip(game);

      } else if (s.phase === "guess") {
        const cands = writersFor(s, me);
        if (cur.type === "written") {
          const g = eid => myGuesses[eid] ?? me?.guesses?.[eid] ?? null;
          const todo = toMatch(s, me);
          const n = todo.filter(e => g(e.eid)).length;
          if (!ui.once(`g:${s.round}:${n}:${JSON.stringify(myGuesses)}`, () => {})) return;
          const used = new Set(todo.map(e => g(e.eid)).filter(Boolean));
          const rows = s.entries.map(e => {
            if (e.eid === me?.myEid) return `<div class="sd-match"><div class="sd-entry">${esc(e.text)}</div><div class="pt-note">yours</div></div>`;
            const cur = g(e.eid);
            return `<div class="sd-match"><div class="sd-entry">${esc(e.text)}</div>
              <div class="sd-who">${cands.map(p => `<button type="button" class="${cur === p.id ? "on" : ""} ${cur !== p.id && used.has(p.id) ? "used" : ""}" data-eid="${e.eid}" data-who="${esc(p.id)}">${esc(p.handle)}</button>`).join("")}</div></div>`;
          }).join("");
          ui.stage("who wrote which?", `<div class="sd-prompt small ${cur.type}">${esc(cur.text)}</div>` + rows
            + `<p class="ab-sub">${n}/${todo.length} matched · you'll only ever see your total, at the end</p>${hostSkip(ctx)}`, `matching · ${ui.clock(s.left)}`);
          $("game-panel").querySelectorAll("[data-eid]").forEach(b => b.onclick = () => {
            myGuesses[b.dataset.eid] = b.dataset.who; game.input("guess", { eid: b.dataset.eid, who: b.dataset.who }); sfx.tick(); ui.resetKey();
          });
        } else {
          const locked = myLocked || !!me?.locked;
          const picked = id => (id in myGuesses) ? myGuesses[id] : !!me?.guesses?.[id];
          if (!ui.once(`y:${s.round}:${locked ? 1 : 0}:${JSON.stringify(myGuesses)}`, () => {})) return;
          ui.stage("who said yes?", `<div class="sd-prompt small ${cur.type}">${esc(cur.text)}</div><div class="sd-count small">${esc(s.countLabel ?? "")}</div>
            <div class="sd-who sd-yn-pick">${cands.map(p => `<button type="button" class="${picked(p.id) ? "on" : ""}" data-pick="${esc(p.id)}" ${locked ? "disabled" : ""}>${esc(p.handle)}</button>`).join("")}</div>
            ${locked ? `<p class="ab-sub">locked in — waiting on the others</p>` : `<button type="button" class="pt-btn pt-primary" id="sd-lock">lock in</button>`}
            <p class="ab-sub">tap everyone you think said yes. a point for every person you read right — yes or no. you'll only see your total, at the end.</p>${hostSkip(ctx)}`, `guessing · ${ui.clock(s.left)}`);
          if (!locked) {
            $("game-panel").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
              const id = b.dataset.pick, on = !picked(id);
              myGuesses[id] = on; game.input("pickyes", { who: id, on }); sfx.tick(); ui.resetKey();
            });
            $("sd-lock").onclick = () => { myLocked = true; game.input("lock"); sfx.pop(); ui.resetKey(); };
          }
        }
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        showResults(P, {
          title: "Secret Diary", sub: "final scores",
          note: s.why || "who wrote what, who said yes, and which guesses landed all stay secret — just the totals",
        }, `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every answer alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "preview", left: DIARY.PREVIEW_MS, players: {}, entries: [], round: 1, totalRounds: DIARY.ROUNDS, used: [], skipped: [], cur: null, why: null });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
