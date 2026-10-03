// Secret Diary (3+) — house party game 1.
//
// One prompt about tonight and the people in the room. Everyone privately
// writes a sentence or two. Every entry then appears at once, unattributed,
// in random order. Each player privately matches every entry to a player.
// Score is correct matches.
//
// The answers are never revealed: no screen in this game ever shows who wrote
// an entry — not during the round, not on the results screen, not to the
// winner.
//
// AUTHORSHIP, honestly: "never revealed" is a UI promise, not a cryptographic
// one. Rooms are Supabase Realtime broadcast channels, so every snapshot
// reaches every member; the host has to know who wrote what in order to
// score, which means authorship is in the state and anyone with devtools open
// could read it. That is true of every hidden-information game in this
// codebase (Art Gallery included) and is fine for a disposable party demo on
// phones. Making it actually secret would need per-player encryption or a
// server authority — neither is in scope. `p.myEid` is the author link.
import { HostGame, makeBots, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { DIARY_PROMPTS, DIARY_BOT_ENTRIES, pool } from "./../hpconfig.js";
import { Rounds, syncGone, allDone, esc, pick, shuffle, showResults, hostSkip, bindHostSkip, trash, tally } from "./../hpkit.js";

const params = new URLSearchParams(location.search);
const BOTS_N = Math.max(0, Math.min(8, +params.get("bots") || 0));
const ENTRY_MAX = 180;
const WRITE_MS = 150000, REVEAL_MS = 9000, MATCH_MS = 180000, END_MS = 22000;

export const SECRET_DIARY = {
  id: "secretdiary", title: "Secret Diary",
  blurb: "everyone writes one secret entry. all of them appear unsigned. guess who wrote which.",
  minPlayers: 3, maxPlayers: 12, length: "~6 min",

  start(ctx) {
    ui.show(); ui.theme("chill");
    const room = ctx.room;

    // entry id -> author id, derived from the state (p.myEid). Rebuilt rather
    // than trusted so a host handover mid-round can still score the game.
    const authorOf = s => {
      const m = new Map();
      for (const p of Object.values(s.players || {})) if (p.myEid) m.set(p.myEid, p.id);
      return m;
    };
    // client-local
    let myEntry = null, myGuesses = {}, lastHud = 0;
    trash.add(() => { myGuesses = {}; myEntry = null; });

    const rounds = new Rounds([
      {
        name: "write", ms: WRITE_MS,
        done: s => allDone(s, p => !!p.wrote),
        next: () => "reveal",
        exit: s => collect(s),
      },
      { name: "reveal", ms: REVEAL_MS, next: s => s.entries.length >= 2 ? "match" : "end" },
      {
        name: "match", ms: MATCH_MS,
        done: s => allDone(s, p => mineToMatch(s, p).every(e => p.guesses[e.eid])),
        next: s => { score(s); return "end"; },
      },
      { name: "end", ms: END_MS, next: () => null },
    ], { onPhase: name => { ui.resetKey(); if (name === "reveal") { sfx.chime(); buzz(40); } if (name === "match") sfx.ping(); if (name === "end") sfx.win(); } });

    // which entries a given player has to match: everything except their own
    // (their own is shown, locked, labelled "yours" — a free point otherwise)
    const mineToMatch = (s, p) => (s.entries || []).filter(e => e.eid !== p.myEid);

    const game = new HostGame(ctx, {
      hostInit(s) {
        s.players = {};
        for (const h of ctx.humans) s.players[h.id] = seat(h.id, h.handle, false);
        for (const b of makeBots(BOTS_N, game.rng, new Set(Object.keys(s.players))))
          s.players[b.id] = seat(b.id, b.handle, true);
        const names = Object.values(s.players).map(p => p.handle);
        const prompts = pool(DIARY_PROMPTS);
        s.prompt = pick(game.rng, prompts).text.replace(/\{\{player\}\}/g, names.length ? pick(game.rng, names) : "someone here");
        s.entries = []; s.why = null;
        rounds.enter(s, "write");
      },
      hostTick(s, dt) {
        syncGone(s, room);
        if (s.phase === "write") {
          const botPool = shuffle(game.rng, DIARY_BOT_ENTRIES);
          for (const p of Object.values(s.players))
            if (p.isBot && !p.wrote && game.rng() < dt * 0.35) { p.wrote = true; p.text = botPool[Math.abs(hash(p.id)) % botPool.length]; }
        }
        if (s.phase === "match") {
          for (const p of Object.values(s.players)) {
            if (!p.isBot) continue;
            for (const e of mineToMatch(s, p))
              if (!p.guesses[e.eid] && game.rng() < dt * 0.3) p.guesses[e.eid] = pick(game.rng, Object.keys(s.players));
          }
        }
        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const p = s.players[m.from];
        if (!p) return;
        if (m.in === "write" && s.phase === "write") {
          p.text = String(m.text ?? "").trim().slice(0, ENTRY_MAX);
          p.wrote = !!p.text;
        }
        if (m.in === "guess" && s.phase === "match") {
          const e = (s.entries || []).find(x => x.eid === m.eid);
          if (e && e.eid !== p.myEid && s.players[m.who]) p.guesses[m.eid] = m.who;
        }
      },
      render(s) { renderSD(s); },
      onEvent() {},
    }, { hz: 3 });

    const seat = (id, handle, isBot) => ({ id, handle, isBot, score: 0, gone: false, wrote: false, text: "", guesses: {}, myEid: null, correct: 0 });
    function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }

    // ---- host: turn written text into an anonymous, shuffled entry list ----
    // Entry ids are assigned AFTER the shuffle, so neither the id nor the
    // display order tracks join order or anything else a player could reason
    // about from the outside.
    function collect(s) {
      const written = shuffle(game.rng, Object.values(s.players).filter(p => p.wrote && p.text));
      s.entries = written.map((p, i) => ({ eid: `e${i}`, text: p.text }));
      written.forEach((p, i) => { p.myEid = `e${i}`; });
      // the text now lives only in s.entries; drop the per-player copy so the
      // state has one home for it instead of two that can drift
      for (const p of Object.values(s.players)) p.text = "";
      if (s.entries.length < 2) s.why = "not enough entries to play — everyone needs to write one";
    }
    // score: one point per correctly matched entry.
    function score(s) {
      const by = authorOf(s);
      for (const p of Object.values(s.players)) {
        let n = 0;
        for (const e of mineToMatch(s, p)) if (p.guesses[e.eid] && p.guesses[e.eid] === by.get(e.eid)) n++;
        p.correct = n;
        p.score = n;
      }
    }

    // ---- render (everyone) ----
    function renderSD(s) {
      const now = performance.now(); if (now - lastHud < 150) return; lastHud = now;
      const me = s.players?.[ctx.me.id];
      const P = Object.values(s.players || {});
      const label = s.phase === "write" ? "writing" : s.phase === "reveal" ? "the entries" : s.phase === "match" ? "matching" : "final";
      ui.hud(`<div class="hq"><b>SECRET DIARY</b><span>${label}</span><span class="clk ${s.left < 10000 && s.phase !== "end" ? "urgent" : ""}">${ui.clock(s.left)}</span>${s.phase === "end" ? `<span>${me?.score ?? 0} pts</span>` : ""}</div>`);

      if (s.phase === "write") {
        const done = me?.wrote || !!myEntry;
        if (!ui.once(`w:${done ? 1 : 0}:${tally(s, p => p.wrote)}`, () => {})) return;
        const body = `<div class="sd-prompt">${esc(s.prompt)}</div>` + (done
          ? `<div class="sd-entry">${esc(myEntry ?? "locked in")}</div><p class="ab-sub">locked in · ${tally(s, p => p.wrote)} written</p>`
          : ui.prompt("a sentence or two…", text => { myEntry = text; game.input("write", { text }); sfx.pop(); ui.resetKey(); }, { maxlength: ENTRY_MAX, submitLabel: "lock it in" })
            + `<p class="ab-sub">nobody sees your name next to this — ever · ${tally(s, p => p.wrote)} written</p>`);
        ui.stage("tonight's entry", body + hostSkip(ctx), `writing · ${ui.clock(s.left)}`);
        bindHostSkip(game);

      } else if (s.phase === "reveal") {
        if (!ui.once(`r:${s.entries.length}`, () => {})) return;
        ui.stage(`${s.entries.length} entries`, `<div class="sd-prompt">${esc(s.prompt)}</div>`
          + s.entries.map(e => `<div class="sd-entry">${esc(e.text)}</div>`).join("")
          + `<p class="ab-sub">unsigned, in random order. read them properly — you're about to guess.</p>${hostSkip(ctx)}`, "the diary");
        bindHostSkip(game);

      } else if (s.phase === "match") {
        const todo = mineToMatch(s, me ?? { myEid: null });
        const answered = todo.filter(e => myGuesses[e.eid] || me?.guesses?.[e.eid]).length;
        if (!ui.once(`m:${answered}:${todo.length}:${tally(s, p => mineToMatch(s, p).every(e => p.guesses[e.eid]))}`, () => {})) return;
        // everyone is a candidate, including players who have since left —
        // their entry is still in the pool, so they must stay pickable
        const names = P;
        const rows = (s.entries || []).map(e => {
          if (e.eid === me?.myEid) return `<div class="sd-match"><div class="sd-entry">${esc(e.text)}</div><div class="pt-note">yours — not scored</div></div>`;
          const g = myGuesses[e.eid] ?? me?.guesses?.[e.eid] ?? null;
          return `<div class="sd-match"><div class="sd-entry">${esc(e.text)}</div>
            <div class="sd-who">${names.map(p => `<button type="button" class="${g === p.id ? "on" : ""}" data-eid="${e.eid}" data-who="${esc(p.id)}">${esc(p.handle)}</button>`).join("")}</div></div>`;
        }).join("");
        ui.stage("who wrote which?", rows + `<p class="ab-sub">${answered}/${todo.length} matched · you can change your mind until the clock runs out</p>${hostSkip(ctx)}`, `matching · ${ui.clock(s.left)}`);
        document.getElementById("game-panel").querySelectorAll("[data-eid]").forEach(b => b.onclick = () => {
          myGuesses[b.dataset.eid] = b.dataset.who;
          game.input("guess", { eid: b.dataset.eid, who: b.dataset.who });
          sfx.tick(); ui.resetKey();
        });
        bindHostSkip(game);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const total = Math.max(0, (s.entries?.length ?? 1) - 1);
        showResults(P, {
          title: "Secret Diary", sub: "correct matches",
          note: s.why || `out of ${total} · who wrote what stays secret — nobody finds out, not even the winner`,
        }, `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // the state itself is part of what cleanup has to drop: HostGame parks the
    // live game on window.__game for debugging, which would otherwise keep
    // every entry, title and photo id alive after the party ended
    trash.add(() => { game.s = null; if (window.__game === game) window.__game = null; });
    game.start({ phase: "write", left: WRITE_MS, players: {}, entries: [], prompt: "…", why: null });
    const o = ctx.onEnd;
    ctx.onEnd = () => { game.stop(); ui.hide(); o(); };
  },
};
