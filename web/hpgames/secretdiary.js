// Secret Diary (3+) — house party game 1.
//
// A game is ONE BATCH of questions from the editable pool in
// web/data/diary_prompts.json:
//
//   deal    — only the host sees it. The app deals BATCH cards (the host can
//             make it 3-8) and the host can swap any card for a fresh one.
//             Swapped cards don't come back this party session. Send, and
//             everyone gets the whole batch at once. (Sends by itself after
//             DEAL_MS so an idle host can't stall the room.)
//   answer  — everyone answers every question on one scrollable screen:
//             written = a short text, yes/no = two buttons. One Submit for
//             the lot. Ends when everyone's submitted or the clock runs out;
//             a question someone left blank is skipped for them, and every
//             answer they did give counts (each is saved as it's given, so a
//             player who drops or runs out of time keeps what they wrote).
//   reveal  — one question at a time, in batch order: one locked diary per
//             player who answered, shuffled, unlocked one by one.
//             written — the diaries open on the answers; everyone privately
//                       matches answers to players. A point per correct match.
//             yes/no  — the diaries open on YES / NO stamps and the count
//                       ("3 of 8 said yes", softened at the edges by
//                       countLine, which also blurs the stamps); everyone
//                       privately picks who they think said yes. A point per
//                       person read right (picked and said yes, or left out
//                       and said no), so picking everyone isn't a free win.
//             Ends when everyone's locked in or after GUESS_MS.
//   points  — after each question: everyone's points on it and the running
//             totals. Numbers only.
//   end     — total scores, avatars, the winner. The host can deal a new
//             batch from here.
//
// Diary colors are the deduction: when the batch is sent every player is
// dealt a color, unique in the room, kept for the writing diary and every
// reveal in the batch (s.colorOf). Follow a color from question to question
// and you can work out whose it is. Nothing on any screen ever pairs a color
// with a name, and the next batch reshuffles them.
//
// Nothing else about any individual is revealed: not who wrote what, not who
// said yes, not which guesses were right.
//
// Cards are dealt on an escalation curve by position (first ~40% mild, then
// up to spicy, then up to the host's max) and sorted mild -> spicy ->
// unhinged, so the reveal escalates. About 1 card in 3 is yes/no when there
// are yes/no prompts left at the level. No prompt repeats within a party
// session — sent or swapped (ctx.session carries the used set between games).
//
// Every prompt sent or swapped is logged (hplog.js) for later tuning.
//
// PRIVACY, honestly: "never revealed" is a UI promise. Rooms are broadcast
// channels and the host must know the answers to score, so answers are in
// the synced state and readable with devtools. Raw answers are dropped as
// soon as the answer window closes (only shuffled, unsigned entries plus the
// key the host scores with remain), and each question's key is wiped the
// moment it's scored.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { DIARY } from "./../hpconfig.js";
import { Rounds, syncGone, active, esc, pick, shuffle, showResults, hostSkip, bindHostSkip, trash, tally, avatarHtml } from "./../hpkit.js";
import { promptLog } from "./../hplog.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));
const ANSWER_MAX = 140;
const END_MS = 22000;
// one 10x10 path per diary shape (DIARY.SHAPES)
const SHAPE_PATHS = {
  circle: "M5 1a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z",
  star: "M5 .6l1.3 2.9 3.1.3-2.4 2 .8 3.1L5 7.3 2.2 8.9 3 5.8.6 3.8l3.1-.3Z",
  square: "M1.5 1.5h7v7h-7Z",
  triangle: "M5 1 9.2 8.6H.8Z",
  diamond: "M5 .6 9.4 5 5 9.4.6 5Z",
  plus: "M3.6 1h2.8v2.6H9v2.8H6.4V9H3.6V6.4H1V3.6h2.6Z",
  heart: "M5 9 1.3 5.2A2.3 2.3 0 0 1 5 2.4a2.3 2.3 0 0 1 3.7 2.8Z",
  flower: "M5 .8a2 2 0 0 1 2 2 2 2 0 1 1 0 4.4 2 2 0 1 1-4 0 2 2 0 1 1 0-4.4 2 2 0 0 1 2-2Z",
  bolt: "M6 .5 1.8 5.6h2.9L3.8 9.5 8.2 4.2H5.3Z",
  moon: "M6.5 1a4.2 4.2 0 1 0 2.6 7A3.4 3.4 0 0 1 6.5 1Z",
  ring: "M5 .8a4.2 4.2 0 1 1 0 8.4A4.2 4.2 0 0 1 5 .8Zm0 2.2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  cross: "M2 .6 5 3.6 8 .6 9.4 2 6.4 5l3 3L8 9.4l-3-3-3 3L.6 8l3-3-3-3Z",
};
const LV = DIARY.LEVELS;
const rank = l => LV.indexOf(l);
// written answers above this many candidates get a dropdown instead of chips
const CHIP_MAX = 6;

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
// the escalation curve: the cap for the card at position i (0-based) of a
// batch of n, never above the host's max
export function capAt(i, n, max) {
  const f = (i + 1) / n;
  const step = DIARY.CURVE.find(c => f <= c.upTo + 1e-9) ?? DIARY.CURVE[DIARY.CURVE.length - 1];
  const cap = step.cap === "max" ? max : step.cap;
  return rank(cap) < rank(max) ? cap : max;
}
// how many yes/no cards a batch of n aims for
export const yesnoTarget = n => Math.round(n * DIARY.YESNO_SHARE);
// the yes/no count, softened at the edges. Showing 0 exactly would reveal
// every answer, but showing 1 exactly while 0 is softened would ALSO reveal
// it (the soft wording would only ever mean 0). So 0-1 and all-or-all-but-one
// share the soft wording; anything in between is an exact count.
export function countLine(yes, of) {
  if (yes <= 1) return "nobody or almost nobody said yes";
  if (yes >= of - 1) return "everyone or almost everyone said yes";
  return `${yes} of ${of} said yes`;
}
// mild first, spicier later; stable, so equal levels keep their dealt order
const byLevel = cards => cards.map((c, i) => [c, i]).sort((a, b) => (rank(a[0].level) - rank(b[0].level)) || (a[1] - b[1])).map(x => x[0]);

// the 3D diaries load lazily: three.js and the models only when a diary is
// about to be drawn, and a failure just means CSS diaries instead
let diaryLibP = null;
const diaryLib = () => diaryLibP ??= import("../diary3d.js").catch(e => { console.warn("[diary] 3D diaries unavailable", e); return null; });
const diaryMode = () => diaryLib().then(m => m ? m.diaryMode() : { mode: "css", kit: null });
const reportFps = fps => diaryLib().then(m => m?.reportFps(fps));
// the reveal shelf shows up to 6 diaries; more are paged in even groups ([start, end) per page)
export const shelfPages = n => {
  const k = Math.max(1, Math.ceil(n / 6)), base = Math.floor(n / k), rem = n % k;
  const at = p => p * base + Math.min(p, rem);
  return Array.from({ length: k }, (_, p) => [at(p), at(p + 1)]);
};

