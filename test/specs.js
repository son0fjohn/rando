// House-party specs. Plays every game end to end on the fake bus + virtual
// clock and asserts the rules the brief actually names.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY } from "/web/hpgames/secretdiary.js";
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
group("Secret Diary (3 players, 5 prompts, plays end to end)");
{
  const t = seatTable(SECRET_DIARY, 3);
  adv(500);
  ok(t.s?.phase === "write", "opens in the write phase");
  ok(t.s.prompts.length === DIARY.PROMPTS, `a round deals ${DIARY.PROMPTS} prompts (got ${t.s.prompts.length})`);
  ok(new Set(t.s.prompts).size === t.s.prompts.length, "the prompts are all different");
  ok(t.s.prompts.every(p => !p.includes("{{player}}")), "every {{player}} token was substituted");

  // nothing is revealed until every prompt is answered
  for (const c of t.clients) for (let pi = 0; pi < 4; pi++) t.input(c.me.id, "write", { pi, text: `${c.me.id} answer ${pi}` });
  adv(5000);
  ok(t.s.phase === "write", "4 of 5 answered: still writing, nothing revealed");
  ok(t.s.entries.length === 0, "no entries exist before writing closes");
  for (const c of t.clients) t.input(c.me.id, "write", { pi: 4, text: `${c.me.id} answer 4` });
  adv(3000);
  ok(t.s.phase === "reveal", "the 5th answer from everyone opens the reveal");
  ok(t.s.entries.length === 15, `3 players x 5 prompts = 15 entries (got ${t.s.entries.length})`);
  ok(t.s.entries.every(e => !("by" in e) && Number.isInteger(e.pi)), "entries carry their prompt and no author");
  ok(t.s.left >= 14000, `the reveal gives time to read (${Math.round(t.s.left / 1000)} s)`);

  ok(waitPhase(t, "match"), "reveal rolls into matching");
  const author = eid => Object.values(t.s.players).find(p => Object.values(p.mine).includes(eid))?.id;
  const others = id => t.s.entries.filter(e => !Object.values(t.s.players[id].mine).includes(e.eid));
  ok(others("p1").length === 10, "each player matches the 10 entries that aren't theirs");
  for (const e of others("p1")) t.input("p1", "guess", { eid: e.eid, who: author(e.eid) });
  for (const e of others("p2")) t.input("p2", "guess", { eid: e.eid, who: Object.keys(t.s.players).find(x => x !== author(e.eid)) });
  ok(waitPhase(t, "end", DIARY.MATCH_MS + 20000), "matching ends (p3 abstains, so on the clock)");
  ok(t.s.players.p1.score === 10, `all-correct scores 10/10 (got ${t.s.players.p1.score})`);
  ok(t.s.players.p2.score === 0, `all-wrong scores 0 (got ${t.s.players.p2.score})`);
  ok(t.s.players.p3.score === 0, "abstaining scores 0");

  adv(1500);      // let every client receive the end snapshot and redraw
  const panel = document.getElementById("game-panel").innerHTML;
  ok(t.s.entries.every(e => !panel.includes(e.text)), "the results screen shows no entry text, so nothing can be attributed");
  ok(!panel.includes("sd-entry") && !panel.includes("sd-match"), "and has no entry or matching cards on it — names and scores only");
  ok(runOut(t), "game ends for everyone");
  ok(t.errors().length === 0, "no render/host errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 1b
group("Secret Diary — drop-safety, odd counts, partial answers");
{
  const t = seatTable(SECRET_DIARY, 5);
  adv(500);
  for (const id of ["p1", "p2", "p3", "p4", "p5"]) for (let pi = 0; pi < 5; pi++) t.input(id, "write", { pi, text: `x ${id} ${pi}` });
  adv(3000);
  ok(t.s.entries.length === 25, "odd player count (5) deals 25 entries");
  ok(waitPhase(t, "match"), "into matching");
  t.drop("p4");
  adv(2000);
  ok(t.s.players.p4.gone === true, "a dropped player is marked gone");
  const author = eid => Object.values(t.s.players).find(p => Object.values(p.mine).includes(eid))?.id;
  for (const id of ["p1", "p2", "p3", "p5"])
    for (const e of t.s.entries.filter(e => !Object.values(t.s.players[id].mine).includes(e.eid)))
      t.input(id, "guess", { eid: e.eid, who: author(e.eid) });
  adv(8000);
  ok(t.s.phase === "end", "the round completes early without the dropped player");
  ok(t.s.players.p1.score === 20, `remaining players still score (p1 = ${t.s.players.p1.score}/20)`);
  ok(t.s.entries.length === 25, "the leaver's entries stay in the pool and stay guessable");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}
{
  const t = seatTable(SECRET_DIARY, 3);
  adv(500);
  for (const id of ["p1", "p2"]) for (let pi = 0; pi < 5; pi++) t.input(id, "write", { pi, text: `${id} ${pi}` });
  t.input("p3", "write", { pi: 0, text: "p3 only answered one" });
  t.input("p3", "write", { pi: 7, text: "out of range" });
  ok(waitPhase(t, "reveal", DIARY.WRITE_MS_PER_PROMPT * DIARY.PROMPTS + 10000), "a slow writer doesn't block the reveal past the clock");
  ok(t.s.entries.length === 11, `a partial writer's answers still count (${t.s.entries.length} = 5 + 5 + 1)`);
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
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
  adv(500);
  for (const c of t.clients) for (let pi = 0; pi < DIARY.PROMPTS; pi++) t.input(c.me.id, "write", { pi, text: `secret ${pi} of ${c.me.id}` });
  adv(3000);
  const host = t.host;
  ok(host.game.s.entries.length === 3 * DIARY.PROMPTS, "entries exist while the game is running");
  ok(window.__game !== null, "the debug handle is live during play");
  trash.flush("spec: party ended");
  ok(host.game.s === null, "the game state is dropped on cleanup");
  ok(window.__game === null, "the debug handle no longer pins the state");
}

log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
