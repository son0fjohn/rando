// End-to-end party test: three "phones" (pages in one browser context) form a
// real party over the BroadcastChannel stub and play through the lobby and
// three games by clicking and typing in the real UI. Real party.js, net.js,
// hplobby.js, game modules and the app's real CSS (injected from
// web/index.html). Saves phone-sized screenshots for eyeballing the layout.
//
//   node test/party_e2e.mjs [screenshot-dir] [--browser=webkit]
//
// Runs in real time (≈2 min): it's the one place the party flow is exercised
// as a whole, so it trades speed for realism.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium, webkit, devices } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = process.argv.slice(2).find(a => !a.startsWith("--")) ?? null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".json": "application/json" };

// the app's real stylesheet, lifted out of index.html
const indexHtml = await readFile(join(ROOT, "web/index.html"), "utf8");
const CSS = indexHtml.slice(indexHtml.indexOf("<style>"), indexHtml.indexOf("</style>") + "</style>".length);

const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    let body = await readFile(p);
    if (p.endsWith("test/hpparty.html")) body = Buffer.from(body.toString().replace("<!--INDEX_CSS-->", CSS));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// --browser=webkit runs the same party on Safari's engine with Playwright's
// iPhone profile (viewport, touch, Mobile Safari user agent). It's the closest
// thing to iOS Safari that runs on Linux — CI runs both.
const ENGINE = (process.argv.find(a => a.startsWith("--browser="))?.split("=")[1]) ?? "chromium";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = ENGINE === "webkit"
  ? await webkit.launch()
  : await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] });
const ctx = ENGINE === "webkit"
  ? await browser.newContext({ ...devices["iPhone 15"] })
  : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
console.log(`engine: ${ENGINE}${ENGINE === "webkit" ? " (iPhone 15 profile)" : ""}`);

