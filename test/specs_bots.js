// Bot specs: one real player plus ?bots=3, the way you'd test alone on the
// live site. The page is loaded as /test/hpbots.html?bots=3 so every game
// module reads BOTS_N = 3 exactly as it would in the browser.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY } from "/web/hpgames/secretdiary.js";
import { HUMILIATION_RITUAL, ritualPool, judge } from "/web/hpgames/ritual.js";
import { SIDE_QUEST, questPool } from "/web/hpgames/sidequest.js";
import { MASK_OFF, maskPool } from "/web/hpgames/maskoff.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { DIARY } from "/web/hpconfig.js";
import { diaryPool } from "/web/hpgames/secretdiary.js";
await diaryPool(); await ritualPool(); await questPool(); await maskPool();

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (cls, msg) => { const s = document.createElement("span"); s.className = cls; s.textContent = (cls === "head" ? "" : cls === "pass" ? "  ✓ " : "  ✗ ") + msg + "\n"; out.appendChild(s); };
const ok = (c, m) => { if (c) { pass++; log("pass", m); } else { fail++; log("fail", m); } };
const group = n => { log("head", "\n" + n); console.info(`[spec] ${n}`); };

const clock = installClock();
const adv = ms => clock.advance(ms, 200);
const ME = "me";
const bots = s => Object.values(s.players).filter(p => p.isBot);

ok(new URLSearchParams(location.search).get("bots") === "3", "page loaded with ?bots=3");

