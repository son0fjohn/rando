// House-party specs. Plays every game end to end on the fake bus + virtual
// clock and asserts the rules the brief actually names.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY, diaryPool, maxLevelFor, capFor, countLine } from "/web/hpgames/secretdiary.js";
import * as CONFIG from "/web/hpconfig.js";
import { promptLog } from "/web/hplog.js";
import { TODAYS_MISSION } from "/web/hpgames/mission.js";
import { HUMILIATION_RITUAL, judge } from "/web/hpgames/ritual.js";
import { MANHUNT_GAME } from "/web/hpgames/manhunt.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { MANHUNT, DIARY, MISSION } from "/web/hpconfig.js";
import { resultsHtml, trash, Rounds } from "/web/hpkit.js";

const out = document.getElementById("out");
let pass = 0, fail = 0;
const log = (cls, msg) => { const s = document.createElement("span"); s.className = cls; s.textContent = (cls === "head" ? "" : cls === "pass" ? "  ✓ " : "  ✗ ") + msg + "\n"; out.appendChild(s); };
const ok = (cond, msg) => { if (cond) { pass++; log("pass", msg); } else { fail++; log("fail", msg); } };
const group = name => log("head", "\n" + name);

// the diary's prompt pool is fetched at import; have it before any clock tricks
const POOL = await diaryPool();
const clock = installClock();
// HostGame caps dt at 0.25 s per tick, so advancing in slices bigger than that
// makes game time run SLOWER than virtual time. Every advance here uses 200 ms
// slices so game time and virtual time stay 1:1.
const STEP = 200;
const adv = ms => clock.advance(ms, STEP);
const MATCH_DRAIN = 200000;      // Secret Diary's match window plus slack
// run a game to completion: advance until everyone's onEnd fired, bounded
function runOut(t, maxMs = 25 * 60 * 1000) {
  let spent = 0;
  while (!t.allEnded() && spent < maxMs) { adv(2000); spent += 2000; }
  return t.allEnded();
}
// advance until the host state reaches `phase` (or give up)
function waitPhase(t, phase, maxMs = 5 * 60 * 1000) {
  let spent = 0;
  while (t.s?.phase !== phase && spent < maxMs) { adv(STEP); spent += STEP; }
  return t.s?.phase === phase;
}

// ===================================================================== 1
group("Secret Diary — the prompt pool");
{
  ok(POOL.length === 66, `the pool is exactly the 66 supplied prompts (got ${POOL.length})`);
  ok(new Set(POOL.map(p => p.id)).size === POOL.length, "every prompt has a unique id");
  ok(POOL.every(p => ["written", "yesno"].includes(p.type) && DIARY.LEVELS.includes(p.level) && p.text), "every prompt has text, a valid type and a valid level");
  const by = (t, l) => POOL.filter(p => p.type === t && p.level === l).length;
  ok(by("written", "mild") === 24 && by("written", "spicy") === 19 && by("written", "unhinged") === 5, "written: 24 mild, 19 spicy, 5 unhinged");
  ok(by("yesno", "mild") === 1 && by("yesno", "spicy") === 12 && by("yesno", "unhinged") === 5, "yes/no: 1 mild, 12 spicy, 5 unhinged");
  ok(!("DIARY_PROMPTS" in CONFIG) && !("DIARY_BOT_ENTRIES" in CONFIG), "the old placeholder pool and its filler are gone from the config");
  const old = ["Write the diary entry for tonight", "police report", "group chat message you drafted", "title card", "pettiest thought", "quietly judging", "{{player}}"];
  ok(!POOL.some(p => old.some(o => p.text.includes(o))), "no old placeholder prompt survives in the pool");
}