const BOT_FILLER = ["no comment", "this one stays in the diary", "ask me again in an hour", "i plead the fifth", "too real, next", "honestly? everyone here"];

export const SECRET_DIARY = {
  id: "secretdiary", title: "Secret Diary",
  blurb: "the host deals a batch of questions, everyone answers in secret, then they're revealed one by one — guess who said what. nobody ever finds out.",
  minPlayers: 3, maxPlayers: 12, length: "~12 min",
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

    // ---- client-local state (every phone) ----
    // drafts survive re-renders; they're reset per game, never in a Rounds
    // hook (those only run on the host)
    let L = null;
    const freshLocal = gameId => ({ gameId, myColor: Math.floor(Math.random() * DIARY.COLORS.length), drafts: {}, yn: {}, submitted: false, flushed: false, timers: {}, qkey: null, guesses: {}, picks: {}, locked: false, popped: new Set(), page: 0, opened: new Set(), shelf: null, shelfToken: null, fx: [] });
    // the live diary shelf (a WebGL canvas) and its animation timers
    const dropShelf = l => { if (!l) return; l.shelfToken = null; l.fx.forEach(clearTimeout); l.fx = []; try { l.shelf?.destroy(); } catch {} l.shelf = null; };
    const local = s => { if (!L || L.gameId !== s.gameId) { if (L) { Object.values(L.timers).forEach(clearTimeout); dropShelf(L); } L = freshLocal(s.gameId); } return L; };
    trash.add(() => { if (L) { Object.values(L.timers).forEach(clearTimeout); dropShelf(L); } L = null; });
    let lastHud = 0;

    const guessMs = s => {
      const q = s.qs?.[s.qi];
      if (!q || s.batch[s.qi]?.type === "yesno") return DIARY.GUESS_MS;
      return Math.min(DIARY.GUESS_MS_MAX, DIARY.GUESS_MS + Math.max(0, q.entries.length - 6) * DIARY.GUESS_MS_PER_EXTRA);
    };
    const nextPlayable = (s, from) => { for (let k = from; k < (s.qs?.length ?? 0); k++) if (s.qs[k].playable) return k; return -1; };

    const rounds = new Rounds([
      {
        name: "deal", ms: DIARY.DEAL_MS,
        next: s => s.batch.length ? "answer" : "end",
      },
      {
        name: "answer", ms: s => DIARY.ANSWER_MS_PER_Q * s.batch.length,
        enter: s => {
          s.startedAt = Date.now();
          for (const c of s.batch) if (!s.used.includes(c.id)) s.used.push(c.id);
          for (const p of Object.values(s.players)) { p.answers = {}; p.at = {}; p.done = false; }
          // this batch's diary colors: one per player, no two alike
          s.colorOf = dealColors(Object.keys(s.players));
        },
        done: s => active(s).every(p => p.done),
        // collect HERE, not in an exit hook: Rounds evaluates next() before
        // it runs exit(), and which question comes first depends on it
        next: s => { collect(s); s.qi = nextPlayable(s, 0); if (s.qi < 0) { s.why ??= "not enough answers to reveal anything — nobody wins this one"; return "end"; } return "reveal"; },
      },
      {
        name: "reveal", ms: guessMs,
        enter: s => { for (const p of Object.values(s.players)) { p.guesses = {}; p.locked = false; } },
        done: s => active(s).every(p => p.locked),
        next: s => { score(s, s.qi); return "points"; },
      },
      // after every question: who earned how much, and the running totals.
      // Never which guesses were right. The host can tap through.
      {
        name: "points", ms: DIARY.POINTS_MS,
        next: s => { s.qi = nextPlayable(s, s.qi + 1); return s.qi < 0 ? "end" : "reveal"; },
      },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "answer") { sfx.ping(); buzz(30); }
        if (name === "reveal") { sfx.chime(); buzz(40); }
        if (name === "points") { sfx.pop(); buzz(20); }
        if (name === "end") sfx.win();
      },
    });

    const seat = (id, handle, isBot) => ({ id, handle, isBot, gone: false, score: 0, answers: {}, at: {}, done: false, guesses: {}, locked: false });

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
        s.used = []; s.swapped = [];
        s.batch = dealBatch(s, DIARY.BATCH);
        s.qs = []; s.keys = []; s.qi = -1; s.why = null; s.pts = null;
        if (!s.batch.length) s.why = "no questions left at this level — raise the max level or start a new party";
        rounds.enter(s, s.batch.length ? "deal" : "end");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        if (s.phase === "answer") botsAnswer(s, dt);
        if (s.phase === "reveal") botsGuess(s, dt);
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        const fromHost = m.from === room.hostId;
        if (m.in === "skip" && fromHost) { s.left = 0; return; }            // "send" / skip ahead
        if (s.phase === "deal" && fromHost) {
          if (m.in === "send") { s.left = 0; return; }
          if (m.in === "swap") { swapCard(s, +m.i); return; }
          if (m.in === "size") { resizeBatch(s, +m.n); return; }
        }
        const p = s.players[m.from];
        if (!p) return;
        if (s.phase === "answer" && !p.done) {
          const k = +m.k, c = s.batch[k];
          if (m.in === "ans" && c) {
            if (c.type === "written") {
              const t = String(m.text ?? "").trim().slice(0, ANSWER_MAX);
              if (t) { p.answers[k] = t; p.at[k] = Date.now(); } else { delete p.answers[k]; delete p.at[k]; }
            } else if (m.yn === "yes" || m.yn === "no") { p.answers[k] = m.yn; p.at[k] = Date.now(); }
          }
          if (m.in === "submit") p.done = true;
        }
        if (s.phase === "reveal" && !p.locked) {
          const q = s.qs[s.qi], key = s.keys[s.qi], c = s.batch[s.qi];
          if (!q || !key) return;
          if (m.in === "guess" && c.type === "written") {
            const author = key[m.eid];
            if (author && author !== p.id && q.cands.includes(m.who) && m.who !== p.id) p.guesses[m.eid] = m.who;
          }
          if (m.in === "pick" && c.type === "yesno" && q.cands.includes(m.who) && m.who !== p.id) {
            if (m.on) p.guesses[m.who] = true; else delete p.guesses[m.who];
          }
          if (m.in === "lock") p.locked = true;
        }
      },
      render(s) { renderSD(s); },
      onEvent() {},
    }, { hz: 3 });

    // ---- host: dealing ----
    const taken = s => new Set([...session.diaryUsed, ...s.used, ...s.swapped, ...(s.batch ?? []).map(c => c.id)]);
    const card = p => ({ id: p.id, text: p.text, type: p.type, level: p.level });
    // one card of `type` at or under `cap`, leaning toward the cap itself;
    // falls back to anything of the type up to the host's max, then to the
    // other type, so a thin pool still fills the batch
    function pickCard(s, type, cap, excl, sameLevel = null) {
      const other = type === "yesno" ? "written" : "yesno";
      const avail = (t, lv) => POOL.filter(p => p.type === t && rank(p.level) <= rank(lv) && !excl.has(p.id));
      const tries = [[type, cap], [type, s.maxLevel], [other, cap], [other, s.maxLevel]];
      for (const [t, lv] of tries) {
        const c = avail(t, lv);
        if (!c.length) continue;
        const want = sameLevel ?? lv;
        const at = c.filter(p => p.level === want);
        const list = at.length && (sameLevel || game.rng() < DIARY.CAP_BIAS) ? at : c;
        const p = pick(game.rng, list);
        excl.add(p.id);
        return card(p);
      }
      return null;
    }
    function dealBatch(s, n) {
      const excl = new Set([...session.diaryUsed, ...s.used, ...s.swapped]);
      const ynLeft = POOL.filter(p => p.type === "yesno" && rank(p.level) <= rank(s.maxLevel) && !excl.has(p.id)).length;
      const yn = Math.min(yesnoTarget(n), ynLeft);
      // spread the yes/no slots through the batch
      const ynAt = new Set(Array.from({ length: yn }, (_, j) => Math.min(n - 1, Math.floor((j + 1) * n / (yn + 1)))));
      const out = [];
      for (let i = 0; i < n; i++) {
        const c = pickCard(s, ynAt.has(i) ? "yesno" : "written", capAt(i, n, s.maxLevel), excl);
        if (c) out.push(c);
      }
      return byLevel(out);
    }
    function swapCard(s, i) {
      const old = s.batch[i];
      if (!old) return;
      // same type, same level if there is one; pickCard widens from there
      const c = pickCard(s, old.type, old.level, taken(s), old.level);
      if (!c) return;                        // nothing left to swap in: keep it
      logPrompt(s, old, { skipped: true, pos: i + 1 });
      s.swapped.push(old.id);
      s.batch[i] = c;
      s.batch = byLevel(s.batch);
    }
    function resizeBatch(s, n) {
      n = Math.max(DIARY.BATCH_MIN, Math.min(DIARY.BATCH_MAX, n | 0));
      while (s.batch.length < n) {
        const ynNow = s.batch.filter(c => c.type === "yesno").length;
        const c = pickCard(s, ynNow < yesnoTarget(n) ? "yesno" : "written", capAt(s.batch.length, n, s.maxLevel), taken(s));
        if (!c) break;                       // the pool ran dry
        s.batch.push(c);
      }
      while (s.batch.length > n) {
        // keep about 1 in 3 yes/no: drop the last yes/no if there are too
        // many, otherwise the last written card. Dropped cards go back in
        // the pool — they were never sent.
        const ynNow = s.batch.filter(c => c.type === "yesno").length;
        const type = ynNow > yesnoTarget(n) ? "yesno" : "written";
        let j = s.batch.map(c => c.type).lastIndexOf(type);
        if (j < 0) j = s.batch.length - 1;
        s.batch.splice(j, 1);
      }
      s.batch = byLevel(s.batch);
    }

    // close the answer window: per question, written answers become
    // anonymous entries (ids assigned after the shuffle) and yes/no becomes a
    // softened count. The raw answers leave the state here; what stays is the
    // unsigned entries and a per-question key the host scores with.
    function collect(s) {
      s.qs = []; s.keys = [];
      s.batch.forEach((c, k) => {
        const A = shuffle(game.rng, Object.values(s.players).filter(p => p.answers[k] !== undefined));
        // one diary per answer, in its writer's color for this batch (the
        // list is aligned with the shuffled diaries, never keyed by player)
        const q = { cands: A.map(p => p.id).sort(), entries: [], countLabel: null, countOf: A.length, playable: false, colors: A.map(p => colorIdx(s, p.id)) };
        if (c.type === "written") {
          q.entries = A.map((p, i) => ({ eid: `q${k}e${i}`, text: p.answers[k] }));
          s.keys[k] = Object.fromEntries(A.map((p, i) => [`q${k}e${i}`, p.id]));
          q.playable = q.entries.length >= 2;
        } else {
          const yes = A.filter(p => p.answers[k] === "yes").length;
          q.countLabel = countLine(yes, A.length);
          // each diary opens on its writer's YES / NO stamp. When the count is
          // softened, the stamps would give the exact number away, so they're
          // never sent: everyone sees blurred stamps and the soft wording.
          q.soft = yes <= 1 || yes >= A.length - 1;          // exactly when countLine softens
          q.stamps = q.soft ? null : A.map(p => p.answers[k]);
          s.keys[k] = Object.fromEntries(A.map(p => [p.id, p.answers[k] === "yes"]));
          q.playable = A.length >= 2;
        }
        logPrompt(s, c, { skipped: false, pos: k + 1 });
        s.qs.push(q);
      });
      for (const p of Object.values(s.players)) { p.answers = {}; p.at = {}; }
    }

    // A batch's diary colors: a random palette index per player, no two alike
    // (the palette is as big as the party cap; desk-test bots past it wrap).
    // Nobody picks one, and nothing on screen pairs a color with a name.
    const dealColors = ids => {
      const deck = shuffle(game.rng, DIARY.COLORS.map((_, i) => i));
      return Object.fromEntries(shuffle(game.rng, ids).map((id, i) => [id, deck[i % deck.length]]));
    };
    const colorIdx = (s, id) => s.colorOf?.[id] ?? 0;

    function score(s, k) {
      const key = s.keys[k], c = s.batch[k];
      if (!key) return;
      const before = Object.fromEntries(Object.values(s.players).map(p => [p.id, p.score]));
      for (const p of Object.values(s.players)) {
        if (c.type === "written") {
          for (const [eid, who] of Object.entries(p.guesses)) if (key[eid] && key[eid] !== p.id && key[eid] === who) p.score++;
        } else {
          // a player who never touched the guessing is skipped, not scored
          if (!p.locked && !Object.keys(p.guesses).length) continue;
          for (const [id, saidYes] of Object.entries(key)) if (id !== p.id && !!p.guesses[id] === saidYes) p.score++;
        }
        p.guesses = {}; p.locked = false;
      }
      // what the points screen shows: each player's points on this question.
      // Only the number — never which guesses landed.
      s.pts = { qi: k, delta: Object.fromEntries(Object.values(s.players).map(p => [p.id, p.score - before[p.id]])) };
      // this question is done: nothing in the state ties anyone to it now
      s.keys[k] = null;
      s.qs[k] = { ...s.qs[k], entries: [], cands: [], colors: [], stamps: null, countLabel: null, scored: true };
    }

    // logging: one row per prompt sent or swapped. Aggregates use human
    // players only; bot seats are counted separately so they can be filtered.
    function logPrompt(s, c, { skipped, pos }) {
      const humans = Object.values(s.players).filter(p => !p.isBot);
      const ans = skipped ? [] : humans.filter(p => p.answers[pos - 1] !== undefined).map(p => ({ text: p.answers[pos - 1], at: p.at[pos - 1] }));
      const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      const avgMs = skipped ? null : mean(ans.map(a => a.at - (s.startedAt ?? a.at)));
      const avgLen = skipped || c.type !== "written" ? null : mean(ans.map(a => String(a.text).length));
      promptLog.log({
        prompt_id: c.id, level: c.level, type: c.type,
        party_size: humans.length, bots: Object.values(s.players).length - humans.length,
        visibility: s.visibility, skipped, round: pos,
        answered: skipped ? null : ans.length,
        avg_submit_ms: avgMs === null ? null : Math.round(avgMs),
        avg_answer_len: avgLen === null ? null : Math.round(avgLen * 10) / 10,
        game_id: s.gameId,
      });
    }

    function botsAnswer(s, dt) {
      const names = Object.values(s.players).map(p => p.handle);
      for (const p of Object.values(s.players)) {
        if (!p.isBot || p.done) continue;
        const open = s.batch.map((c, k) => k).filter(k => p.answers[k] === undefined);
        if (open.length && game.rng() < dt * 0.8) {
          const k = pick(game.rng, open), c = s.batch[k];
          p.answers[k] = c.type === "yesno" ? (game.rng() < 0.4 ? "yes" : "no")
            : (game.rng() < 0.5 ? pick(game.rng, names.filter(h => h !== p.handle)) : pick(game.rng, BOT_FILLER));
          p.at[k] = Date.now();
        }
        if (!open.length && game.rng() < dt * 0.5) p.done = true;
      }
    }
    function botsGuess(s, dt) {
      const q = s.qs[s.qi], key = s.keys[s.qi], c = s.batch[s.qi];
      if (!q || !key) return;
      for (const p of Object.values(s.players)) {
        if (!p.isBot || p.locked || game.rng() > dt * 0.4) continue;
        const cands = q.cands.filter(id => id !== p.id);
        if (c.type === "written") { for (const e of q.entries) if (key[e.eid] !== p.id && cands.length) p.guesses[e.eid] = pick(game.rng, cands); }
        else for (const id of cands) if (game.rng() < 0.4) p.guesses[id] = true;
        p.locked = true;
      }
    }

    // ---- render (everyone) ----
    const levelPill = l => `<span class="sd-level ${l}">${l}</span>`;
    const typePill = t => `<span class="sd-type">${t === "yesno" ? "yes or no" : "written"}</span>`;
    const pills = c => `<div class="sd-pills">${typePill(c.type)}${levelPill(c.level)}</div>`;
    // the shape that goes with a diary color (colorblind-safe second cue)
    const shape = c => { const n = DIARY.SHAPES[c] ?? DIARY.SHAPES[0]; return `<svg class="sd-sym" viewBox="0 0 10 10" aria-label="${n}" role="img"><path fill-rule="evenodd" d="${SHAPE_PATHS[n]}"/></svg>`; };
    const stamp = (v, cls = "") => v ? `<span class="sd-stamp ${v === "yes" ? "yes" : "no"} ${cls}">${v === "yes" ? "YES" : "NO"}</span>` : `<span class="sd-stamp blur ${cls}">?</span>`;
    const answeredCount = (s, l) => s.batch.filter((c, k) => c.type === "written" ? !!(l.drafts[k] ?? "").trim() : !!l.yn[k]).length;

    function sendDraft(l, k, now = false) {
      clearTimeout(l.timers[k]);
      const go = () => { delete l.timers[k]; game.input("ans", { k, text: l.drafts[k] ?? "" }); };
      if (now) go(); else l.timers[k] = setTimeout(go, 700);
    }
    function flushDrafts(s, l) {
      s.batch.forEach((c, k) => { if (c.type === "written" && l.drafts[k] !== undefined) sendDraft(l, k, true); });
    }

    function renderSD(s) {
      // every client remembers what's been used, so no repeats in this
      // party session even if someone else hosts the next game
      for (const id of [...(s.used ?? []), ...(s.swapped ?? [])]) session.diaryUsed.add(id);
      if (!s.gameId) return;
      const l = local(s);
      const me = s.players?.[ctx.me.id];
      const isHost = ctx.isHost();
      const n = s.batch?.length ?? 0;

      // last moments of the answer window: send whatever's typed, so a
      // half-finished batch still counts (input is still open until the end)
      if (s.phase === "answer" && me && !me.done && !l.flushed && s.left < 2500) { l.flushed = true; flushDrafts(s, l); }

      const now = performance.now();
      const hudDue = now - lastHud >= 150;
      if (hudDue) {
        lastHud = now;
        const where = { deal: "dealing", answer: `${n} questions`, reveal: `question ${(s.qi ?? 0) + 1}/${n}`, points: `question ${(s.qi ?? 0) + 1}/${n}`, end: "" }[s.phase] ?? "";
        const label = { deal: "", answer: "answering", reveal: s.batch?.[s.qi]?.type === "yesno" ? "who said yes?" : "matching", points: "points", end: "final" }[s.phase] ?? "";
        ui.hud(`<div class="hq"><b>SECRET DIARY</b><span>${where}</span><span>${label}</span><span class="clk ${s.left < 8000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span></div>`);
      }

      if (s.phase !== "reveal" && l.shelf) dropShelf(l);
      if (s.phase === "deal") renderDeal(s, isHost);
      else if (s.phase === "answer") renderAnswer(s, l, me);
      else if (s.phase === "reveal") renderReveal(s, l, me);
      else if (s.phase === "points") renderPoints(s, l);
      else if (s.phase === "end") {
        if (!ui.once(`end:${s.gameId}`, () => {})) return;
        const P = Object.values(s.players || {});
        const top = Math.max(0, ...P.map(p => p.score ?? 0));
        const winners = top > 0 ? P.filter(p => p.score === top).map(p => p.handle) : [];
        const sub = !winners.length ? "no winner this time" : winners.length === 1 ? `${winners[0]} wins` : `${winners.slice(0, -1).join(", ")} & ${winners.at(-1)} tie`;
        showResults(P, {
          title: "Secret Diary", sub,
          note: s.why || "who wrote what, who said yes, and which guesses landed all stay secret — just the totals",
        }, ctx.isHost()
          ? `<button type="button" class="pt-btn pt-primary" id="sd-again">deal a new batch ▶</button><p class="ab-sub">new colors, new questions · or back to the party in a moment</p>${hostSkip(ctx, "back to the party")}`
          : `<p class="ab-sub">back to the party in a moment</p>`);
        bindHostSkip(game);
        const again = $("sd-again");
        if (again) again.onclick = () => { again.disabled = true; sfx.pop(); ctx.again?.(); game.input("skip"); };
      }
    }

    // ---- after each question: points earned, running totals, a leaderboard
    // that ticks up and reshuffles. Only numbers: never which guesses landed.
    function renderPoints(s, l) {
      const pts = s.pts, k = pts?.qi ?? s.qi;
      const last = nextPlayable(s, k + 1) < 0;
      const left = Math.max(0, Math.ceil(s.left / 1000));
      if (!ui.once(`pts:${s.gameId}:${k}`, () => {})) { const c = $("sd-pts-cd"); if (c) c.textContent = left; return; }
      const delta = id => pts?.delta?.[id] ?? 0;
      const P = Object.values(s.players);
      const before = P.slice().sort((a, b) => (b.score - delta(b.id)) - (a.score - delta(a.id)) || a.handle.localeCompare(b.handle));
      const after = P.slice().sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
      const rows = before.map(p => `<li class="sd-pt-row" data-id="${esc(p.id)}">
          ${avatarHtml(p, { size: 40 })}
          <span class="sd-pt-name">${esc(p.handle)}${p.id === ctx.me.id ? ' <small>you</small>' : ""}${p.gone ? ' <small>left</small>' : ""}</span>
          <span class="sd-pt-delta ${delta(p.id) ? "" : "zero"}">+${delta(p.id)}</span>
          <b class="sd-pt-total" data-to="${p.score}">${p.score - delta(p.id)}</b></li>`).join("");
      const btn = ctx.isHost() ? `<button type="button" class="pt-btn pt-primary" id="sd-next">${last ? "see the results ▶" : "next question ▶"}</button>` : "";
      ui.stage(`after question ${k + 1}`, `<ol class="sd-pts" id="sd-pts">${rows}</ol>
        ${btn}<p class="ab-sub">just the points — which guesses landed stays secret · ${last ? "results" : "next question"} in <b id="sd-pts-cd">${left}</b>s</p>`, "points");
      const nb = $("sd-next");
      if (nb) nb.onclick = () => { game.input("skip"); sfx.pop(); nb.disabled = true; };
      // FLIP: the rows start in the old order, the totals tick up, then
      // everyone slides to their new place
      const list = $("sd-pts"); if (!list) return;
      const rowEls = [...list.children];
      const h = rowEls[0]?.getBoundingClientRect().height ?? 0, gap = 6;
      const at = new Map(after.map((p, i) => [p.id, i]));
      l.fx.push(setTimeout(() => {
        rowEls.forEach(el => {
          const tot = el.querySelector(".sd-pt-total"), to = +tot.dataset.to, from = +tot.textContent;
          if (to === from) return;
          el.classList.add("up");
          const t0 = performance.now(), dur = 700;
          const tick = now => { const x = Math.min(1, (now - t0) / dur); tot.textContent = Math.round(from + (to - from) * x); if (x < 1 && tot.isConnected) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
        });
        sfx.tick();
      }, 450));
      l.fx.push(setTimeout(() => {
        rowEls.forEach((el, i) => { const dy = ((at.get(el.dataset.id) ?? i) - i) * (h + gap); el.style.transform = dy ? `translateY(${dy}px)` : ""; });
      }, 1350));
    }

    function renderDeal(s, isHost) {
      const sig = `deal:${s.gameId}:${isHost ? 1 : room.hostId}:${s.batch.map(c => c.id).join(",")}`;
      if (!ui.once(sig, () => {})) { const c = $("sd-cd"); if (c) c.textContent = Math.max(0, Math.ceil(s.left / 1000)); return; }
      if (!isHost) {
        const host = s.players[room.hostId]?.handle ?? "the host";
        ui.stage("tonight's questions", `<div class="sd-incoming">${esc(host)} is picking the questions…</div>
          <p class="ab-sub">you'll get them all at once. nobody will ever see your name next to an answer.</p>`, "get ready");
        return;
      }
      const n = s.batch.length;
      const cards = s.batch.map((c, i) => `<div class="sd-card ${c.type}"><span class="sd-qn">${i + 1}</span>
          <div class="sd-ctext">${pills(c)}<div>${esc(c.text)}</div></div>
          <button type="button" class="sd-swap" data-swap="${i}" aria-label="swap card ${i + 1}">swap</button></div>`).join("");
      ui.stage("deal the questions", `<div class="sd-size"><span>questions</span>
          <button type="button" data-size="${n - 1}" ${n <= DIARY.BATCH_MIN ? "disabled" : ""} aria-label="fewer">−</button>
          <b id="sd-n">${n}</b>
          <button type="button" data-size="${n + 1}" ${n >= DIARY.BATCH_MAX ? "disabled" : ""} aria-label="more">+</button></div>
        <div class="sd-deck">${cards}</div>
        <button type="button" class="pt-btn pt-primary" id="sd-send">send to everyone ▶</button>
        <p class="ab-sub">only you can see these. swapped cards won't come back tonight · sends by itself in <b id="sd-cd">${Math.ceil(s.left / 1000)}</b>s</p>`, `host · ${s.maxLevel} max`);
      $("game-panel").querySelectorAll("[data-swap]").forEach(b => b.onclick = () => { game.input("swap", { i: +b.dataset.swap }); sfx.tick(); b.disabled = true; });
      $("game-panel").querySelectorAll("[data-size]").forEach(b => b.onclick = () => { game.input("size", { n: +b.dataset.size }); sfx.tick(); });
      $("sd-send").onclick = () => { game.input("send"); sfx.pop(); $("sd-send").disabled = true; };
    }

    function renderAnswer(s, l, me) {
      const done = !!me?.done || l.submitted;
      // keyed on MY state only: someone else answering must never rebuild a
      // half-typed answer away. Everyone else's progress is patched in place.
      if (!ui.once(`ans:${s.gameId}:${done ? 1 : 0}:${me ? 1 : 0}`, () => {})) {
        const t = $("sd-tally"); if (t) t.textContent = tally(s, p => p.done);
        if (ctx.isHost() && !$("hp-skip")) { $("sd-foot")?.insertAdjacentHTML("beforeend", hostSkip(ctx)); bindHostSkip(game); }
        return;
      }
      const tl = `<span id="sd-tally">${tally(s, p => p.done)}</span> done`;
      if (!me) {
        ui.stage("answering", `<p class="ab-sub">this batch started before you joined — you're in the next one. ${tl}</p>`, "watching");
        return;
      }
      if (done) {
        ui.stage("sent", `<p class="ab-sub">${answeredCount(s, l) || "your"} answer${answeredCount(s, l) === 1 ? "" : "s"} locked in · ${tl} · it moves on by itself</p>
          <div class="sd-incoming">waiting on the others…</div><div id="sd-foot">${hostSkip(ctx)}</div>`, "answers in");
        bindHostSkip(game);
        return;
      }
      const qs = s.batch.map((c, k) => {
        const field = c.type === "written"
          ? `<input class="sd-in" data-k="${k}" maxlength="${ANSWER_MAX}" placeholder="a few words…" autocomplete="off" autocapitalize="sentences" enterkeyhint="next" value="${esc(l.drafts[k] ?? "")}">`
          : `<div class="sd-ynpage" data-k="${k}"><div class="sd-stamp-slot" id="sd-slot-${k}">${l.yn[k] ? stamp(l.yn[k]) : `<span class="sd-stamp-hint">stamp your answer</span>`}</div>
              <div class="sd-yn small" data-k="${k}"><button type="button" class="yes ${l.yn[k] === "yes" ? "on" : ""}" data-yn="yes" data-k="${k}">yes</button><button type="button" class="no ${l.yn[k] === "no" ? "on" : ""}" data-yn="no" data-k="${k}">no</button></div></div>`;
        return `<div class="sd-q ${c.type}" data-q="${k}"><div class="sd-qhead"><span class="sd-qn">${k + 1}</span>${pills(c)}</div>
          <div class="sd-prompt ${c.type}">${esc(c.text)}</div>${field}</div>`;
      }).join("");
      const n = s.batch.length;
      // your diary: a random color on this phone only (never sent, never picked)
      // your diary is in your color for this batch (only you see it next to "your")
      const myC = s.colorOf?.[ctx.me.id] ?? l.myColor, myHex = DIARY.COLORS[myC];
      ui.stage(`answer all ${n}`, `<div class="sd-mydiary" id="sd-mydiary" style="--dc:${myHex}"><div class="sd-mydiary-vis"></div><span>your diary ${shape(myC)}</span><small>your color all batch · only you know it's yours</small></div>
        <p class="ab-sub">nobody will ever see your name next to an answer. yes/no stays secret — only the total is ever shown.</p>
        <div class="sd-batch">${qs}</div>
        <div class="sd-foot" id="sd-foot"><div class="sd-prog"><b id="sd-mine">${answeredCount(s, l)}/${n}</b> answered · ${tl}</div>
          <button type="button" class="pt-btn pt-primary" id="sd-submit">submit</button>${hostSkip(ctx)}</div>`, "in secret");
      // the submit bar sits on the bottom edge of the screen while you scroll
      $("game-panel").classList.add("sd-answering");
      // you write in your own diary: its cover color frames the page
      const st = $("game-panel").querySelector(".stage");
      st.classList.add("sd-writing"); st.style.setProperty("--dc", myHex);
      diaryMode().then(({ kit }) => {
        const v = $("game-panel").querySelector("#sd-mydiary .sd-mydiary-vis");
        if (!v) return;
        if (kit) { try { v.innerHTML = `<img alt="" src="${kit.snapshot("open", myHex, 200, 200)}">`; return; } catch (e) { console.warn("[diary]", e); } }
        v.innerHTML = `<i class="sd-copen"></i>`;
      });
      const prog = () => {
        const a = answeredCount(s, l);
        $("sd-mine").textContent = `${a}/${n}`;
        $("sd-submit").textContent = a === n || !a ? "submit" : `submit · ${n - a} left blank`;
      };
      prog();
      const ins = [...$("game-panel").querySelectorAll(".sd-in")];
      ins.forEach((el, j) => {
        const k = +el.dataset.k;
        el.oninput = () => { l.drafts[k] = el.value; prog(); sendDraft(l, k); };
        el.onchange = () => { l.drafts[k] = el.value; sendDraft(l, k, true); };
        el.onkeydown = e => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const nx = ins[j + 1];
          if (nx) nx.focus(); else el.blur();
        };
      });
      $("game-panel").querySelectorAll("[data-yn]").forEach(b => b.onclick = () => {
        const k = +b.dataset.k;
        l.yn[k] = b.dataset.yn;
        b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
        // thunk: YES / NO stamped on your diary page
        const slot = $(`sd-slot-${k}`); if (slot) slot.innerHTML = stamp(b.dataset.yn, "stamped");
        game.input("ans", { k, yn: b.dataset.yn }); sfx.pop(); buzz(15); prog();
      });
      $("sd-submit").onclick = () => {
        flushDrafts(s, l);
        l.submitted = true; game.input("submit"); sfx.pop(); buzz(25); ui.resetKey();
      };
      bindHostSkip(game);
    }

    function renderReveal(s, l, me) {
      const k = s.qi, c = s.batch[k], q = s.qs[k], key = s.keys[k];
      if (!c || !q || !key) return;
      const qkey = `${s.gameId}:${k}`;
      if (l.qkey !== qkey) { l.qkey = qkey; l.guesses = {}; l.picks = {}; l.locked = false; }
      const locked = l.locked || !!me?.locked || !me;
      if (!ui.once(`rv:${qkey}:${locked ? 1 : 0}`, () => {})) { const t = $("sd-tally"); if (t) t.textContent = tally(s, p => p.locked); return; }
      dropShelf(l);
      if (l.pageQ !== qkey) { l.pageQ = qkey; l.page = 0; l.opened = new Set(); }
      // animate the reveal only the first time each question is drawn
      const pop = !l.popped.has(qkey); l.popped.add(qkey);
      const written = c.type === "written";
      const myEid = written ? Object.keys(key).find(e => key[e] === me?.id) : null;
      const cands = q.cands.filter(id => id !== me?.id).map(id => s.players[id]).filter(Boolean);
      const hexOf = i => DIARY.COLORS[q.colors?.[i] ?? i % DIARY.COLORS.length];
      const head = `<div class="sd-qcount">question ${k + 1} of ${s.batch.length}</div>
        <div class="sd-prompt big ${c.type}">${pills(c)}${esc(c.text)}</div>`;
      const tl = `<span id="sd-tally">${tally(s, p => p.locked)}</span> locked in`;
      const after = "points after this question — never which guesses landed";
      const foot = locked
        ? `<p class="ab-sub sd-locked">${me ? "locked in" : "watching"} · ${tl} · ${after}</p>`
        : `<button type="button" class="pt-btn pt-primary" id="sd-lock">lock in</button><p class="ab-sub">${tl} · ${after}</p>`;
      const panel = () => $("game-panel");
      const unseal = () => panel()?.querySelectorAll(".sealed").forEach(el => el.classList.remove("sealed"));

      // one locked diary per answer, unlabeled and shuffled, a fresh color each
      let n, pages, cols, cellInner, onTap = null;
      const g = eid => l.guesses[eid] ?? me?.guesses?.[eid] ?? null;
      const pickUi = (e, cur, attr) => cands.length > CHIP_MAX
        ? `<select class="sd-sel" ${attr}="${e.eid}" ${locked ? "disabled" : ""}><option value="">who wrote this?</option>${cands.map(p => `<option value="${esc(p.id)}" ${cur === p.id ? "selected" : ""}>${esc(p.handle)}</option>`).join("")}</select>`
        : `<div class="sd-who">${cands.map(p => `<button type="button" class="${cur === p.id ? "on" : ""}" ${attr}="${e.eid}" data-who="${esc(p.id)}" ${locked ? "disabled" : ""}>${esc(p.handle)}</button>`).join("")}</div>`;
      let setGuess = null;

      if (written) {
        const todo = q.entries.filter(e => e.eid !== myEid);
        n = q.entries.length; pages = shelfPages(n);
        cols = count => count <= 3 ? count : Math.ceil(count / 2);
        cellInner = i => `<div class="sd-dtext"><span>${esc(q.entries[i].text)}</span></div>${q.entries[i].eid === myEid ? `<span class="sd-dyours">yours</span>` : ""}`;
        // matching list: one row per diary, keyed by its color and number
        const rows = q.entries.map((e, i) => {
          const sw = `<span class="sd-dsw" style="--dc:${hexOf(i)}">${shape(q.colors?.[i])}</span>`;
          if (e.eid === myEid) return `<div class="sd-match mine"><div class="sd-rowhead">${sw}<div class="sd-entry mine">${esc(e.text)}<span class="sd-mine">yours</span></div></div></div>`;
          return `<div class="sd-match"><div class="sd-rowhead">${sw}<div class="sd-entry">${esc(e.text)}</div></div>${pickUi(e, g(e.eid), "data-eid")}</div>`;
        }).join("");
        const pager = pages.length > 1 ? `<div class="sd-pager"><button type="button" id="sd-prev" aria-label="previous diaries">‹</button><span id="sd-pg"></span><button type="button" id="sd-next" aria-label="more diaries">›</button></div>` : "";
        ui.stage(`${n} diaries — who wrote which?`, head
          + `<div class="sd-shelf-wrap"><div class="sd-shelf" id="sd-shelf"></div>${pager}<p class="sd-hint">tap a diary to read it</p></div>`
          + `<div class="sd-matchlist ${l.opened.size ? "" : "sealed"}" id="sd-list">${rows}</div>`
          + `<div class="sd-prog"><b id="sd-matched">${todo.filter(e => g(e.eid)).length}/${todo.length}</b> matched</div>${foot}${hostSkip(ctx)}`, "unsigned · shuffled · same colors all batch");
        const P = panel();
        const used = () => { const u = new Set(todo.map(e => g(e.eid)).filter(Boolean)); P.querySelectorAll("[data-who]").forEach(b => b.classList.toggle("used", !b.classList.contains("on") && u.has(b.dataset.who))); };
        const prog = () => { const m = $("sd-matched"); if (m) m.textContent = `${todo.filter(e => g(e.eid)).length}/${todo.length}`; };
        setGuess = (eid, who) => {
          l.guesses[eid] = who;
          game.input("guess", { eid, who }); sfx.tick();
          P.querySelectorAll(`[data-eid="${eid}"][data-who], [data-zeid="${eid}"][data-who]`).forEach(x => x.classList.toggle("on", x.dataset.who === who));
          P.querySelectorAll(`select[data-eid="${eid}"], select[data-zeid="${eid}"]`).forEach(x => { x.value = who; });
          used(); prog();
        };
        used();
        if (!locked) {
          P.querySelectorAll("[data-eid][data-who]").forEach(b => b.onclick = () => setGuess(b.dataset.eid, b.dataset.who));
          P.querySelectorAll("select.sd-sel[data-eid]").forEach(sel => sel.onchange = () => { if (sel.value) setGuess(sel.dataset.eid, sel.value); });
        }
        onTap = i => zoom(i);
      } else {
        // yes/no: one diary per player who answered, opening on a YES or NO
        // stamp. All on one shelf, so "after every diary opens" is one moment.
        n = q.countOf; pages = [[0, n]];
        cols = count => count <= 3 ? count : count <= 8 ? Math.ceil(count / 2) : 4;
        cellInner = i => `<div class="sd-dstamp">${stamp(q.stamps?.[i] ?? null)}</div>`;
        const picked = id => (id in l.picks) ? l.picks[id] : !!me?.guesses?.[id];
        const sealed = l.opened.size ? "" : "sealed";
        ui.stage("who said yes?", head
          + `<div class="sd-shelf-wrap"><div class="sd-shelf yn" id="sd-shelf"></div></div>`
          + `<div class="sd-count ${sealed}" id="sd-count">${esc(q.countLabel ?? "")}</div>`
          + (q.soft ? `<p class="ab-sub sd-softnote ${sealed}">too close to all-or-nothing to show the stamps — just the rough count</p>` : "")
          + `<div class="sd-picks ${sealed}"><p class="ab-sub">tap everyone you think said yes. a point for every person you read right — yes or no.</p>
            <div class="sd-who sd-yn-pick">${cands.map(p => `<button type="button" class="${picked(p.id) ? "on" : ""}" data-pick="${esc(p.id)}" ${locked ? "disabled" : ""}>${esc(p.handle)}</button>`).join("")}</div></div>`
          + `${foot}${hostSkip(ctx)}`, "unsigned · shuffled · same colors all batch");
        if (!locked) panel().querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
          const id = b.dataset.pick, on = !picked(id);
          l.picks[id] = on; b.classList.toggle("on", on);
          game.input("pick", { who: id, on }); sfx.tick();
        });
      }

      // ---- the shelf: locked diaries, each unlocked once per phone
      const showPage = pg => {
        dropShelf(l);
        const token = {}; l.shelfToken = token; l.page = pg;
        const [a, b] = pages[pg];
        const shelf = $("sd-shelf"); if (!shelf) return;
        shelf.style.setProperty("--cols", cols(b - a));
        // a page this phone already unlocked redraws open, with no second unlock
        const already = l.opened.has(pg);
        shelf.classList.toggle("settled", already);
        shelf.innerHTML = Array.from({ length: b - a }, (_, j) => {
          const i = a + j;
          return `<button type="button" class="sd-dcell ${already ? "open" : ""}" data-i="${i}" style="--dc:${hexOf(i)}" aria-label="diary ${i + 1}">
            <div class="sd-dvis"></div>${cellInner(i)}<span class="sd-dnum" style="--dc:${hexOf(i)}">${shape(q.colors?.[i])}</span></button>`;
        }).join("");
        const pgEl = $("sd-pg"); if (pgEl) pgEl.textContent = `${pg + 1} / ${pages.length}`;
        const pv = $("sd-prev"), nx = $("sd-next");
        if (pv) { pv.disabled = pg === 0; pv.onclick = () => showPage(pg - 1); }
        if (nx) { nx.disabled = pg === pages.length - 1; nx.onclick = () => showPage(pg + 1); }
        const cells = [...shelf.querySelectorAll(".sd-dcell")].map(el => ({ el, hex: el.style.getPropertyValue("--dc").trim() }));
        if (onTap) cells.forEach(c => c.el.onclick = () => onTap(+c.el.dataset.i));
        const finish = () => {
          if (l.shelfToken !== token) return;
          const first = !l.opened.size;
          cells.forEach(c => c.el.classList.add("open"));
          l.opened.add(pg);
          if (first) { unseal(); if (!written && !already) { sfx.chime(); $("sd-count")?.classList.add("sd-pop"); } }
        };
        diaryMode().then(({ mode, kit }) => {
          if (l.shelfToken !== token || !shelf.isConnected) return;
          if (mode === "3d") {
            try { l.shelf = kit.shelf(shelf, cells); }
            catch (e) { console.warn("[diary] live shelf failed, using sprites", e); mode = "sprite"; }
          }
          shelf.dataset.mode = mode;
          if (mode === "3d") {
            if (already) { l.shelf.setOpen(); finish(); return; }
            l.fx.push(setTimeout(() => l.shelf?.unlock((i, st) => {
              if (st === "click") sfx.tick();
              if (st === "open") { cells[i]?.el.classList.add("open"); buzz(8); }
            }).then(() => { reportFps(l.shelf?.fps()); finish(); }), 700));
            // never leave the list sealed if animation frames stall (tab in the background)
            l.fx.push(setTimeout(finish, 700 + cells.length * 300 + 2500));
            return;
          }
          // sprite / css: same beat, drawn with images or CSS and animated in CSS
          cells.forEach(c => {
            const v = c.el.querySelector(".sd-dvis");
            if (mode === "sprite") {
              const sz = kit.lockSpot(120, 120);
              v.innerHTML = `<img class="sd-dclosed" alt="" src="${kit.snapshot("closed", c.hex, 120, 120)}"><img class="sd-dopen" alt="" src="${kit.snapshot("open", c.hex, 120, 120)}">`
                + `<img class="sd-dlock" alt="" src="${kit.snapshot("lock", null, 60, 60)}" style="left:${sz.x}%;top:${sz.y}%;width:${sz.w}%">`;
            } else v.innerHTML = `<i class="sd-cdiary"></i><i class="sd-copen"></i><i class="sd-clock"></i>`;
          });
          if (already) { finish(); return; }
          const U = { STAGGER: 300, SHAKE: 420, CLICK: 520, OPEN: 1150 };
          cells.forEach((c, i) => {
            const d = 700 + i * U.STAGGER;
            l.fx.push(setTimeout(() => c.el.classList.add("shake"), d));
            l.fx.push(setTimeout(() => { c.el.classList.add("click"); sfx.tick(); }, d + U.SHAKE));
            l.fx.push(setTimeout(() => c.el.classList.add("drop"), d + U.CLICK));
            l.fx.push(setTimeout(() => { c.el.classList.add("open"); buzz(8); }, d + U.OPEN));
          });
          l.fx.push(setTimeout(finish, 700 + (cells.length - 1) * U.STAGGER + 1400));
        });
      };
      // ---- written: tap a diary to read it big, and match it right there
      const zoom = i => {
        const e = q.entries[i]; if (!e) return;
        const P = panel();
        const cell = P.querySelector(`.sd-dcell[data-i="${i}"]`);
        if (cell && !cell.classList.contains("open")) return;          // still locked
        P.querySelector(".sd-zoom")?.remove();
        const hex = hexOf(i), mine = e.eid === myEid;
        const z = document.createElement("div");
        z.className = "sd-zoom";
        z.innerHTML = `<div class="sd-zcard" style="--dc:${hex}"><div class="sd-zvis"></div><div class="sd-ztext">${esc(e.text)}</div><span class="sd-dnum" style="--dc:${hex}">${shape(q.colors?.[i])}</span></div>
          ${mine ? `<p class="sd-hint">this one's yours</p>` : pickUi(e, g(e.eid), "data-zeid")}
          <button type="button" class="pt-btn sd-zclose">back to the shelf</button>`;
        P.querySelector(".stage").appendChild(z);
        diaryMode().then(({ kit }) => {
          const v = z.querySelector(".sd-zvis"); if (!v) return;
          v.innerHTML = kit ? `<img alt="" src="${kit.snapshot("open", hex, 300, 300)}">` : `<i class="sd-copen"></i>`;
        });
        z.querySelector(".sd-zclose").onclick = () => z.remove();
        z.onclick = ev => { if (ev.target === z) z.remove(); };
        if (!locked && !mine) {
          z.querySelectorAll("[data-zeid][data-who]").forEach(b => b.onclick = () => setGuess(b.dataset.zeid, b.dataset.who));
          z.querySelectorAll("select[data-zeid]").forEach(sel => sel.onchange = () => { if (sel.value) setGuess(sel.dataset.zeid, sel.value); });
        }
      };
      if (!pop && !l.opened.size) l.opened.add(0);          // redrawn after locking in: no second unlock
      showPage(Math.min(l.page, pages.length - 1));
      const lk = $("sd-lock");
      if (lk) lk.onclick = () => { l.locked = true; game.input("lock"); sfx.pop(); ui.resetKey(); };
      bindHostSkip(game);
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every answer alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "deal", left: DIARY.DEAL_MS, players: {}, batch: [], used: [], swapped: [], qs: [], keys: [], qi: -1, why: null, gameId: null });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