let pass = 0, fail = 0;
// On GitHub Actions a failure is also written as an ::error annotation, so it
// shows on the PR's checks (and through the API) without opening the log.
const annotate = m => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=party e2e (${ENGINE})::${m.replace(/\n/g, " ")}`); };
let section = "start", lastCheck = "none yet";
const ok = (c, m) => { lastCheck = m; if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); annotate(`${section}: ${m}`); } };
const head = m => { section = m; console.log("\n" + m); };
// A stuck wait must fail the run with a reason, not sit until the CI job's
// 20-minute limit kills it with no output.
setTimeout(() => {
  const m = `timed out after 17 min in "${section}" (last check: ${lastCheck})`;
  console.log("  ✗ " + m); annotate(m); process.exit(1);
}, 17 * 60_000).unref();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
async function phone(name, qs = "") {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("console", m => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await pg.goto(`${base}/test/hpparty.html?me=${name}${qs}`);
  await pg.waitForFunction(() => window.__ready);
  pg.label = name;
  return pg;
}
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const text = (pg, sel) => pg.locator(sel).first().innerText().catch(() => "");
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const stageTitle = pg => text(pg, "#game-panel .stage h2, #game-panel .hp-res-title, #game-panel .np-title");
// the host starts a game from the votes list
const startGame = async (pg, id) => { await pg.click("#pt-vote"); await pg.click(`[data-game="${id}"] .pv-t > b`); };   // the title: the row middle can be an option chip
// the host taps "skip ahead" until `done(title)` holds on `watch`
async function skipUntil(host, watch, done, tries = 12) {
  for (let i = 0; i < tries; i++) {
    if (done(await stageTitle(watch))) return true;
    const b = host.locator("#hp-skip");
    if (await b.count()) await b.first().click().catch(() => {});
    await sleep(900);
  }
  return done(await stageTitle(watch));
}

try {
  // ------------------------------------------------------------------ create
  head("Party: create, join by link, join by code");
  const A = await phone("alice");
  await A.click("#party-btn");
  await A.fill("#pt-name", "Saturday night");
  await A.click('[data-vibe="chaotic"]');
  await A.click("#pt-create");
  ok(await until(A, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? "")), "host creates a party and gets a 4-character code");
  const code = await text(A, "#pt-code-chip");
  ok((await text(A, "#pt-title")) === "Saturday night", "the party has the name the host gave it");
  ok(await A.locator("#party-panel.pt-lobby").isVisible(), "the lobby is a full-screen room");
  ok(await until(A, () => document.querySelector("#pt-floor .lr-stage")?.dataset.vibe === "chaotic" && !!document.querySelector("#pt-floor .lr-window")), "the room is the drawn apartment, in the chaotic vibe's neon");
  ok(await A.evaluate(() => [...document.querySelectorAll("#pt-floor .lr-furn")].map(f => f.dataset.slot).sort().join()) === "lamp,tv", "its standing furniture comes from named slots (the TV, the lamp)");

  const B = await phone("bob", `&party=${code}`);
  ok(await until(B, () => document.querySelectorAll(".lr-av").length === 2, null, 20000), "a friend joins straight from the share link");
  ok(await until(A, () => document.querySelectorAll(".lr-av").length === 2), "the host sees them arrive in the room");
  ok(await until(B, () => document.getElementById("pt-title")?.textContent === "Saturday night"), "the joiner gets the party name from the host");

  // ------------------------------------------------------------------ voting with too few
  head("Lobby: players vote for the next game, the host sees the votes");
  ok(await until(B, () => /Vote next game/.test(document.getElementById("pt-vote")?.textContent ?? "")) && /Game votes/.test(await text(A, "#pt-vote")), "players get 'Vote next game', the host gets 'Game votes'");
  ok(!(await A.locator("#navbar:visible").count()) && !(await B.locator("#navbar:visible").count()), "no navigation bar in the lobby");
  await B.click("#pt-vote");
  ok(await B.locator("#pt-picker").isVisible() && /Vote for the next game/.test(await text(B, ".pt-picker-head")), "a player opens the game list to vote");
  await B.click('[data-vote="mask_off"]');
  ok(await until(B, () => document.querySelector('[data-vote="mask_off"]')?.classList.contains("mine")), "their vote is marked");
  await A.click("#pt-vote");
  ok(await A.locator("#pt-picker").isVisible() && /Game votes/.test(await text(A, ".pt-picker-head")), "the host opens 'Game votes'");
  const ORDER = "artgallery,secretdiary,sidequest,ritual,mask_off,manhunt";
  ok(await B.evaluate(() => [...document.querySelectorAll(".pv-list .pv-row")].map(r => r.dataset.vote).join(",")) === ORDER, "the players' list is in the one order: Art Gallery, Secret Diary, Side Quest, Ritual, Mask Off, Manhunt");
  await shot(B, "vote-player");
  ok(await until(A, () => document.querySelector('[data-game="mask_off"]')?.classList.contains("lead") && /^1/.test(document.querySelector('[data-game="mask_off"] .pv-n')?.textContent ?? "")), "the host sees the vote live, the leader marked");
  ok(await A.evaluate(() => [...document.querySelectorAll(".pv-list .pv-row")].map(r => r.dataset.game).join(",")) === ORDER, "…in the same order (votes never re-sort it)");
  await shot(A, "vote-host");
  await B.click('[data-vote="ritual"]');
  ok(await until(A, () => document.querySelector('[data-game="ritual"]')?.classList.contains("lead") && /^0/.test(document.querySelector('[data-game="mask_off"] .pv-n')?.textContent ?? "")), "a player can change their vote: one vote each, the tally follows");
  await A.click('[data-opt="rounds"][data-val="2"][data-for="ritual"]');
  ok(await until(A, () => document.querySelector('[data-opt="rounds"][data-val="2"][data-for="ritual"]')?.classList.contains("on")), "the host sets a game's options right in the list (the Ritual: twice each)");
  await A.click('[data-opt="rounds"][data-val="1"][data-for="ritual"]');
  ok(!(await A.locator('[data-for="mask_off"]').count()), "Mask Off has none there: its deck is set on its own setup screen");
  await A.click('[data-game="mask_off"] .pv-t > b');
  ok(await until(A, () => /needs 1 more/i.test(document.getElementById("pv-err")?.textContent ?? "")) && !(await A.evaluate(() => window.party.current.launched)), "starting waits for the minimum: 'needs 1 more'");
  await sleep(300);
  await shot(A, "01-host-votes");
  await shot(B, "01b-player-vote");
  await A.click("#pt-picker-x");
  ok(await A.locator("#pt-picker").isHidden(), "the host closes the list");
  await B.locator("#pt-picker").click({ position: { x: 20, y: 30 } });
  ok(await B.locator("#pt-picker").isHidden(), "tapping the dimmed backdrop closes it too");
  ok(await until(B, () => /you voted Humiliation Ritual/.test(document.getElementById("pt-next")?.textContent ?? "")), "the player's status line shows their vote");

  const C = await phone("cy");
  await C.click("#party-btn");
  await C.fill("#pt-code", code);
  await C.press("#pt-code", "Enter");
  ok(await until(C, () => document.querySelectorAll(".lr-av").length === 3, null, 20000), "a third friend joins by typing the code");
  await A.click("#pt-vote");
  ok(await until(A, () => !document.querySelector('[data-game="mask_off"]')?.classList.contains("short")), "with 3 players, every 3+ game can start");
  await A.click("#pt-picker-x");

  // ------------------------------------------------------------------ walk + chat
  head("Lobby: walking around and talking");
  // positions are room (backdrop) pixels: the apartment is 704x1200
  const standing = (pg, id) => pg.evaluate(id => window.party.current.lobby.where(id), id);
  const before = await standing(B, "u-alice");
  const sb = await A.locator("#pt-floor .lr-stage").boundingBox();
  const [RW, RH] = await A.evaluate(() => { const R = window.party.current.lobby.R; return [R.w, R.h]; });
  const target = [520, 1000];                         // open floor near the front right
  await A.mouse.click(sb.x + sb.width * target[0] / RW, sb.y + sb.height * target[1] / RH);
  ok(await until(B, () => window.party.current.lobby.where("u-alice")?.walking), "a tap walks you, and the others see you walking");
  await sleep(6000);
  // a background tab may not draw frames at all (WebKit); look at bob's
  // phone the way bob would, in front
  await B.bringToFront(); await sleep(400);
  const onB = await standing(B, "u-alice");
  await A.bringToFront();
  const onA = await standing(A, "u-alice");
  ok(Math.hypot(onA.x - target[0], onA.y - target[1]) < 40, `you walk to where you tapped (${Math.round(before.x)},${Math.round(before.y)} -> ${Math.round(onA.x)},${Math.round(onA.y)})`);
  ok(Math.hypot(onA.x - onB.x, onA.y - onB.y) < 2, "everyone sees you end up in the same spot");
  await B.fill("#pt-chat-input", "who's ready??");
  await B.press("#pt-chat-input", "Enter");
  ok(await until(A, () => { const b = document.querySelector('.lr-av[data-id="u-bob"] .lr-bubble'); return b && !b.hidden && /ready/.test(b.textContent); }), "chat shows as a speech bubble over the speaker");
  await sleep(1400);
  await shot(A, "02-lobby-host");
  await shot(B, "03-lobby-guest");

  // ------------------------------------------------------------------ Mask Off
  head("Mask Off — a hand of questions, answered out loud, Same and Go deeper, no scores");
  await startGame(A, "mask_off");
  ok(await until(A, () => !!document.getElementById("mo-go") && !document.getElementById("hp-back").hidden), "the host sets the deck first, with Back (top-left)");
  ok(await until(B, () => document.body.classList.contains("hp-setup-wait")), "…while everyone else waits in the lobby");
  ok(await A.evaluate(() => [...document.querySelectorAll("[data-lv].on")].map(b => b.dataset.lv).join() === "1,2" && document.querySelector('[data-rounds="2"]')?.classList.contains("on")), "default: light + real, everyone answers twice");
  await A.click('[data-lv="3"]');
  await A.click('[data-rounds="1"]');
  ok(await until(A, () => document.querySelectorAll("[data-lv].on").length === 3 && /3 turns/.test(document.getElementById("mo-go")?.textContent ?? "")), "the host adds deep and sets everyone once (3 turns)");
  await A.click("#mo-go");
  const mo = () => A.evaluate(() => window.__game?.s ?? null);
  ok(await until(B, () => !document.getElementById("game-layer").hidden && /asking/.test(document.querySelector(".mo-line")?.textContent ?? ""), null, 10000), "everyone sees who's asking whom");
  ok(await A.evaluate(() => !document.getElementById("party-panel").hidden && document.getElementById("party-panel").classList.contains("pt-behind")), "it's played over the dimmed party room, not the map");
  ok(await until(A, () => window.__game?.s?.phase === "choose", null, 10000), "the asker picks a question");
  const ids = { "u-alice": A, "u-bob": B, "u-cy": C };
  const t1 = (await mo()).turn;
  const asker = ids[t1.asker], who = ids[t1.who], third = [A, B, C].find(pg => pg !== asker && pg !== who);
  ok(asker && who && asker !== who, `${t1.asker} → asking ${t1.who}`);
  ok(await until(asker, () => document.querySelectorAll("[data-ask]").length === 5), "the asker browses their hand of 5");
  ok(await until(third, () => /choosing a question/.test(document.querySelector(".mo-wait .mo-line")?.textContent ?? "")) && !(await who.locator("[data-ask]").count()) && !(await third.locator("[data-ask]").count()), "nobody else sees it: 'choosing a question…'");
  await shot(asker, "04-maskoff-hand");
  const picked = await asker.locator("[data-ask]").nth(1).getAttribute("data-ask");
  await asker.locator("[data-ask]").nth(1).click();
  ok(await until(who, id => document.querySelector(".mo-card .mo-text")?.textContent && window.__game?.s?.turn?.card?.id === id, picked, 8000), "the card flips up on every screen");
  ok(/asks/.test(await text(third, ".mo-ask")) && await who.locator("#mo-answer").isVisible() && await who.locator("#mo-pass").isVisible(), "with both names; the answerer gets Answer or Pass");
  ok(!(await third.locator("#mo-same").count()), "Same waits until they start answering");
  await who.click("#mo-answer");
  ok(await until(third, () => document.querySelector(".mo-masked")?.classList.contains("off")), "Answer: their mask slides off on everyone's screen");
  await third.click("#mo-same");
  ok(await until(third, () => document.getElementById("mo-same")?.classList.contains("on")), "a listener taps Same");
  await asker.click("#mo-same");
  await asker.click("#mo-deep");
  ok(await until(who, () => !!document.getElementById("mo-dtake")), "Go deeper: the answerer gets a gentle follow-up to take or pass");
  await shot(who, "05-maskoff-deeper");
  await who.click("#mo-dtake");
  ok(await until(third, () => /going deeper/i.test(document.querySelector(".mo-deeper")?.textContent ?? "")), "they take it: everyone sees it");
  await who.click("#mo-done");
  ok(await until(third, () => /2 people felt this too/.test(document.querySelector(".mo-after")?.textContent ?? ""), null, 8000), "Done: '2 people felt this too'");
  ok(!/(alice|bob|cy) (tapped|felt)/i.test(await text(who, ".mo-after")), "never who tapped");
  await shot(who, "06-maskoff-same");
  const after1 = await mo();
  ok(after1.hands[t1.asker].length === 5 && !after1.hands[t1.asker].includes(picked), "the asker's hand refills to 5");
  ok(!JSON.stringify(after1).match(/"(votes|avg|verdict|pts)"/), "no ratings, no points in the game");
  // a pass
  ok(await until(A, () => window.__game?.s?.phase === "choose" && window.__game.s.ti === 1, null, 15000), "the next turn");
  const t2 = (await mo()).turn;
  await ids[t2.asker].locator("[data-ask]").first().click();
  ok(await until(ids[t2.who], () => !!document.getElementById("mo-pass"), null, 8000), "asked");
  await ids[t2.who].click("#mo-pass");
  ok(await until(ids[t2.who], () => /mask stays on/.test(document.querySelector(".mo-after")?.textContent ?? ""), null, 8000), "Pass: the mask stays on, no penalty, on to the next");
  // through to the end
  for (let i = 0; i < 30 && (await mo())?.phase !== "end"; i++) { await A.locator("#hp-skip").first().click().catch(() => {}); await sleep(700); }
  ok(await until(A, () => /masks off/.test(document.querySelector(".mo-end")?.textContent ?? "") && document.querySelectorAll(".mo-crowd figure").length === 3, null, 10000), "the end: masks off, everyone together");
  ok(/moments? you weren't alone/.test(await text(A, ".mo-end")) && !(await A.locator(".mo-end .hp-res-row, .mo-end ol").count()), "a count of Same taps, no ranking");
  await shot(A, "07-maskoff-end");
  await A.locator("#hp-skip").first().click().catch(() => {});
  ok(await until(B, () => !document.getElementById("party-panel").hidden && document.querySelectorAll(".lr-av").length === 3, null, 15000), "everyone is back in the walkable lobby");
  ok(await until(B, () => /Game 2 of 3/.test(document.getElementById("pt-next")?.textContent ?? "") && /Vote next game/.test(document.getElementById("pt-vote")?.textContent ?? "")), "the party moves on to game 2 of 3, and the votes start over");
  ok(!(await B.locator("#pt-board:visible, .pt-board:visible").count()), "no high-score board in the room");

  // ------------------------------------------------------------------ Humiliation Ritual
  head("The host backs out of a setup screen, and ends a game mid-way");
  await A.click("#pt-vote");
  ok(await A.locator("#pt-picker-back").isVisible(), "the game votes sheet has a Back button");
  await A.click("#pt-picker-back");
  ok(await until(A, () => document.getElementById("pt-picker")?.hidden), "Back closes it, nothing started");
  await startGame(A, "sidequest");
  ok(await until(A, () => !!document.getElementById("sq-go") && !document.getElementById("hp-back").hidden), "Side Quest's quest picking: the host gets Back (top-left)");
  ok(await until(B, () => document.body.classList.contains("hp-setup-wait")) && !(await B.locator("#game-layer:visible").count()), "…while everyone else stays in the lobby");
  await shot(A, "07b-setup-back");
  await A.click("#hp-back");
  ok(await until(A, () => !window.party.current.launched && !document.getElementById("party-panel").hidden), "Back: the host is in the lobby, nothing started");
  ok(await until(B, () => !window.party.current.launched && !document.body.classList.contains("hp-setup-wait")), "…and nothing changed for the others");
  ok(!(await B.locator(".pt-toast").count()), "no 'ended' toast for backing out");
  await startGame(A, "mask_off");
  ok(await until(A, () => !!document.getElementById("mo-go")), "Mask Off's setup");
  await A.click("#mo-go");
  ok(await until(A, () => window.__game?.s?.phase === "choose", null, 20000), "Mask Off is under way");
  ok(await A.locator("#hp-end").isVisible() && !(await B.locator("#hp-end:visible").count()) && !(await C.locator("#hp-end:visible").count()), "only the host has End game");
  await A.click("#hp-end");
  ok(await until(A, () => /End this game for everyone\?/.test(document.getElementById("hp-end-ask")?.textContent ?? "")), "it asks first: 'End this game for everyone?'");
  await shot(A, "07c-end-confirm");
  await A.click("#hp-ask-no");
  ok(await until(A, () => !document.getElementById("hp-end-ask") && window.party.current.launched), "Cancel: the game goes on");
  await A.click("#hp-end"); await A.click("#hp-ask-yes");
  ok(await until(B, () => !window.party.current.launched && /The host ended the game/.test(document.querySelector(".pt-toast")?.textContent ?? ""), null, 10000), "End game: everyone is back in the lobby with 'The host ended the game.'");
  await shot(B, "07d-ended-toast");
  ok(await until(C, () => !window.party.current.launched && document.getElementById("game-layer").hidden), "…on every phone");
  ok(await until(B, () => /Game 2 of 3/.test(document.getElementById("pt-next")?.textContent ?? "")), "an ended game isn't one of the 3: still Game 2 of 3");

  head("Humiliation Ritual — the Boss picks, only the performer gets the prompt, guesses feed the performer");
  await startGame(A, "ritual");
  ok(await until(A, () => !document.getElementById("game-layer").hidden), "the ritual starts");
  ok(await until(B, () => /Pick a capsule\. Any capsule\./.test(document.querySelector(".hr-room .dlg-text")?.textContent ?? ""), null, 8000), "the Boss opens the turn: \"Pick a capsule. Any capsule.\"");
  // (polled from here: a page drawing 3D in the background gets few animation frames)
  let upLine = "";
  for (let i = 0; i < 60 && !upLine; i++) { upLine = await C.evaluate(() => { const t = document.querySelector(".hr-room .dlg-text")?.textContent ?? ""; return /\. You're up\.$/.test(t) ? t : ""; }); if (!upLine) await sleep(250); }
  ok(!!upLine, "he holds a capsule up: \"[Name]. You're up.\"");
  const upName = upLine.replace(/\. You're up\.$/, "").trim();
  // the opening: a slip with the prompt on the performer's phone, "shhh" on the others
  let performer = null;
  for (let i = 0; i < 12 && !performer; i++) {
    for (const pg of [A, B, C]) if (await pg.locator(".hr-slip").count()) { performer = pg; break; }
    if (!performer) await sleep(500);
  }
  ok(!!performer, "the capsule opens: one phone gets the slip");
  if (performer) {
    const guessers = [A, B, C].filter(pg => pg !== performer);
    ok(await until(performer, () => /ACT IT OUT/.test(document.querySelector(".hr-slip .hr-kick")?.textContent ?? "") && (document.querySelector("#hr-slip-p")?.textContent ?? "").length > 1, null, 6000), "…ACT IT OUT, and the prompt");
    const slip = await text(performer, "#hr-slip-p");
    const perfName = new URL(performer.url()).searchParams.get("me");
    ok(perfName === upName, `the performer is the one the Boss named (${upName})`);
    // the pick's big moment: the performer's phone went to the red "YOU'RE UP", everyone else's slammed the name in
    const moments = async pg => pg.evaluate(() => globalThis.__npcMoments ?? []);
    ok((await moments(performer)).some(m => m.kind === "take-red" && m.text === "YOU'RE UP"), "the performer's phone: a red spotlight, \"YOU'RE UP\"");
    ok((await Promise.all(guessers.map(moments))).every(ms => ms.some(m => m.kind === "slam" && m.text === upName) && ms.some(m => m.kind === "banner" && m.text === `${upName} is performing`)),
      "everyone else's: the name slams in, \"[Name] is performing\"");
    ok((await Promise.all(guessers.map(pg => pg.locator(".hr-slip, .hr-card").count()))).every(n => n === 0)
      && (await Promise.all(guessers.map(pg => until(pg, () => /^Shhh\.$/.test(document.querySelector(".hr-room .dlg-text")?.textContent ?? ""), null, 5000)))).every(Boolean),
      "everyone else gets his \"Shhh.\", no slip");
    await shot(performer, "08a-ritual-slip");
    await shot(guessers[0], "08b-ritual-shh");
    // the prompt never reaches another phone: not in the synced game state, not in the page
    const leak = await Promise.all(guessers.map(pg => pg.evaluate(t => JSON.stringify(window.__game?.s ?? {}).includes(t) || document.body.innerText.includes(t), slip)));
    ok(leak.every(x => !x), "the prompt is in no other phone's game state or page");
    ok(await until(performer, () => !!document.querySelector("#hr-feed"), null, 8000), "then the acting: the performer gets the feed");
    const prompt = await text(performer, ".hr-prompt");
    ok(/ACT IT OUT/.test(await text(performer, ".hr-kick")) && prompt === slip, `only the performer sees the prompt (${prompt})`);
    ok((await Promise.all(guessers.map(pg => pg.locator(".hr-card").count()))).every(n => n === 0), "the guessers don't");
    ok(await until(guessers[0], () => /Guess what they're doing/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "the guessers see 'Guess what they're doing!' and a text box");
    await guessers[0].fill("#gp-in", "a broken toaster");
    await guessers[0].click("#game-panel .gp-form button");
    await guessers[1].fill("#gp-in", prompt.toLowerCase());
    await guessers[1].click("#game-panel .gp-form button");
    ok(await until(performer, () => document.querySelectorAll("#hr-feed .hr-g").length === 2), "both guesses land in the performer's live feed");
    ok(await performer.locator("#hr-feed .hr-g.match").count() === 1, "the right one is highlighted for the performer (worked out on the performer's phone)");
    ok(!(await guessers[0].locator("#gp-in").isDisabled()), "you can keep guessing after one");
    await shot(performer, "08-ritual-performer");
    await shot(guessers[0], "09-ritual-guesser");
    await performer.locator("#hr-feed .hr-g.match").click();
    ok(await until(guessers[0], t => /got it/.test(document.querySelector("#game-panel h2")?.textContent ?? "") && document.querySelector(".hr-reveal b")?.textContent === t, prompt), "the performer's tap ends the turn; the performer's phone reveals the answer, big");
  }
  ok(await A.evaluate(() => !document.getElementById("party-panel").hidden && document.getElementById("party-panel").classList.contains("pt-behind")), "the ritual is played over the party room (dimmed), not the map");
  ok(await skipUntil(A, A, t => /Humiliation Ritual/.test(t), 25), "the ritual plays through to results");
  // the host's skip on the results (the visible one; again if a slow page missed it)
  let back = false;
  for (let i = 0; i < 4 && !back; i++) {
    await A.locator("#hp-skip:visible").first().click({ timeout: 3000 }).catch(() => {});
    back = await until(A, () => document.getElementById("game-layer").hidden && !document.getElementById("party-panel").classList.contains("pt-behind"), null, 6000);
  }
  ok(back, "back to the lobby");

  // ------------------------------------------------------------------ Secret Diary
  head("Party settings: 18+ gate and Secret Diary max level");
  await A.click("#pt-vote");
  await A.click("#pv-settings-h");
  await A.locator(".pt-settings").scrollIntoViewIfNeeded();
  ok(await A.locator('[data-set="diaryMax"][data-val="unhinged"]').isDisabled(), "unhinged is locked until the party is 18+");
  ok(/default/.test(await text(A, '[data-set="diaryMax"].on')) && /spicy/.test(await text(A, '[data-set="diaryMax"].on')), "a private party defaults to spicy, marked (default)");
  await shot(A, "10-settings");
  let asked = null;
  A.once("dialog", d => { asked = d.message(); d.accept(); });
  await A.click('[data-set="adult"][data-val="1"]');
  ok(/18 or older/.test(asked ?? ""), "turning on 18+ asks the host to confirm everyone's an adult");
  ok(await until(A, () => !document.querySelector('[data-set="diaryMax"][data-val="unhinged"]')?.disabled), "unhinged unlocks");
  await A.click('[data-set="diaryMax"][data-val="unhinged"]');
  ok(await until(A, () => document.querySelector('[data-set="diaryMax"][data-val="unhinged"]')?.classList.contains("on")), "the host sets the Secret Diary max level");

  head("Secret Diary — deal, answer the batch, reveal one by one (3 phones; diary_e2e.mjs plays it with 5)");
  await A.click('[data-game="secretdiary"] .pv-t > b');
  ok(await until(A, () => document.querySelectorAll(".sd-card").length === 5), "the host is dealt a batch of 5, with Swap");
  ok(await until(B, () => /is picking/.test(document.querySelector(".sd-incoming")?.textContent ?? "")), "everyone else waits while the host picks");
  await shot(A, "11-diary-deal");
  const firstCard = await text(A, ".sd-card .sd-ctext > div:last-child");
  await A.locator("[data-swap]").first().click();
  ok(await until(A, t => (document.querySelector(".sd-card .sd-ctext > div:last-child")?.textContent ?? "") !== t, firstCard), "Swap deals a different card");
  await A.click("#sd-send");
  ok((await Promise.all([A, B, C].map(pg => until(pg, () => document.querySelectorAll(".sd-q").length === 5)))).every(Boolean), "everyone gets the whole batch at once");
  const qTypes = await B.locator(".sd-q").evaluateAll(qs => qs.map(q => q.classList.contains("yesno") ? "yesno" : "written"));
  const w0 = qTypes.indexOf("written");
  // cy is mid-sentence while the others submit: it must survive
  await C.locator(".sd-q").nth(w0).locator(".sd-in").fill("half a thou");
  await shot(B, "12-diary-answer");
  for (const pg of [A, B]) {
    for (let k = 0; k < qTypes.length; k++) {
      const q = pg.locator(".sd-q").nth(k);
      if (qTypes[k] === "written") await q.locator(".sd-in").fill(`${pg.label} answer ${k + 1}`);
      else await q.locator(`[data-yn="${pg === A ? "yes" : "no"}"]`).click();
    }
    await pg.click("#sd-submit");
  }
  await sleep(900);
  ok((await C.locator(".sd-q").nth(w0).locator(".sd-in").textContent()) === "half a thou", "others submitting doesn't wipe what you're typing");
  for (let k = 0; k < qTypes.length; k++) {
    const q = C.locator(".sd-q").nth(k);
    if (qTypes[k] === "written") await q.locator(".sd-in").fill(`cy answer ${k + 1}`);
    else await q.locator('[data-yn="yes"]').click();
  }
  await C.click("#sd-submit");
  ok(await until(B, () => /question 1 of 5/.test(document.querySelector(".sd-qcount")?.textContent ?? ""), null, 15000), "everyone submitted: question 1 of 5 is revealed");
  ok(!/pts/.test(await text(B, "#game-hud")), "no score on screen mid-game");
  const seenTypes = new Set();
  for (let k = 0; k < 5; k++) {
    ok(await until(B, k => new RegExp(`question ${k + 1} of 5`).test(document.querySelector(".sd-qcount")?.textContent ?? ""), k, 20000), `question ${k + 1}`);
    const yn = (await B.locator(".sd-count").count()) > 0;
    if (!seenTypes.has(yn)) {
      seenTypes.add(yn);
      if (yn) {
        ok((await B.locator(".sd-dcell").count()) === 3, "yes/no gets the diaries too: three locked, one per answer");
        ok(await until(B, () => !document.querySelector(".sd-count.sealed") && document.querySelectorAll(".sd-dcell.open").length === 3, null, 10000), "they unlock, then the count appears");
        ok(/nobody or almost nobody|everyone or almost everyone|\d of \d said yes/.test(await text(B, ".sd-count")), `only the count: "${await text(B, ".sd-count")}"`);
        // 2 of 3 said yes here: softened, so the stamps stay blurred
        ok((await B.locator(".sd-dcell .sd-stamp.blur").count()) === 3, "a softened count keeps every stamp blurred");
        await shot(B, "14-diary-yesno");
      }
      else {
        ok((await B.locator(".sd-dcell").count()) === 3, "three closed, locked diaries on the shelf");
        ok(await until(B, () => !document.querySelector(".sd-matchlist.sealed") && document.querySelectorAll(".sd-dcell.open").length === 3, null, 10000), "they unlock, and the answers can be matched");
        ok((await B.locator(".sd-entry").count()) === 3, "three unsigned answers");
        ok((await B.locator(".sd-who").first().locator("button").count()) === 2, "you match against the other writers only");
        await B.locator(".sd-who button").first().click(); await shot(B, "13-diary-written");
      }
    }
    for (const pg of [A, B, C]) await pg.click("#sd-lock").catch(() => {});
    // after every question: the points screen
    ok(await until(B, () => document.querySelectorAll(".sd-pts .sd-pt-row").length === 3, null, 20000), `after question ${k + 1}: points for all three`);
    if (k === 0) {
      ok(!(await B.locator("#sd-next").count()) && (await A.locator("#sd-next").count()) === 1, "only the host gets 'next question'");
      await sleep(1600); await shot(B, "15-diary-points");
      await A.click("#sd-next");
    }
  }
  ok(seenTypes.size === 2, "both written and yes/no questions came up");
  ok(await until(A, () => /Secret Diary/.test(document.querySelector(".hp-res-title")?.textContent ?? ""), null, 20000), "the diary reaches its results screen");
  await shot(A, "18-diary-results");
  ok(await A.evaluate(() => (window.__logRows ?? []).length) >= 5 && await A.evaluate(() => window.__logRows.some(r => r.skipped)), "the host's phone logged the questions, including the swap");

  head("After game 3: the party results podium, then a new set");
  for (let i = 0; i < 20 && await A.locator("#party-panel").isHidden(); i++) { await A.evaluate(() => document.getElementById("hp-skip")?.click()); await sleep(600); }
  ok(await until(A, () => !document.getElementById("party-panel").hidden, null, 15000), "back in the lobby");
  ok((await Promise.all([A, B, C].map(pg => until(pg, () => document.querySelectorAll("#pp .pp-step:not(.empty)").length === 3)))).every(Boolean), "after 3 games everyone sees the podium, top 3 on it");
  ok(await A.locator("#pp-again").isVisible() && await A.locator("#pp-end").isVisible() && !(await B.locator("#pp-again").count()), "only the host gets 'new set' / 'end the party'");
  await sleep(1200);
  await shot(B, "18b-podium");
  await A.click("#pp-again");
  ok((await Promise.all([A, B].map(pg => until(pg, () => !document.getElementById("pp") && /Game 1 of 3/.test(document.getElementById("pt-next")?.textContent ?? ""))))).every(Boolean), "a new set starts: game 1 of 3, the podium closes for everyone");

  head("Art Gallery — the dealer unveils the titles on wall plaques");
  await startGame(A, "artgallery");
  ok(await until(B, () => /fill your 3 frames/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "everyone fills 3 frames");
  for (const [k, pg] of [A, B, C].entries()) for (let i = 0; i < 3; i++) {
    await until(pg, () => !!document.getElementById("ag-file"));
    await pg.setInputFiles("#ag-file", join(ROOT, `web/games/captions/c${(k * 3 + i) % 8}.jpg`));
    await sleep(500);
  }
  ok(await until(A, () => window.__game?.s?.phase === "title", null, 30000), "all 9 photos in, titling opens");
  // wait for each phone to draw its title screen before deciding it has
  // nothing to title — on a slow machine it may still show the photo step
  const titleStep = () => /title this piece|titles locked|nothing to title/.test(document.querySelector("#game-panel h2")?.textContent ?? "") || !!document.querySelector(".ag-room");
  for (const pg of [A, B, C]) for (let k = 0; k < 6; k++) {
    await until(pg, titleStep);
    const t = await stageTitle(pg);
    if (!/title this piece/.test(t)) break;
    await until(pg, () => document.getElementById("gp-in") && !document.getElementById("gp-in").disabled);
    await pg.fill("#gp-in", `${pg.label} title ${k + 1}`); await pg.click("#game-panel .gp-form button");
    await until(pg, t => (document.querySelector("#game-panel h2")?.textContent ?? "") !== t, t, 5000);
  }
  const inRoom = await until(B, () => !!document.querySelector("#game-panel.ag-full .ag-room"), null, 30000);
  const where = inRoom ? "" : ` — host at ${await A.evaluate(() => `${window.__game?.s?.phase}/${window.__game?.s?.sub}`)}; screens: ${(await Promise.all([A, B, C].map(stageTitle))).join(" | ")}`;
  ok(inRoom, "the gallery is a full-screen room, no white card" + where);
  ok(await B.locator("#game-panel .stage").count() === 0, "the vote step has no stage card");
  ok(await until(A, () => document.querySelectorAll(".ag-room.covered .ag-pl-cloth").length === 2), "both title plaques start under cloth");
  // screenshot first: a screenshot stalls animations in the other tabs, so
  // nothing else may run while the unveil is being timed (the cover lasts ~3 s)
  await shot(B, "19-gallery-covered");
  await A.bringToFront();   // after a screenshot the other tabs can stop drawing frames
  // measured on the host's phone (A), where a late reset once rebuilt the room
  // mid-unveil, from the moment the room flips to revealed
  const seq = await A.evaluate(() => new Promise(res => {
    const op = () => [...document.querySelectorAll(".ag-pl-cloth")].map(c => +getComputedStyle(c).opacity);
    const t0 = Date.now();
    const watch = () => {
      const room = document.querySelector(".ag-room");
      if (!room || !room.classList.contains("revealed")) return Date.now() - t0 > 15000 ? res({}) : setTimeout(watch, 20);
      // fixed samples, plus when each plaque first starts to fade (a busy
      // runner can push the whole unveil late; the order is what matters)
      const out = { first: [null, null] };
      // the stagger itself, read off the running cloth transitions: a stalled
      // runner can squeeze the observed gap, but not the delays they run with
      out.delays = [...document.querySelectorAll(".ag-pl-cloth")].map(c =>
        Math.max(...c.getAnimations().map(a => +a.effect.getTiming().delay || 0), 0));
      [400, 2400].forEach(t => setTimeout(() => { out[t] = op(); }, t));
      const t1 = Date.now();
      const poll = () => { const o = op(); o.forEach((v, i) => { if (out.first[i] === null && v < 0.9) out.first[i] = Date.now() - t1; }); if (Date.now() - t1 < 2500) setTimeout(poll, 16); else res(out); };
      poll();
    };
    watch();
  }));
  ok(seq[400]?.every(o => o > 0.9), `the painting goes first: plaques still covered at 0.4 s (${JSON.stringify(seq[400])})`);
  const [f1, f2] = seq.first ?? [];
  const [d1, d2] = seq.delays ?? [];
  ok(f1 !== null && f2 !== null && f1 <= f2 && d1 > 0 && d1 + 300 <= d2, `then plaque I, then plaque II — one by one (delays ${d1} / ${d2} ms; they start to fade at ${f1} / ${f2} ms)`);
  ok(seq[2400]?.every(o => o < 0.05), "both plaques unveiled within ~2.5 s");
  // with 3 players each frame has 2 writers, so exactly one phone gets to vote
  let voter = null;
  for (let i = 0; i < 20 && !voter; i++) { for (const pg of [A, B, C]) if (await pg.locator(".ag-pl[data-v]").count() === 2) voter = pg; if (!voter) await sleep(250); }
  ok(!!voter, "the non-writer's plaques are tappable");
  if (voter) {
    const writer = [A, B, C].find(pg => pg !== voter);
    ok(await writer.locator(".ag-pl[data-v]").count() === 0 && /yours/.test(await text(writer, "#ag-pill")), "writers see the plaques but can't vote, and are told one is theirs");
    await voter.locator('.ag-pl[data-v="1"]').click();
    ok(await until(voter, () => document.querySelector('.ag-pl[data-v="1"]')?.classList.contains("on") && document.querySelector(".ag-room")?.classList.contains("picked")), "tapping a plaque marks it with the red dot");
    await shot(voter, "20-gallery-voted");
    // a title that wraps must not make its plaque bigger than the other one
    const hs = await voter.evaluate(() => {
      const t = document.querySelector(".ag-pl .ag-pl-t"), was = t.textContent;
      t.textContent = "“a much longer title that wraps onto three lines on a phone”";
      const h = [...document.querySelectorAll(".ag-pl")].map(p => p.offsetHeight);
      t.textContent = was;
      return h;
    });
    ok(hs.length === 2 && hs[0] === hs[1], `both plaques are the same size, even when one title wraps (${hs.join(" / ")} px)`);
    ok(await until(A, () => Object.keys(window.__game?.s?.frames?.[window.__game.s.fi]?.votes ?? {}).length >= 1 || window.__game?.s?.sub === "result"), "the vote reaches the host");
  }
  ok(await until(A, () => document.querySelectorAll(".ag-room .ag-pl-n").length === 2, null, 20000), "the result shows authors and votes on the same plaques");
  ok(await A.locator(".ag-pl-by").count() === 2, "each plaque names its author once the votes are in");
  await sleep(900);
  const ws = await A.evaluate(() => [...document.querySelectorAll(".ag-pl")].map(p => Math.round(p.getBoundingClientRect().width)));
  ok(ws.length === 2 && Math.abs(ws[0] - ws[1]) <= 1, `the winning plaque settles back to the same size (${ws.join(" / ")} px wide)`);
  await shot(A, "21-gallery-result");
  // the host skips each remaining vote rather than waiting out its 25 s timer;
  // cover and result still run (~10 s a frame), so allow up to ~90 s
  for (let i = 0; i < 120 && !/Art Gallery/.test(await A.evaluate(() => document.querySelector(".hp-res-title")?.textContent ?? "")); i++) {
    await A.evaluate(() => document.getElementById("ag-skip")?.click()); await sleep(600);
  }
  ok(await until(A, () => /Art Gallery/.test(document.querySelector(".hp-res-title")?.textContent ?? ""), null, 30000), "the gallery plays out to its results screen");
} catch (e) {
  ok(false, "crashed: " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | "));
}

ok(errors.length === 0, "no page errors" + (errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