group("Secret Diary — levels, escalation, softened counts");
{
  ok(maxLevelFor({ privacy: "public" }) === "mild", "public party defaults to mild");
  ok(maxLevelFor({ privacy: "private" }) === "spicy", "private party defaults to spicy");
  ok(maxLevelFor({ privacy: "private", settings: { diaryMax: "unhinged", adult: false } }) === "spicy", "unhinged without 18+ falls back to spicy");
  ok(maxLevelFor({ privacy: "private", settings: { diaryMax: "unhinged", adult: true } }) === "unhinged", "unhinged with 18+ is allowed");
  ok(maxLevelFor({ privacy: "private", settings: { diaryMax: "mild" } }) === "mild", "the host can lower it");
  ok(capFor(1, "unhinged") === "mild" && capFor(2, "unhinged") === "mild", "rounds 1-2: mild only");
  ok(capFor(3, "unhinged") === "spicy" && capFor(4, "unhinged") === "spicy", "rounds 3-4: up to spicy");
  ok(capFor(3, "mild") === "mild", "…but never above the host's max");
  ok(capFor(5, "unhinged") === "unhinged" && capFor(9, "spicy") === "spicy", "round 5+: up to the host's max");
  ok(countLine(3, 8) === "3 of 8 said yes", "a middling count is shown exactly");
  ok(countLine(0, 8) === countLine(1, 8) && /nobody or almost nobody/.test(countLine(0, 8)), "0 and 1 share 'nobody or almost nobody' — so the soft wording never pins it to 0");
  ok(countLine(8, 8) === countLine(7, 8) && /everyone or almost everyone/.test(countLine(8, 8)), "all and all-but-one share 'everyone or almost everyone'");
}

