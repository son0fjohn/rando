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
//   reveal  — one question at a time, in batch order:
//             written — every answer at once, unattributed, shuffled; everyone
//                       privately matches answers to players. A point per
//                       correct match.
//             yes/no  — only the count ("3 of 8 said yes", softened at the
//                       edges by countLine); everyone privately picks who they
//                       think said yes. A point per person read right (picked
//                       and said yes, or left out and said no), so picking
//                       everyone isn't a free win.
//             Ends when everyone's locked in or after GUESS_MS.
//   end     — total scores, avatars, the winner. Nothing else.
//
// Nothing about any individual is ever revealed: not who wrote what, not who
// said yes, not which guesses were right. Scores stay hidden until the final
// screen, because a running score would let you subtract your way to which
// guess landed.
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
import { Rounds, syncGone, active, esc, pick, shuffle, showResults, hostSkip, bindHostSkip, trash, tally } from "./../hpkit.js";
import { promptLog } from "./../hplog.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));
const ANSWER_MAX = 140;
const END_MS = 22000;
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
    const freshLocal = gameId => ({ gameId, drafts: {}, yn: {}, submitted: false, flushed: false, timers: {}, qkey: null, guesses: {}, picks: {}, locked: false, popped: new Set() });
    const local = s => { if (!L || L.gameId !== s.gameId) { if (L) Object.values(L.timers).forEach(clearTimeout); L = freshLocal(s.gameId); } return L; };
    trash.add(() => { if (L) Object.values(L.timers).forEach(clearTimeout); L = null; });
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
        next: s => { score(s, s.qi); s.qi = nextPlayable(s, s.qi + 1); return s.qi < 0 ? "end" : "reveal"; },
      },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "answer") { sfx.ping(); buzz(30); }
        if (name === "reveal") { sfx.chime(); buzz(40); }
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
        s.qs = []; s.keys = []; s.qi = -1; s.why = null;
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
        const q = { cands: A.map(p => p.id).sort(), entries: [], countLabel: null, countOf: A.length, playable: false };
        if (c.type === "written") {
          q.entries = A.map((p, i) => ({ eid: `q${k}e${i}`, text: p.answers[k] }));
          s.keys[k] = Object.fromEntries(A.map((p, i) => [`q${k}e${i}`, p.id]));
          q.playable = q.entries.length >= 2;
        } else {
          q.countLabel = countLine(A.filter(p => p.answers[k] === "yes").length, A.length);
          s.keys[k] = Object.fromEntries(A.map(p => [p.id, p.answers[k] === "yes"]));
          q.playable = A.length >= 2;
        }
        logPrompt(s, c, { skipped: false, pos: k + 1 });
        s.qs.push(q);
      });
      for (const p of Object.values(s.players)) { p.answers = {}; p.at = {}; }
    }

    function score(s, k) {
      const key = s.keys[k], c = s.batch[k];
      if (!key) return;
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
      // this question is done: nothing in the state ties anyone to it now
      s.keys[k] = null;
      s.qs[k] = { ...s.qs[k], entries: [], cands: [], countLabel: null, scored: true };
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
        const where = { deal: "dealing", answer: `${n} questions`, reveal: `question ${(s.qi ?? 0) + 1}/${n}`, end: "" }[s.phase] ?? "";
        const label = { deal: "", answer: "answering", reveal: s.batch?.[s.qi]?.type === "yesno" ? "who said yes?" : "matching", end: "final" }[s.phase] ?? "";
        ui.hud(`<div class="hq"><b>SECRET DIARY</b><span>${where}</span><span>${label}</span><span class="clk ${s.left < 8000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span></div>`);
      }

      if (s.phase === "deal") renderDeal(s, isHost);
      else if (s.phase === "answer") renderAnswer(s, l, me);
      else if (s.phase === "reveal") renderReveal(s, l, me);
      else if (s.phase === "end") {
        if (!ui.once(`end:${s.gameId}`, () => {})) return;
        const P = Object.values(s.players || {});
        const top = Math.max(0, ...P.map(p => p.score ?? 0));
        const winners = top > 0 ? P.filter(p => p.score === top).map(p => p.handle) : [];
        const sub = !winners.length ? "no winner this time" : winners.length === 1 ? `${winners[0]} wins` : `${winners.slice(0, -1).join(", ")} & ${winners.at(-1)} tie`;
        showResults(P, {
          title: "Secret Diary", sub,
          note: s.why || "who wrote what, who said yes, and which guesses landed all stay secret — just the totals",
        }, `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
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
          : `<div class="sd-yn small" data-k="${k}"><button type="button" class="yes ${l.yn[k] === "yes" ? "on" : ""}" data-yn="yes" data-k="${k}">yes</button><button type="button" class="no ${l.yn[k] === "no" ? "on" : ""}" data-yn="no" data-k="${k}">no</button></div>`;
        return `<div class="sd-q ${c.type}" data-q="${k}"><div class="sd-qhead"><span class="sd-qn">${k + 1}</span>${pills(c)}</div>
          <div class="sd-prompt ${c.type}">${esc(c.text)}</div>${field}</div>`;
      }).join("");
      const n = s.batch.length;
      ui.stage(`answer all ${n}`, `<p class="ab-sub">nobody will ever see your name next to an answer. yes/no stays secret — only the total is ever shown.</p>
        <div class="sd-batch">${qs}</div>
        <div class="sd-foot" id="sd-foot"><div class="sd-prog"><b id="sd-mine">${answeredCount(s, l)}/${n}</b> answered · ${tl}</div>
          <button type="button" class="pt-btn pt-primary" id="sd-submit">submit</button>${hostSkip(ctx)}</div>`, "in secret");
      // the submit bar sits on the bottom edge of the screen while you scroll
      $("game-panel").classList.add("sd-answering");
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
      // animate the reveal only the first time each question is drawn
      const pop = !l.popped.has(qkey); l.popped.add(qkey);
      const myEid = Object.keys(key).find(e => key[e] === me?.id);
      const cands = q.cands.filter(id => id !== me?.id).map(id => s.players[id]).filter(Boolean);
      const head = `<div class="sd-qcount">question ${k + 1} of ${s.batch.length}</div>
        <div class="sd-prompt big ${c.type}">${pills(c)}${esc(c.text)}</div>`;
      const tl = `<span id="sd-tally">${tally(s, p => p.locked)}</span> locked in`;
      const foot = locked
        ? `<p class="ab-sub sd-locked">${me ? "locked in" : "watching"} · ${tl} · you'll only ever see your total, at the end</p>`
        : `<button type="button" class="pt-btn pt-primary" id="sd-lock">lock in</button><p class="ab-sub">${tl} · you'll only ever see your total, at the end</p>`;

      if (c.type === "written") {
        const g = eid => l.guesses[eid] ?? me?.guesses?.[eid] ?? null;
        const todo = q.entries.filter(e => e.eid !== myEid);
        const rows = q.entries.map((e, i) => {
          const anim = pop ? ` sd-pop" style="animation-delay:${300 + i * 140}ms` : "";
          if (e.eid === myEid) return `<div class="sd-match"><div class="sd-entry mine${anim}">${esc(e.text)}<span class="sd-mine">yours</span></div></div>`;
          const cur = g(e.eid);
          const pickUi = cands.length > CHIP_MAX
            ? `<select class="sd-sel" data-eid="${e.eid}" ${locked ? "disabled" : ""}><option value="">who wrote this?</option>${cands.map(p => `<option value="${esc(p.id)}" ${cur === p.id ? "selected" : ""}>${esc(p.handle)}</option>`).join("")}</select>`
            : `<div class="sd-who">${cands.map(p => `<button type="button" class="${cur === p.id ? "on" : ""}" data-eid="${e.eid}" data-who="${esc(p.id)}" ${locked ? "disabled" : ""}>${esc(p.handle)}</button>`).join("")}</div>`;
          return `<div class="sd-match"><div class="sd-entry${anim}">${esc(e.text)}</div>${pickUi}</div>`;
        }).join("");
        ui.stage(`${q.entries.length} answers — who wrote which?`, head + rows
          + `<div class="sd-prog"><b id="sd-matched">${todo.filter(e => g(e.eid)).length}/${todo.length}</b> matched</div>${foot}${hostSkip(ctx)}`, "unsigned · shuffled");
        const used = () => { const u = new Set(todo.map(e => g(e.eid)).filter(Boolean)); $("game-panel").querySelectorAll("[data-who]").forEach(b => b.classList.toggle("used", !b.classList.contains("on") && u.has(b.dataset.who))); };
        const prog = () => { const m = $("sd-matched"); if (m) m.textContent = `${todo.filter(e => g(e.eid)).length}/${todo.length}`; };
        used();
        if (!locked) {
          $("game-panel").querySelectorAll("[data-who]").forEach(b => b.onclick = () => {
            l.guesses[b.dataset.eid] = b.dataset.who;
            game.input("guess", { eid: b.dataset.eid, who: b.dataset.who }); sfx.tick();
            b.parentElement.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
            used(); prog();
          });
          $("game-panel").querySelectorAll(".sd-sel").forEach(sel => sel.onchange = () => {
            if (!sel.value) return;
            l.guesses[sel.dataset.eid] = sel.value;
            game.input("guess", { eid: sel.dataset.eid, who: sel.value }); sfx.tick(); prog();
          });
        }
      } else {
        const picked = id => (id in l.picks) ? l.picks[id] : !!me?.guesses?.[id];
        ui.stage("who said yes?", head + `<div class="sd-count${pop ? " sd-pop" : ""}"${pop ? ' style="animation-delay:500ms"' : ""}>${esc(q.countLabel ?? "")}</div>
          <p class="ab-sub">${q.countOf} answered · tap everyone you think said yes. a point for every person you read right — yes or no.</p>
          <div class="sd-who sd-yn-pick">${cands.map(p => `<button type="button" class="${picked(p.id) ? "on" : ""}" data-pick="${esc(p.id)}" ${locked ? "disabled" : ""}>${esc(p.handle)}</button>`).join("")}</div>
          ${foot}${hostSkip(ctx)}`, "only the count");
        if (!locked) $("game-panel").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
          const id = b.dataset.pick, on = !picked(id);
          l.picks[id] = on; b.classList.toggle("on", on);
          game.input("pick", { who: id, on }); sfx.tick();
        });
      }
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
