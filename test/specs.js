// House-party specs. Plays every game end to end on the fake bus + virtual
// clock and asserts the rules the brief actually names.
import { installClock, seatTable } from "/test/harness.js";
import { SECRET_DIARY } from "/web/hpgames/secretdiary.js";
import { TODAYS_MISSION } from "/web/hpgames/mission.js";
import { HUMILIATION_RITUAL } from "/web/hpgames/ritual.js";
import { MANHUNT_GAME } from "/web/hpgames/manhunt.js";
import { ART_GALLERY } from "/web/artgallery.js";
import { MANHUNT } from "/web/hpconfig.js";
import { resultsHtml, trash } from "/web/hpkit.js";

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
group("Secret Diary (3 players, plays end to end)");
{
  const t = seatTable(SECRET_DIARY, 3);
  adv(500);
  ok(t.s?.phase === "write", "opens in the write phase");
  ok(typeof t.s.prompt === "string" && t.s.prompt.length > 10, "a prompt was dealt");
  ok(!t.s.prompt.includes("{{player}}"), "the {{player}} token was substituted");

  for (const c of t.clients) t.input(c.me.id, "write", { text: `entry from ${c.me.id}` });
  adv(3000);
  ok(t.s.phase === "reveal", "everyone writing early advances the phase");
  ok(t.s.entries.length === 3, "all three entries went into the pool");
  ok(t.s.entries.every(e => !("by" in e)), "entries carry no author field");

  adv(12000);
  ok(t.s.phase === "match", "reveal rolls into matching");

  // p1 guesses everything right, p2 everything wrong, p3 abstains
  const author = eid => Object.values(t.s.players).find(p => p.myEid === eid)?.id;
  const others = id => t.s.entries.filter(e => e.eid !== t.s.players[id].myEid);
  for (const e of others("p1")) t.input("p1", "guess", { eid: e.eid, who: author(e.eid) });
  for (const e of others("p2")) {
    const wrong = Object.keys(t.s.players).find(x => x !== author(e.eid));
    t.input("p2", "guess", { eid: e.eid, who: wrong });
  }
  adv(MATCH_DRAIN);
  ok(t.s.phase === "end", "matching ends");
  ok(t.s.players.p1.score === 2, `all-correct scores 2/2 (got ${t.s.players.p1.score})`);
  ok(t.s.players.p2.score === 0, `all-wrong scores 0 (got ${t.s.players.p2.score})`);
  ok(t.s.players.p3.score === 0, "abstaining scores 0");

  // the answers are never revealed: no screen names an author
  const panel = document.getElementById("game-panel").innerHTML;
  ok(t.s.entries.every(e => !panel.includes(e.text)), "the results screen shows no entry text, so nothing can be attributed");
  ok(!/wrote|author|by p\d/i.test(panel), "and names no authors");
  ok(runOut(t), "game ends for everyone");
  ok(t.errors().length === 0, "no render/host errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 1b
group("Secret Diary — drop-safety and odd counts");
{
  const t = seatTable(SECRET_DIARY, 5);
  adv(500);
  for (const id of ["p1", "p2", "p3", "p4", "p5"]) t.input(id, "write", { text: `x ${id}` });
  adv(3000);
  ok(t.s.entries.length === 5, "odd player count (5) deals fine");
  adv(12000);
  // p4 walks out mid-match without answering anything
  t.drop("p4");
  adv(2000);
  ok(t.s.players.p4.gone === true, "a dropped player is marked gone");
  const author = eid => Object.values(t.s.players).find(p => p.myEid === eid)?.id;
  for (const id of ["p1", "p2", "p3", "p5"]) {
    for (const e of t.s.entries.filter(e => e.eid !== t.s.players[id].myEid))
      t.input(id, "guess", { eid: e.eid, who: author(e.eid) });
  }
  adv(8000);
  ok(t.s.phase === "end", "the round still completes early without the dropped player");
  ok(t.s.players.p1.score === 4, `remaining players still score (p1 = ${t.s.players.p1.score}/4)`);
  ok(t.s.entries.length === 5, "the leaver's entry stays in the pool and stays guessable");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 2
group("Today's Mission (4 players)");
{
  const t = seatTable(TODAYS_MISSION, 4);
  adv(500);
  ok(t.s.order.length === 4, "everyone gets a mission");
  ok(Object.values(t.s.missions).every(m => m.task && m.task.length > 10), "every mission has a task");
  ok(t.s.phase === "card", "opens on the mission card");

  const performer = t.s.order[0];
  const voters = t.s.order.filter(x => x !== performer);
  ok(waitPhase(t, "do"), "the card rolls into doing it");
  t.input(performer, "claim");
  adv(3000);
  ok(t.s.phase === "vote", "claiming done advances to the vote");

  // performer's own vote must be ignored
  t.input(performer, "vote", { ok: true, style: true });
  adv(500);
  ok(t.s.missions[performer].votes[performer] === undefined, "the performer cannot vote on themselves");

  for (const v of voters) t.input(v, "vote", { ok: true, style: v === voters[0] });
  adv(3000);
  ok(t.s.phase === "result", "all votes in ends the vote");
  const m = t.s.missions[performer];
  ok(m.done === true, "unanimous yes = completed");
  ok(m.pts === 60 + Math.round(40 * 1 / 3), `60 for completing + style share (got ${m.pts})`);
  ok(t.s.players[performer].score === m.pts, "points land on the performer");

  // a failed mission scores nothing
  ok(waitPhase(t, "card"), "the next player's card comes up");
  const p2 = t.s.order[1];
  ok(waitPhase(t, "do"), "and rolls into doing it");
  t.input(p2, "claim"); adv(2000);
  for (const v of t.s.order.filter(x => x !== p2)) t.input(v, "vote", { ok: false, style: false });
  adv(3000);
  ok(t.s.missions[p2].done === false && t.s.missions[p2].pts === 0, "majority no = no points");

  ok(runOut(t), "all four missions play out and the game ends");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 2b
group("Today's Mission — performer drops mid-mission");
{
  const t = seatTable(TODAYS_MISSION, 4);
  adv(500);
  const performer = t.s.order[0];
  t.drop(performer);
  adv(4000);
  ok(t.s.missions[performer].skipped === true, "a performer who leaves is skipped, not waited on");
  ok(t.s.phase === "result" || t.s.phase === "card", "the game moves on");
  ok(runOut(t), "game still finishes");
  ok(t.errors().length === 0, "no errors: " + (t.errors()[0] ?? "none"));
}

// ===================================================================== 3
group("Humiliation Ritual (4 players)");
{
  const t = seatTable(HUMILIATION_RITUAL, 4);
  adv(500);
  ok(t.s.order.length === 4, "performers rotate through everyone");
  const r0 = t.s.rounds[0], perf = r0.performer;
  ok(!!r0.prompt && !!r0.answer, "the performer's prompt has an answer to match against");

  adv(7000);
  ok(t.s.phase === "act", "prep rolls into acting");
  const guesser = t.s.order.find(x => x !== perf);
  t.input(guesser, "guess", { text: "completely wrong" });
  t.input(guesser, "guess", { text: r0.answer });
  adv(600);
  ok(t.s.rounds[0].guesses.length === 2, "guesses stream in live");
  ok(t.s.rounds[0].guesses[1].near === true, "an exact answer is flagged as near");
  ok(t.s.rounds[0].guesses[0].near === false, "nonsense is not flagged");

  // the performer cannot guess, and a non-performer cannot accept
  t.input(perf, "guess", { text: "me guessing" });
  adv(300);
  ok(t.s.rounds[0].guesses.length === 2, "the performer's own guesses are rejected");
  t.input(guesser, "accept", { gid: t.s.rounds[0].guesses[1].gid });
  adv(300);
  ok(t.s.rounds[0].won === null, "only the performer can accept a guess");

  t.input(perf, "accept", { gid: t.s.rounds[0].guesses[1].gid });
  adv(2000);
  ok(t.s.phase === "result", "accepting ends the turn immediately");
  ok(t.s.players[guesser].score === 100, `the guesser scores 100 (got ${t.s.players[guesser].score})`);
  ok(t.s.players[perf].score >= 60, `the performer scores 60+ speed bonus (got ${t.s.players[perf].score})`);
  ok(t.s.rounds[0].perfPts > 60, "landing it fast earns a speed bonus");

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
  for (const c of t.clients) t.input(c.me.id, "write", { text: `secret of ${c.me.id}` });
  adv(3000);
  const host = t.host;
  ok(host.game.s.entries.length === 3, "entries exist while the game is running");
  ok(window.__game !== null, "the debug handle is live during play");
  trash.flush("spec: party ended");
  ok(host.game.s === null, "the game state is dropped on cleanup");
  ok(window.__game === null, "the debug handle no longer pins the state");
}

log("head", `\n${pass} passed, ${fail} failed`);
window.__done = { pass, fail };