group("Secret Diary — a full game: written + yes/no, scoring, logging (4 players)");
{
  window.__logRows = [];
  const t = seatTable(SECRET_DIARY, 4);
  adv(300);
  ok(t.s.phase === "preview" && !!t.s.cur, "each round opens with the host's preview");
  ok(t.s.maxLevel === "spicy" && t.s.visibility === "private", "a private party defaults to spicy");
  ok(t.s.totalRounds === DIARY.ROUNDS, `${DIARY.ROUNDS} rounds`);
  ok(waitPhase(t, "answer", DIARY.PREVIEW_MS + 1000), `with no host action it goes to everyone after ~${DIARY.PREVIEW_MS / 1000}s`);
  const ids = ["p1", "p2", "p3", "p4"], expect = { p1: 0, p2: 0, p3: 0, p4: 0 };
  const seen = [];
  let hudLeak = false;
  for (let r = 1; r <= DIARY.ROUNDS; r++) {
    if (r > 1) ok(waitPhase(t, "answer", DIARY.PREVIEW_MS + 1000), `round ${r} opens by itself`);
    const cur = { ...t.s.cur, round: t.s.round };
    seen.push(cur);
    ok(DIARY.LEVELS.indexOf(cur.level) <= DIARY.LEVELS.indexOf(capFor(r, "spicy")), `round ${r}: ${cur.level} ${cur.type} is within the curve`);
    if (cur.type === "written") {
      ok(t.s.left <= DIARY.WRITE_MS && t.s.left > DIARY.WRITE_MS - 2000, `written gets ~${DIARY.WRITE_MS / 1000}s`);
      ids.forEach(id => t.input(id, "answer", { text: `${id} round ${r}` }));
      ok(waitPhase(t, "guess", 30000), "everyone answering moves to reveal, then matching");
      ok(t.s.entries.length === 4 && t.s.entries.every(e => !("by" in e)), "four unattributed answers");
      const author = eid => Object.values(t.s.players).find(p => p.myEid === eid)?.id;
      for (const e of t.s.entries) if (e.eid !== t.s.players.p1.myEid) t.input("p1", "guess", { eid: e.eid, who: author(e.eid) });
      // p2 credits p1 with everything: 1 right at most
      for (const e of t.s.entries) if (e.eid !== t.s.players.p2.myEid) t.input("p2", "guess", { eid: e.eid, who: "p1" });
      expect.p1 += 3; expect.p2 += 1;
    } else {
      ok(t.s.left <= DIARY.YESNO_MS && t.s.left > DIARY.YESNO_MS - 2000, `yes/no gets ~${DIARY.YESNO_MS / 1000}s`);
      t.input("p1", "answer", { yn: "yes" }); t.input("p2", "answer", { yn: "yes" }); t.input("p3", "answer", { yn: "no" }); t.input("p4", "answer", { yn: "no" });
      ok(waitPhase(t, "guess", 15000), "everyone tapping moves to the count, then guessing");
      ok(t.s.countLabel === "2 of 4 said yes", `only the count is revealed: "${t.s.countLabel}"`);
      t.input("p1", "pickyes", { who: "p2", on: true }); t.input("p1", "lock");
      t.input("p2", "lock");               // picked nobody: reads p1 wrong, p3 + p4 right
      expect.p1 += 3; expect.p2 += 2;
    }
    adv(1000);
    if (/pts/.test(document.getElementById("game-hud").innerHTML)) hudLeak = true;
    let g = 0; while (t.s.phase === "guess" && g++ < 400) adv(STEP);   // p3, p4 never guess: the timer ends it
  }
  ok(!hudLeak, "no score is shown during the game — only at the end");
  ok(waitPhase(t, "end", 10000), "after the last round, the results");
  ok(seen.filter(c => c.type === "yesno").length === 2, `roughly 1 in 3 rounds is yes/no (${seen.filter(c => c.type === "yesno").length} of ${DIARY.ROUNDS})`);
  ok(new Set(seen.map(c => c.id)).size === seen.length, "no prompt repeats");
  ok(ids.every(id => t.s.players[id].score === expect[id]), `scores: ${ids.map(id => `${id} ${t.s.players[id].score}/${expect[id]}`).join(", ")}`);
  ok(Object.values(t.s.players).every(p => p.answer === null && !p.myEid), "answers are wiped from the state once each round is scored");
  adv(1500);
  const panel = document.getElementById("game-panel").innerHTML;
  ok(!/p\d round \d/.test(panel) && !panel.includes("sd-entry") && !panel.includes("sd-count") && !/\d of \d said yes/.test(panel), "the results screen shows totals only — no answers, no counts");

  const rows = window.__logRows.filter(r => r.game_id === t.s.gameId);
  ok(rows.length === DIARY.ROUNDS, `one log row per prompt shown (${rows.length})`);
  const keys = ["prompt_id", "level", "type", "party_size", "bots", "visibility", "skipped", "round", "answered", "avg_submit_ms", "avg_answer_len", "game_id"];
  ok(rows.every(r => keys.every(k => k in r)), "each row has id, level, type, party size, public/private, skipped, avg submit time, avg answer length");
  ok(rows.every(r => r.party_size === 4 && r.bots === 0 && r.visibility === "private" && r.skipped === false && r.answered === 4), "party size, visibility, skipped and answered are right");
  ok(rows.every(r => typeof r.avg_submit_ms === "number" && r.avg_submit_ms >= 0), "average submit time is recorded");
  ok(rows.filter(r => r.type === "written").every(r => r.avg_answer_len > 0) && rows.filter(r => r.type === "yesno").every(r => r.avg_answer_len === null), "average answer length for written, none for yes/no");
  ok(rows.every(r => !JSON.stringify(r).includes("round 1") && !("handle" in r) && !("user_id" in r)), "rows carry no answer text and no player identity");
  ok(runOut(t), "the game closes out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — host skip");
{
  window.__logRows = [];
  const t = seatTable(SECRET_DIARY, 3);
  adv(300);
  const first = t.s.cur.id;
  t.input("p2", "skipPrompt");
  adv(300);
  ok(t.s.cur.id === first, "only the host can skip");
  adv(2500);
  t.input("p1", "skipPrompt");
  adv(300);
  ok(t.s.cur.id !== first && t.s.phase === "preview", "the host's skip deals a different prompt, still in preview");
  ok(t.s.left > DIARY.PREVIEW_MS - 600, "and the preview clock restarts");
  ok(t.s.skipped.includes(first), "the skipped prompt is remembered");
  const sk = window.__logRows.find(r => r.prompt_id === first);
  ok(sk && sk.skipped === true && sk.answered === null, "skips are logged as skipped");
  const shown = [];
  let g = 0; while (t.s.phase !== "end" && g++ < 20000) { if (t.s.cur && !shown.includes(t.s.cur.id)) shown.push(t.s.cur.id); adv(STEP); }
  ok(!shown.slice(1).includes(first), "a skipped prompt never comes back");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — nobody taps anything, people drop, too few answers");
{
  window.__logRows = [];
  const t = seatTable(SECRET_DIARY, 3);
  ok(runOut(t, 40 * 60 * 1000), "with zero taps from anyone the game still runs to the end");
  const rows = window.__logRows.filter(r => r.game_id === t.s.gameId);
  ok(rows.length === DIARY.ROUNDS && rows.every(r => r.answered === 0), "every round still happened (and was logged), with no answers");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(SECRET_DIARY, 4);
  ok(waitPhase(t, "answer", 8000), "into answering");
  const type = t.s.cur.type;
  ["p1", "p2", "p3"].forEach(id => t.input(id, "answer", type === "written" ? { text: `hi from ${id}` } : { yn: "no" }));
  adv(1000);
  ok(t.s.phase === "answer", "one player short: still waiting");
  t.drop("p4");
  adv(3000);
  ok(t.s.phase === "reveal" || t.s.phase === "guess", "a player dropping mid-round stops being waited on");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(SECRET_DIARY, 3);
  ok(waitPhase(t, "answer", 8000), "into answering");
  const r0 = t.s.round, type = t.s.cur.type;
  t.input("p1", "answer", type === "written" ? { text: "lonely answer" } : { yn: "yes" });
  ok(waitPhase(t, "preview", DIARY.WRITE_MS + 5000), "a round with only one answer is skipped past — nothing to guess");
  ok(t.s.round === r0 + 1, "and the next round starts");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

group("Secret Diary — content levels and the 18+ gate");
{
  const pub = seatTable(SECRET_DIARY, 3, { party: { privacy: "public", settings: {} } });
  const lv = [];
  let g = 0; while (pub.s.phase !== "end" && g++ < 30000) { if (pub.s.cur && pub.s.phase === "answer" && lv[pub.s.round - 1] === undefined) lv[pub.s.round - 1] = pub.s.cur.level; adv(STEP); }
  ok(pub.s.maxLevel === "mild" && lv.length === DIARY.ROUNDS && lv.every(l => l === "mild"), `a public party stays mild all game (${lv.join(",")})`);

  const noAdult = seatTable(SECRET_DIARY, 3, { party: { privacy: "private", settings: { diaryMax: "unhinged", adult: false } } });
  adv(300);
  ok(noAdult.s.maxLevel === "spicy", "asking for unhinged without 18+ gets spicy");
  const adult = seatTable(SECRET_DIARY, 3, { party: { privacy: "private", settings: { diaryMax: "unhinged", adult: true } } });
  const lv2 = [];
  g = 0; while (adult.s.phase !== "end" && g++ < 30000) { if (adult.s.cur && adult.s.phase === "answer" && lv2[adult.s.round - 1] === undefined) lv2[adult.s.round - 1] = adult.s.cur.level; adv(STEP); }
  ok(adult.s.maxLevel === "unhinged", "18+ on: unhinged is allowed");
  ok(lv2.slice(0, 2).every(l => l === "mild") && lv2.slice(2, 4).every(l => l !== "unhinged"), `…but the curve still holds (${lv2.join(",")})`);
}

group("Secret Diary — no repeats across games in one party session");
{
  const session = {};
  const g1 = seatTable(SECRET_DIARY, 3, { session });
  runOut(g1, 40 * 60 * 1000);
  const a = [...session.diaryUsed];
  const g2 = seatTable(SECRET_DIARY, 3, { session });
  runOut(g2, 40 * 60 * 1000);
  const b = g2.s.used;
  ok(a.length === DIARY.ROUNDS && b.length === DIARY.ROUNDS, "two full games");
  ok(!b.some(id => a.includes(id)), "the second game never repeats a prompt from the first");
}

group("Secret Diary — logging survives a missing table");
{
  const before = promptLog.queued();
  window.__logFail = true;
  await promptLog.log({ prompt_id: "w-mild-01", level: "mild", type: "written", party_size: 3, bots: 0, visibility: "private", skipped: false, round: 1, answered: 3, avg_submit_ms: 1000, avg_answer_len: 12, game_id: "spec" });
  ok(promptLog.queued() === before + 1, "if the insert fails the row is queued on the phone");
  window.__logFail = false;
  window.__logRows = [];
  await promptLog.log({ prompt_id: "w-mild-02", level: "mild", type: "written", party_size: 3, bots: 0, visibility: "private", skipped: false, round: 2, answered: 3, avg_submit_ms: 1000, avg_answer_len: 12, game_id: "spec" });
  for (let i = 0; i < 10; i++) await null;      // let the background flush settle (setTimeout is faked here)
  ok(promptLog.queued() === 0 && window.__logRows.some(r => r.prompt_id === "w-mild-01"), "…and flushed on the next successful write");
}

// ===================================================================== 2
group("Today's Mission — quick start, rated 0-10");
{
  const t = seatTable(TODAYS_MISSION, 4);
  adv(500);
  ok(t.s.mode === "quick", "quick start is the default");
  ok(t.s.phase === "card", "quick start goes straight to the first card");
  ok(Object.values(t.s.missions).every(m => m.task && m.task.length > 10), "every player was dealt a mission");

  const performer = t.s.order[0];
  const voters = t.s.order.filter(x => x !== performer);
  ok(waitPhase(t, "do"), "the card rolls into doing it");
  t.input(performer, "claim");
  adv(3000);
  ok(t.s.phase === "vote", "claiming done advances to the rating");
  t.input(performer, "rate", { v: 10 });
  adv(400);
  ok(t.s.missions[performer].ratings[performer] === undefined, "the performer cannot rate themselves");
  [10, 8, 6].forEach((v, i) => t.input(voters[i], "rate", { v }));
  adv(3000);
  ok(t.s.phase === "result", "all ratings in ends the vote");
  const m = t.s.missions[performer];
  ok(m.avg === 8, `the score is the average rating (got ${m.avg})`);
  ok(m.pts === 80, `average 8/10 -> 80 points (got ${m.pts})`);
  ok(t.s.players[performer].score === 80, "points land on the performer");

  ok(waitPhase(t, "vote", 200000), "next mission reaches its rating");
  const p2 = t.s.order[1];
  const v2 = t.s.order.filter(x => x !== p2);
  t.input(v2[0], "rate", { v: 15 }); t.input(v2[1], "rate", { v: -3 }); t.input(v2[2], "rate", { v: 0 });
  adv(400);
  ok(t.s.missions[p2].ratings[v2[0]] === 10 && t.s.missions[p2].ratings[v2[1]] === 0, "ratings are clamped to the 0-10 scale");
  t.input(v2[0], "rate", { v: 4 });
  adv(3000);
  ok(t.s.missions[p2].ratings[v2[0]] === 4 || t.s.phase === "result", "a rater can change their mind before the vote closes");
  ok(t.s.missions[p2].pts === Math.round(100 * (4 + 0 + 0) / 3 / 10), `a low average scores low (got ${t.s.missions[p2].pts})`);

  ok(runOut(t), "all four missions play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 2b
group("Today's Mission — players choose");
{
  const t = seatTable(TODAYS_MISSION, 4, { options: { mode: "choose" } });
  adv(500);
  ok(t.s.mode === "choose", "the host's choice reaches the game");
  ok(t.s.phase === "pick", "choose mode opens on picking");
  const hands = Object.values(t.s.offers).map(o => o.hand);
  ok(hands.every(h => h.length === MISSION.CHOICES && new Set(h).size === h.length), `everyone is offered ${MISSION.CHOICES} different cards`);
  t.input("p1", "pick", { idx: 2 }); t.input("p2", "pick", { idx: 0 }); t.input("p4", "pick", { idx: 1 });
  t.input("p4", "pick", { idx: 9 });          // out of range: ignored
  adv(3000);
  ok(t.s.phase === "pick", "it waits while someone is still choosing");
  ok(t.s.offers.p4.picked === 1, "an out-of-range pick is ignored");
  ok(waitPhase(t, "card", MISSION.PICK_MS + 5000), "the clock closes picking for the straggler");
  ok(t.s.missions.p1.task === t.s.offers.p1.hand[2], "you do the mission you picked");
  ok(t.s.offers.p3.hand.includes(t.s.missions.p3.task) && t.s.missions.p3.autoPicked, "a player who didn't pick gets one from their own hand");
  ok(runOut(t), "the game plays out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(TODAYS_MISSION, 3, { options: { mode: "choose" } });
  adv(500);
  for (const id of ["p1", "p2", "p3"]) t.input(id, "pick", { idx: 0 });
  adv(3000);
  ok(t.s.phase === "card", "everyone picking moves on without waiting for the clock");
}

// ===================================================================== 2c
group("Today's Mission — performer drops mid-mission");
{
  const t = seatTable(TODAYS_MISSION, 4);
  adv(500);
  const performer = t.s.order[0];
  t.drop(performer);
  adv(4000);
  ok(t.s.missions[performer].skipped === true, "a performer who leaves is skipped, not waited on");
  ok(runOut(t), "game still finishes");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 3
group("Humiliation Ritual — the automatic judge");
{
  const R = (answer, alt = []) => ({ answer, alt });
  const penguin = R("penguin", ["lost penguin", "sad penguin"]);
  ok(judge("penguin", penguin) === "correct", "exact answer");
  ok(judge("a PENGUIN!", penguin) === "correct", "case, punctuation and filler words don't matter");
  ok(judge("penguins", penguin) === "correct", "plurals");
  ok(judge("penquin", penguin) === "correct", "a one-letter typo");
  ok(judge("a penguin that lost its egg", penguin) === "correct", "the answer inside a longer guess");
  ok(judge("a horse", penguin) === "wrong", "a different thing");
  ok(judge("pen", penguin) === "wrong", "a fragment of the word is not enough");
  const dog = R("walking a dog", ["dog walk", "strong dog", "dog pulling"]);
  ok(judge("walking the dog", dog) === "correct", "different filler word");
  ok(judge("dog walking", dog) === "correct", "word order and -ing");
  ok(judge("a dog", dog) === "close", "half the answer is close, not correct");
  const bat = R("low battery", ["phone dying", "1 percent", "battery"]);
  ok(judge("battery", bat) === "correct", "an accepted alternate");
  ok(judge("my phone is dying", bat) === "correct", "an alternate in a longer guess");
  ok(judge("", bat) === "wrong" && judge("the", bat) === "wrong", "empty and filler-only guesses are wrong");
}

group("Humiliation Ritual (4 players)");
{
  const t = seatTable(HUMILIATION_RITUAL, 4);
  adv(500);
  ok(t.s.order.length === 4, "performers rotate through everyone");
  const r0 = t.s.rounds[0], perf = r0.performer;
  ok(waitPhase(t, "act"), "prep rolls into acting");
  const [g1, g2] = t.s.order.filter(x => x !== perf);
  t.input(g1, "guess", { text: "completely wrong" });
  adv(600);
  ok(t.s.rounds[0].guesses[0].verdict === "wrong", "a wrong guess is judged wrong");
  ok(t.s.phase === "act", "and the turn carries on");
  t.input(perf, "guess", { text: r0.answer });
  adv(300);
  ok(t.s.rounds[0].guesses.length === 1, "the performer can't guess their own prompt");
  t.input(g2, "guess", { text: r0.answer });
  adv(2000);
  ok(t.s.rounds[0].won?.by === g2 && t.s.rounds[0].won.how === "typed", "a correct typed guess wins on its own");
  ok(t.s.phase === "result", "the turn ends without the performer touching their phone");
  ok(t.s.players[g2].score === 100, `the guesser scores 100 (got ${t.s.players[g2].score})`);
  ok(t.s.players[perf].score > 60, `the performer scores 60 + speed bonus (got ${t.s.players[perf].score})`);

  // out loud: only the performer can confirm, never naming themselves
  ok(waitPhase(t, "act"), "next performer is up");
  const r1 = t.s.rounds[t.s.ri], perf1 = r1.performer;
  const other = t.s.order.find(x => x !== perf1);
  t.input(other, "heard", { who: other });
  adv(300);
  ok(!t.s.rounds[t.s.ri].won, "a guesser can't confirm an out-loud answer (they don't know the prompt)");
  t.input(perf1, "heard", { who: perf1 });
  adv(300);
  ok(!t.s.rounds[t.s.ri].won, "the performer can't credit themselves");
  t.input(perf1, "heard", { who: other });
  adv(2000);
  ok(t.s.rounds[1].won?.by === other && t.s.rounds[1].won.how === "out loud", "the performer confirms who said it out loud");
  ok(t.s.phase === "result", "and the turn ends");

  ok(runOut(t), "all four turns play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 4
group("The Art Gallery (4 players)");
{
  const t = seatTable(ART_GALLERY, 4);
  adv(500);
  ok(t.s.phase === "photos", "opens on filling frames");
  for (const c of t.clients) for (let i = 0; i < 3; i++) t.input(c.me.id, "photo", { pid: `${c.me.id}-${i}` });
  adv(4000);
  ok(t.s.phase === "title", "all photos in advances to titling");
  // every dealt photo gets exactly two titles from two DIFFERENT players
  const counts = {};
  for (const p of Object.values(t.s.players)) for (const pid of p.assigned) (counts[pid] ??= new Set()).add(p.id);
  ok(t.s.dealt.length > 0, `photos were dealt (${t.s.dealt.length})`);
  ok(t.s.dealt.every(pid => counts[pid]?.size === 2), "every dealt photo has exactly 2 writers");
  ok(t.s.dealt.every(pid => !counts[pid].has(t.s.pool[pid].owner)), "nobody titles their own photo");

  for (const p of Object.values(t.s.players)) for (const pid of p.assigned) t.input(p.id, "title", { pid, text: `title by ${p.id}` });
  adv(4000);
  ok(t.s.phase === "gallery", "titles in opens the gallery");
  ok(t.s.frames.length > 0 && t.s.frames.length <= 8, `frames are capped (${t.s.frames.length} <= 8)`);

  // vote through one frame: writers are excluded
  adv(5000);
  const f = t.s.frames[t.s.fi];
  const writers = f.titles.map(x => x.by);
  const voters = Object.keys(t.s.players).filter(x => !writers.includes(x));
  for (const v of voters) t.input(v, "vote", { idx: 0 });
  adv(4000);
  ok(t.s.frames[0].counts?.[0] === voters.length, "votes land on the chosen title");
  ok(t.s.frames[0].pts?.[0] === 100, "a clean sweep is worth the full 100");

  ok(runOut(t), "the gallery plays out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 5
group("Manhunt (5 players)");
{
  const t = seatTable(MANHUNT_GAME, 5);
  adv(500);
  const P = Object.values(t.s.players);
  const hunters = P.filter(p => p.role === "hunter"), runners = P.filter(p => p.role === "runner");
  ok(hunters.length === 1, `~1 hunter per 4-5 players (5 players -> ${hunters.length})`);
  ok(runners.length === 4, "everyone else runs");
  ok(t.s.phase === "headstart", "runners get a head start");
  ok(t.s.sites.length === MANHUNT.SITES.length, "bomb sites come from config");

  // the state must never carry a coordinate — cells only
  const json = JSON.stringify(t.s);
  ok(!/"lat"|"lng"/.test(json), "no lat/lng anywhere in the broadcast state");
  ok(!/"cell"/.test(json) || !t.s.players[runners[0].id].cell, "per-player cells are not in the state");

  adv(MANHUNT.HEADSTART_MS + 2000);
  ok(t.s.phase === "hunt", "the hunt opens after the head start");

  // defusing: a runner reports standing in a zone, 20 s fills the bar
  const r0 = runners[0].id, site = t.s.sites[0].id;
  for (let i = 0; i < 12; i++) { t.input(r0, "zone", { site }); adv(2000); }
  ok(t.s.sites[0].defused === true, "standing in a zone for ~20 s defuses the bomb");
  ok(t.s.radar.pings.length > 0, "defusing pings the site's cell to the hunters");
  ok(t.s.sites[0].by === r0, "the defuser is credited");

  // leaving the zone resets an unfinished defuse
  const site2 = t.s.sites[1].id;
  t.input(runners[1].id, "zone", { site: site2 }); adv(4000);
  const partial = t.s.sites[1].progress;
  ok(partial > 0 && partial < 1, `partial progress accrues (${partial.toFixed(2)})`);
  t.input(runners[1].id, "zone", { site: null }); adv(8000);
  ok(t.s.sites[1].progress === 0, "walking away resets the progress bar");

  // tagging: hunter nominates, runner confirms, runner becomes a hunter
  t.input(hunters[0].id, "tag", { target: r0 });
  adv(500);
  ok(t.s.pending?.target === r0, "the tag waits on the runner's confirmation");
  t.input(runners[1].id, "tagack", { yes: true });
  adv(500);
  ok(t.s.players[r0].tagged === false, "only the targeted runner can answer");
  t.input(r0, "tagack", { yes: false });
  adv(500);
  ok(t.s.pending === null && t.s.players[r0].tagged === false, "saying no clears the tag and keeps them running");
  t.input(hunters[0].id, "tag", { target: r0 });
  adv(300);
  t.input(r0, "tagack", { yes: true });
  adv(500);
  ok(t.s.players[r0].tagged === true && t.s.players[r0].role === "hunter", "a tagged runner joins the hunters");

  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 5b
group("Manhunt — win conditions");
{
  // runners win: every bomb defused
  const t = seatTable(MANHUNT_GAME, 5);
  adv(MANHUNT.HEADSTART_MS + 2000);
  const runners = Object.values(t.s.players).filter(p => p.role === "runner");
  for (const site of t.s.sites.map(x => x.id)) {
    for (let i = 0; i < 12; i++) { t.input(runners[0].id, "zone", { site }); adv(2000); }
  }
  ok(t.s.winner === "runners", `all bombs defused -> runners win (got ${t.s.winner})`);
  ok(t.s.phase === "end", "the game ends on the win");
  ok(runOut(t), "results close out");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // hunters win: every runner tagged
  const t = seatTable(MANHUNT_GAME, 5);
  adv(MANHUNT.HEADSTART_MS + 2000);
  const hunter = Object.values(t.s.players).find(p => p.role === "hunter").id;
  for (const r of Object.values(t.s.players).filter(p => p.role === "runner").map(p => p.id)) {
    t.input(hunter, "tag", { target: r }); adv(400);
    t.input(r, "tagack", { yes: true }); adv(400);
  }
  ok(t.s.winner === "hunters", `all runners tagged -> hunters win (got ${t.s.winner})`);
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // hunters win on the clock with a bomb still live
  const t = seatTable(MANHUNT_GAME, 5);
  adv(MANHUNT.HEADSTART_MS + 2000);
  adv(MANHUNT.GAME_MS + 5000);
  ok(t.s.winner === "hunters", `clock out with a live bomb -> hunters win (got ${t.s.winner})`);
  ok(/bomb still live/.test(t.s.why ?? ""), "the reason is reported");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  // works from 4 for testing
  const t = seatTable(MANHUNT_GAME, 4);
  adv(500);
  ok(Object.values(t.s.players).filter(p => p.role === "hunter").length === 1, "4 players still yields a hunter");
  ok(Object.values(t.s.players).filter(p => p.role === "runner").length === 3, "and three runners");
}

// ===================================================================== kit
group("Shared kit");
{
  const html = resultsHtml([
    { id: "a", handle: "ana", score: 120 },
    { id: "b", handle: "bo", score: 300 },
    { id: "c", handle: "cy", score: 50, gone: true },
  ], { title: "Test", sub: "final", note: "note" });
  ok(html.indexOf("bo") < html.indexOf("ana"), "results are ranked by score");
  ok((html.match(/hp-av/g) ?? []).length === 3, "every player gets an avatar");
  ok(/300/.test(html) && /120/.test(html), "scores are shown");
  ok(/hp-left/.test(html), "a player who left is marked");

  // regression: the bootstrap enter() must not fire the first phase's exit
  let exits = 0;
  const R = new Rounds([{ name: "a", ms: 1000, exit: () => exits++, next: () => "b" }, { name: "b", ms: 1000, next: () => null }]);
  const st = { phase: "a" };                  // a game's initial state names its first phase
  R.enter(st, "a");
  ok(exits === 0, "entering the first phase doesn't run its exit hook");
  R.hostStep(st, 1.5);
  ok(st.phase === "b" && exits === 1, "leaving it does — exactly once");
  const handover = JSON.parse(JSON.stringify({ ...st, phase: "a", _rp: "a" }));
  R.enter(handover, "b");
  ok(exits === 2, "and still does after a host handover (the marker travels in the state)");

  let cleaned = 0;
  window.__hpTrashLog = false;
  trash.add(() => cleaned++);
  trash.add(() => cleaned++);
  trash.flush("spec");
  ok(cleaned === 2, "cleanup runs every registered disposer");
  trash.flush("spec again");
  ok(cleaned === 2, "flushing twice does not re-run disposers");
}

// ===================================================================== cleanup
group("Cleanup — nothing survives the party");
{
  // party.js flushes the bin when a game ends and when you leave the party.
  // Everything a game wrote must be gone afterwards, including the state on
  // HostGame's debug handle.
  const t = seatTable(SECRET_DIARY, 3);
  waitPhase(t, "answer", 8000);
  const ty = t.s.cur.type;
  for (const c of t.clients) t.input(c.me.id, "answer", ty === "written" ? { text: `secret of ${c.me.id}` } : { yn: "yes" });
  adv(600);
  const host = t.host;
  ok(Object.values(host.game.s.players).some(p => p.answer !== null) || (host.game.s.entries?.length ?? 0) > 0, "answers exist while the game is running");
  ok(window.__game !== null, "the debug handle is live during play");
  trash.flush("spec: party ended");
  ok(host.game.s === null, "the game state is dropped on cleanup");
  ok(window.__game === null, "the debug handle no longer pins the state");
}

log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