// ===================================================================== 1
group("Secret Diary — you + 3 bots");
{
  const t = seatTable(SECRET_DIARY, 1, { ids: [ME] });
  adv(500);
  ok(bots(t.s).length === 3, "three bots take seats");
  ok(t.s.phase === "deal", "you're the host, so you get the deal");
  t.input(ME, "send");
  adv(400);
  t.s.batch.forEach((c, k) => t.input(ME, "ans", c.type === "written" ? { k, text: `my answer ${k}` } : { k, yn: "yes" }));
  t.input(ME, "submit");
  let guard = 0, written = 0, yesno = 0, myPoints = 0, lastQ = -1;
  while (t.s.phase !== "end" && guard++ < 40000) {
    if (t.s.phase === "reveal" && t.s.qi !== lastQ) {
      lastQ = t.s.qi;
      const q = t.s.qs[t.s.qi], key = t.s.keys[t.s.qi];
      if (t.s.batch[t.s.qi].type === "written") {
        written++;
        ok(q.entries.length === 4, `q${t.s.qi + 1}: the bots wrote answers too (${q.entries.length})`);
        for (const e of q.entries) if (key[e.eid] !== ME) t.input(ME, "guess", { eid: e.eid, who: key[e.eid] });
      } else {
        yesno++;
        ok(q.countOf === 4, `q${t.s.qi + 1}: the bots tapped yes/no too (${q.countOf} answered)`);
        for (const [id, yes] of Object.entries(key)) if (id !== ME && yes) t.input(ME, "pick", { who: id, on: true });
      }
      myPoints += 3;
      t.input(ME, "lock");
    }
    adv(200);
  }
  ok(t.s.phase === "end", "the bots keep the whole game moving");
  ok(written === 3 && yesno === 2, `all 5 questions revealed (${written} written, ${yesno} yes/no)`);
  ok(t.s.players[ME].score === myPoints, `reading every bot right scores ${myPoints} (got ${t.s.players[ME].score})`);
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 3
group("Humiliation Ritual — you + 3 bots");
{
  const t = seatTable(HUMILIATION_RITUAL, 1, { ids: [ME] });
  adv(500);
  ok(t.s.turns === 4, "4 turns: everyone performs once by default");
  let guard = 0, guessedThisTurn = -1;
  const outcomes = [];
  while (t.s.phase !== "end" && guard++ < 20000) {
    const r = t.s.turn;
    if (t.s.phase === "act" && !r.won) {
      // what your phone knows: your own prompt, or (offline, bots only) the
      // bot's prompt it dealt — the synced state never has it
      const known = t.byId(ME).game.knownPrompt();
      if (r.performer === ME) {
        // you're performing: tap the first guess that's actually right
        const g = known && r.guesses.find(g => judge(g.text, { answer: known }) === "match");
        if (g) t.input(ME, "pick", { gid: g.gid });
      } else if (guessedThisTurn !== t.s.ti && known) {
        t.input(ME, "guess", { text: known });
        guessedThisTurn = t.s.ti;
      }
    }
    if (t.s.phase === "result" && outcomes.length === t.s.ti) outcomes.push({ perf: r.performer, won: r.won?.by ?? null });
    adv(200); await null; await null; await null;
  }
  ok(t.s.phase === "end" && outcomes.length === 4, "all four turns play out");
  const botTurns = outcomes.filter(o => o.perf !== ME), mine = outcomes.filter(o => o.perf === ME);
  ok(botTurns.every(o => o.won), "a bot performer taps a right guess");
  ok(mine.every(o => o.won && o.won !== ME), "on your turn you tap a bot's right guess");
  ok(t.s.players[ME].score > 0, `you scored (${t.s.players[ME].score})`);
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Mask Off — you + 3 bots");
{
  const t = seatTable(MASK_OFF, 1, { ids: [ME] });
  adv(500);
  ok(t.s.phase === "setup", "you host: the deck setup");
  t.input(ME, "mo-rounds", { n: 1 }); adv(300); t.input(ME, "mo-go");
  let guard = 0;
  const turns = [];
  while (t.s.phase !== "end" && guard++ < 40000) {
    const q = t.s.turn;
    if (q && t.s.phase === "choose" && q.asker === ME && !q.card) t.input(ME, "ask", { id: t.s.hands[ME][0] });
    if (q && t.s.phase === "talk" && q.who === ME && !q.status) t.input(ME, "answer");
    if (q && t.s.phase === "talk" && q.who === ME && q.status === "answering") t.input(ME, "done");
    if (q && t.s.phase === "talk" && q.who !== ME && q.status === "answering") t.input(ME, "same");
    if (q && t.s.phase === "after" && turns.length === t.s.ti) turns.push({ who: q.who, asker: q.asker, status: q.status, same: q.same });
    adv(200);
  }
  ok(t.s.phase === "end" && turns.length === 4, `4 turns play out (${turns.map(x => `${x.asker.slice(0, 4)}→${x.who.slice(0, 4)}:${x.status}:${x.same}`).join(" ")})`);
  ok(turns.every(x => x.asker !== x.who) && new Set(turns.map(x => x.who)).size === 4, "everyone is asked once, never by themselves");
  ok(turns.every(x => ["done", "passed"].includes(x.status)), "the bots ask, answer or pass on their own");
  ok(t.s.players[ME].score === 1, "you answered: you're in for the coins");
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Side Quest — you + 3 bots");
{
  const t = seatTable(SIDE_QUEST, 1, { ids: [ME] });
  adv(500);
  ok(t.s.phase === "setup", "you host: the setup screen");
  t.input(ME, "sq-go");
  let guard = 0, voted = -1;
  const turns = [];
  while (t.s.phase !== "end" && guard++ < 40000) {
    const q = t.s.turn;
    if (t.s.phase === "do" && q.who !== ME && voted !== t.s.ti) { t.input(ME, "rate", { v: 5 }); voted = t.s.ti; }
    if (t.s.phase === "result" && turns.length === t.s.ti) turns.push({ who: q.who, status: q.status, n: q.n, pts: q.pts });
    adv(200);
  }
  ok(t.s.phase === "end" && turns.length === 4, `4 turns play out (${turns.map(x => `${x.who.slice(0, 5)}:${x.status}:${x.pts}`).join(" ")})`);
  ok(turns.every(x => x.status === "gaveup" ? x.pts === 0 && x.n === 0 : x.n >= 2), "bots rate every quest while it's on; a give-up gets no rating");
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 4
group("The Art Gallery — you + 3 bots");
{
  const t = seatTable(ART_GALLERY, 1, { ids: [ME] });
  adv(500);
  for (let i = 0; i < 3; i++) t.input(ME, "photo", { pid: `me-${i}` });
  let guard = 0;
  while (t.s.phase === "photos" && guard++ < 2000) adv(200);
  ok(Object.keys(t.s.pool).length === 12, `bots add their 3 photos each (${Object.keys(t.s.pool).length} in the pool)`);
  ok(t.s.phase === "title", "titling opens");
  for (const pid of t.s.players[ME].assigned) t.input(ME, "title", { pid, text: "my title" });
  while (t.s.phase === "title" && guard++ < 4000) adv(200);
  ok(t.s.phase === "gallery" && t.s.frames.length > 0, `bots title theirs and the gallery opens (${t.s.frames.length} frames)`);
  while (t.s.phase !== "end" && guard++ < 20000) {
    const f = t.s.frames[t.s.fi];
    if (t.s.sub === "reveal" && f && !f.titles.some(x => x.by === ME) && f.votes[ME] === undefined) t.input(ME, "vote", { idx: 0 });
    adv(200);
  }
  ok(t.s.phase === "end", "every frame is unveiled and voted on");
  ok(t.s.frames.every(f => (f.counts?.[0] ?? 0) + (f.counts?.[1] ?? 0) > 0), "every frame got votes");
  let spent = 0; while (!t.allEnded() && spent < 120000) { adv(2000); spent += 2000; }
  ok(t.allEnded(), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
