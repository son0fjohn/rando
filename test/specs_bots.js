// Bot specs: one real player plus ?bots=3, the way you'd test alone on the
// live site. The page is loaded as /test/hpbots.html?bots=3 so every game
// module reads BOTS_N = 3 exactly as it would in the browser.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY } from "/web/hpgames/secretdiary.js";
import { TODAYS_MISSION } from "/web/hpgames/mission.js";
import { HUMILIATION_RITUAL, ritualPool } from "/web/hpgames/ritual.js";
import { SIDE_QUEST, questPool } from "/web/hpgames/sidequest.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { DIARY } from "/web/hpconfig.js";
import { diaryPool } from "/web/hpgames/secretdiary.js";
await diaryPool(); await ritualPool(); await questPool();

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

// ===================================================================== 2
group("Today's Mission — you + 3 bots");
{
  const t = seatTable(TODAYS_MISSION, 1, { ids: [ME] });
  adv(500);
  ok(t.s.order.length === 4, "you and the bots all get a mission");
  let guard = 0, botJudged = 0, myJudged = false;
  while (t.s.phase !== "end" && guard++ < 20000) {
    const cur = t.s.order[t.s.mi];
    if (t.s.phase === "do" && cur === ME && !t.s.missions[ME].claimed) t.input(ME, "claim");
    // you rate every bot's mission a 9
    if (t.s.phase === "vote" && cur !== ME && t.s.missions[cur].ratings[ME] === undefined) t.input(ME, "rate", { v: 9 });
    if (t.s.phase === "result") {
      if (cur === ME) myJudged = true;
      else if (t.s.missions[cur].n > 0) botJudged++;
    }
    adv(200);
  }
  ok(t.s.phase === "end", "all four missions play out");
  ok(myJudged && t.s.missions[ME].n === 3, `the bots rated your mission (${t.s.missions[ME].n}/3 ratings)`);
  ok(t.s.missions[ME].pts > 0, `bot ratings turn into points (${t.s.missions[ME].pts})`);
  ok(botJudged > 0, "bot missions get rated");
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
      if (r.performer === ME) {
        // you're performing: tap the first guess that's actually right
        const g = r.guesses.find(g => g.hint === "match");
        if (g) t.input(ME, "pick", { gid: g.gid });
      } else if (guessedThisTurn !== t.s.ti) {
        t.input(ME, "guess", { text: r.answer });
        guessedThisTurn = t.s.ti;
      }
    }
    if (t.s.phase === "result" && outcomes.length === t.s.ti) outcomes.push({ perf: r.performer, won: r.won?.by ?? null });
    adv(200);
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
    if (t.s.phase === "do" && q.who === ME && !q.status) t.input(ME, "done");
    if (t.s.phase === "vote" && q.who !== ME && voted !== t.s.ti) { t.input(ME, "rate", { v: 5 }); voted = t.s.ti; }
    if (t.s.phase === "result" && turns.length === t.s.ti) turns.push({ who: q.who, status: q.status, n: q.n, pts: q.pts });
    adv(200);
  }
  ok(t.s.phase === "end" && turns.length === 4, `4 turns play out (${turns.map(x => `${x.who.slice(0, 5)}:${x.status}:${x.pts}`).join(" ")})`);
  ok(turns.every(x => x.status === "gaveup" ? x.pts === 0 && x.n === 0 : x.n >= 2), "bots vote on every finished quest; a give-up gets no vote");
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
