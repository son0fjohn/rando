// End-to-end party test: three "phones" (pages in one browser context) form a
// real party over the BroadcastChannel stub and play through the lobby and
// three games by clicking and typing in the real UI. Real party.js, net.js,
// hplobby.js, game modules and the app's real CSS (injected from
// web/index.html). Saves phone-sized screenshots for eyeballing the layout.
//
//   node test/party_e2e.mjs [screenshot-dir]
//
// Runs in real time (≈2 min): it's the one place the party flow is exercised
// as a whole, so it trades speed for realism.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = process.argv[2] ?? null;
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

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const head = m => console.log("\n" + m);
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
const stageTitle = pg => text(pg, "#game-panel .stage h2, #game-panel .hp-res-title");
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
  ok((await A.locator("#pt-floor").evaluate(e => getComputedStyle(e).backgroundImage)).includes("lobbies/chaos.png"), "the chaotic vibe picks the chaotic backdrop");

  const B = await phone("bob", `&party=${code}`);
  ok(await until(B, () => document.querySelectorAll(".lr-av").length === 2, null, 20000), "a friend joins straight from the share link");
  ok(await until(A, () => document.querySelectorAll(".lr-av").length === 2), "the host sees them arrive in the room");
  ok((await text(B, "#pt-title")) === "Saturday night", "the joiner gets the party name from the host");

  // ------------------------------------------------------------------ queue with too few
  head("Lobby: host queues a game before the room is full");
  await A.click("#pt-open-picker");
  ok(await A.locator("#pt-picker").isVisible(), "the host opens the game picker");
  ok(!(await B.locator("#pt-open-picker").count()), "guests don't get a picker");
  await A.click('[data-queue="mission"]');
  ok(await until(A, () => /up next/.test(document.querySelector('[data-queue="mission"]')?.textContent ?? "")), "tapping a game queues it");
  await A.click('[data-opt="mode"][data-val="choose"]');
  await sleep(300);
  await shot(A, "01-host-picker");
  await A.click("#pt-picker-x");
  ok(await A.locator("#pt-picker").isHidden(), "the host closes the picker");
  ok(/needs 1 more/.test(await text(A, "#pt-start")), "start waits for the minimum: 'needs 1 more'");
  ok(await until(B, () => /Today's Mission/.test(document.getElementById("pt-next")?.textContent) && /players choose/.test(document.getElementById("pt-next")?.textContent)), "guests see what's up next, options included");
  await A.click("#pt-open-picker");
  ok(await A.locator("#pt-picker").isVisible(), "the host can reopen it");
  await A.locator("#pt-picker").click({ position: { x: 20, y: 30 } });
  ok(await A.locator("#pt-picker").isHidden(), "tapping the dimmed backdrop closes it too");

  const C = await phone("cy");
  await C.click("#party-btn");
  await C.fill("#pt-code", code);
  await C.press("#pt-code", "Enter");
  ok(await until(C, () => document.querySelectorAll(".lr-av").length === 3, null, 20000), "a third friend joins by typing the code");
  ok(await until(A, () => /start/.test(document.getElementById("pt-start")?.textContent) && !document.getElementById("pt-start")?.disabled), "with 3 players, start unlocks");

  // ------------------------------------------------------------------ walk + chat
  head("Lobby: walking around and talking");
  const aliceOnB = () => B.locator('.lr-av[data-id="u-alice"]').evaluate(e => ({ l: e.style.left, t: e.style.top }));
  const before = await aliceOnB();
  const fb = await A.locator("#pt-floor").boundingBox();
  await A.mouse.click(fb.x + fb.width * 0.8, fb.y + fb.height * 0.75);
  await sleep(500);
  const after = await aliceOnB();
  ok(before.l !== after.l || before.t !== after.t, `a tap walks you, and the others see it (${before.l},${before.t} -> ${after.l},${after.t})`);
  ok(Math.abs(parseFloat(after.l) - 80) < 1.5, "you walk to where you tapped");
  await B.fill("#pt-chat-input", "who's ready??");
  await B.press("#pt-chat-input", "Enter");
  ok(await until(A, () => { const b = document.querySelector('.lr-av[data-id="u-bob"] .lr-bubble'); return b && !b.hidden && /ready/.test(b.textContent); }), "chat shows as a speech bubble over the speaker");
  await sleep(1400);
  await shot(A, "02-lobby-host");
  await shot(B, "03-lobby-guest");

  // ------------------------------------------------------------------ Today's Mission, players choose
  head("Today's Mission — players choose, rated 0-10");
  await A.click("#pt-start");
  ok(await until(B, () => !document.getElementById("game-layer").hidden && /pick your mission/.test(document.querySelector("#game-panel h2")?.textContent)), "everyone lands on 'pick your mission'");
  ok(await A.locator("#party-panel").isHidden(), "the lobby steps aside during the game");
  await shot(B, "04-mission-pick");
  for (const pg of [A, B, C]) await pg.locator("[data-pick]").nth(1).click();
  ok(await until(A, () => /turn|your turn/.test(document.querySelector("#game-panel h2")?.textContent ?? ""), null, 10000), "once everyone picks, the first card comes up");
  // get the first mission to its rating, find a phone that rates
  let rater = null;
  for (let i = 0; i < 6 && !rater; i++) {
    for (const pg of [A, B, C]) if (await pg.locator("#tm-slider").count()) { rater = pg; break; }
    if (!rater) { await A.locator("#hp-skip").first().click().catch(() => {}); await sleep(900); }
  }
  ok(!!rater, "the room reaches the rating screen");
  if (rater) {
    await rater.locator("#tm-slider").evaluate(e => { e.value = 8; e.dispatchEvent(new Event("input", { bubbles: true })); });
    ok((await text(rater, "#tm-val")) === "8" && /nailed|got it/.test(await text(rater, "#tm-label")), "the slider shows the number and its label as you drag");
    await shot(rater, "05-mission-rate");
    await rater.click("#tm-lock");
    ok(await until(rater, () => /you gave/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "locking in shows your rating");
  }
  ok(await skipUntil(A, A, t => /\/ 10|nobody rated/.test(t)), "the verdict shows the average out of 10");
  await shot(A, "06-mission-verdict");
  ok(await skipUntil(A, A, t => /Today's Mission/.test(t), 20), "missions play through to the results screen");
  await shot(A, "07-mission-results");
  await A.locator("#hp-skip").first().click().catch(() => {});
  ok(await until(B, () => !document.getElementById("party-panel").hidden && document.querySelectorAll(".lr-av").length === 3, null, 15000), "everyone is back in the walkable lobby");
  ok(/Today's Mission/.test(await text(B, "#pt-next")), "the queue survives, ready to run again or change");

  // ------------------------------------------------------------------ Humiliation Ritual
  head("Humiliation Ritual — the performer barely touches the phone");
  await A.click("#pt-open-picker");
  await A.click('[data-queue="ritual"]');
  await A.click("#pt-picker-done");
  await A.click("#pt-start");
  ok(await until(A, () => !document.getElementById("game-layer").hidden), "the ritual starts");
  let performer = null;
  for (let i = 0; i < 8 && !performer; i++) {
    for (const pg of [A, B, C]) if (/act it out/.test(await stageTitle(pg))) { performer = pg; break; }
    if (!performer) { await A.locator("#hp-skip").first().click().catch(() => {}); await sleep(900); }
  }
  ok(!!performer, "one phone becomes the performer");
  if (performer) {
    const guesser = [A, B, C].find(pg => pg !== performer);
    ok(!(await performer.locator(".hr-guess").count()), "the performer's screen has no guess feed to read");
    ok(await performer.locator("#hr-heard").isVisible(), "just one big 'someone said it out loud' button");
    await shot(performer, "08-ritual-performer");
    await guesser.fill("#gp-in", "a broken toaster");
    await guesser.click("#game-panel .gp-form button");
    ok(await until(guesser, () => /toaster/.test(document.getElementById("hr-feed")?.textContent ?? "")), "typed guesses show in the guessers' feed");
    ok(!(await guesser.locator("#gp-in").isDisabled()), "you can keep guessing after one");
    await shot(guesser, "09-ritual-guesser");
    await performer.click("#hr-heard");
    await performer.locator("[data-heard]").first().click();
    ok(await until(guesser, () => /got it/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "one tap by the performer credits an out-loud answer");
  }
  ok(await skipUntil(A, A, t => /Humiliation Ritual/.test(t), 25), "the ritual plays through to results");
  await A.locator("#hp-skip").first().click().catch(() => {});
  ok(await until(A, () => !document.getElementById("party-panel").hidden, null, 15000), "back to the lobby");

  // ------------------------------------------------------------------ Secret Diary
  head("Secret Diary — 5 prompts, then reveal, then match");
  await A.click("#pt-open-picker");
  await A.click('[data-queue="secretdiary"]');
  await A.click("#pt-picker-done");
  await A.click("#pt-start");
  ok(await until(A, () => /prompt 1 of 5/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "writing starts at prompt 1 of 5");
  await shot(A, "10-diary-write");
  // cy starts typing and stops mid-thought while the other two finish all 5:
  // their finishing must not wipe cy's half-written answer
  await until(C, () => document.getElementById("gp-in") && !document.getElementById("gp-in").disabled);
  await sleep(100);
  await C.fill("#gp-in", "half a thought");
  for (const pg of [A, B, C]) {
    if (pg === C) {
      ok((await C.inputValue("#gp-in")) === "half a thought", "others finishing all 5 doesn't wipe what you're halfway through typing");
    }
    for (let k = 0; k < 5; k++) {
      const ready = await until(pg, k => document.querySelector("#game-panel h2")?.textContent.includes(`prompt ${k + 1} `) && document.getElementById("gp-in") && !document.getElementById("gp-in").disabled, k, 8000);
      if (process.env.E2E_DEBUG) console.log(`    ${pg.label} prompt ${k + 1}: ready=${ready} h2="${await stageTitle(pg)}" t=${Date.now() % 100000}`);
      await sleep(80);
      await pg.fill("#gp-in", `${pg.label} entry for prompt ${k + 1}`);
      await pg.click("#game-panel .gp-form button");
    }
  }
  ok(await until(B, () => /entries/.test(document.querySelector("#game-panel h2")?.textContent ?? ""), null, 15000), "nothing is revealed until all 5 are in — then everything at once");
  ok((await B.locator(".sd-entry").count()) === 15, `all 15 entries appear unsigned (${await B.locator(".sd-entry").count()})`);
  await shot(B, "11-diary-reveal");
  await A.locator("#hp-skip").first().click();
  ok(await until(B, () => /who wrote which/.test(document.querySelector("#game-panel h2")?.textContent ?? "")), "matching opens");
  ok((await B.locator(".sd-tabs button").count()) === 5, "one page per prompt");
  await B.locator(".sd-who button").first().click();
  await sleep(400);
  await shot(B, "12-diary-match");
  await B.click("#sd-next");
  ok(await until(B, () => document.querySelector(".sd-tabs button.cur")?.textContent === "2"), "'next prompt' moves to page 2");
  ok(await skipUntil(A, A, t => /Secret Diary/.test(t), 10), "the diary reaches its results screen");
  await shot(A, "13-diary-results");
} catch (e) {
  fail++; console.log("  ✗ crashed: " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | "));
}

ok(errors.length === 0, "no page errors" + (errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
