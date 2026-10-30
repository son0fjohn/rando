// Every dialog, sheet, popup and button surface in the app, shot on the REAL
// app page offline (test/appserve.mjs), for before/after looks at the shared
// glass style: the start screen, the first-open setup card (or the old name
// and character screens), the invite sheet, the empty room, Leave the
// party?, Settings, a permission pre-prompt, the safety card, a toast, Home,
// the recap, verification, Save your account, the game votes sheet, the
// lobby with people, a profile card, End this game?, the party results, the
// host menu (?onb=0), the Style screen, Keep your new look?, the shop, and a
// public party's card on the map.
//
//   node test/glass_shots.mjs <dir> [--prefix=before] [--only=a,b,c,d] [--light=night|sunset|day] [--contrast]
//
// --light: the map's light for every phone (default night). --contrast: each
// shot also measures its glass windows' text (test/contrastkit.mjs: WCAG, as
// drawn, 4.5:1 / 3:1 large text and icons) into <dir>/<prefix>-contrast.md,
// and fails on anything under.
//
// Sections: a = a fresh phone's whole first open, b = a lobby with people,
// c = the ?onb=0 chrome (host menu, Style, shop, beacon card), d = a
// returning player's start screen. Every shot is <dir>/<prefix>-NN-name.png.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
import { measure } from "./contrastkit.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/glass_shots.mjs <dir> [--prefix=before] [--only=a,b,c,d] [--light=night|sunset|day] [--contrast]"); process.exit(2); }
const PREFIX = args.find(a => a.startsWith("--prefix="))?.slice(9) ?? "shot";
const ONLY = args.find(a => a.startsWith("--only="))?.slice(7).split(",") ?? ["a", "b", "c", "d"];
const LIGHT = args.find(a => a.startsWith("--light="))?.slice(8) ?? "night";
const CONTRAST = args.includes("--contrast");
// the glass windows a shot's text is measured in (outermost of each only)
const ROOTS = [".onb-screen:not(.out)", ".onb-sheet:not(.out)", ".onb-perm", ".onb-toast", ".glass-dialog", ".glass-sheet", ".glass-toast", ".glass", ".glass-btn", ".glass-icon",
  "#party-panel:not(.pt-lobby):not([hidden])", ".pt-top", ".pt-bottom", "#pp", "#style-screen:not([hidden])", "#party-card:not([hidden])", ".hp-results"];
const contrastRows = [];
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
const tap = (pg, sel) => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
const errors = [], shots = [];
const LOOKS = {
  jae: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  mina: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  sol: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
};
const appUrl = (q = "") => `${base}/app.html?devlat=37.5347&devlng=126.9945&light=${LIGHT}${q}`;
const who = n => `&me=${n}&av=${encodeURIComponent(JSON.stringify(LOOKS[n]))}`;
const screenIs = (pg, id, ms = 30000) => until(pg, id => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === id, id, ms);
const sheetIs = (pg, id, ms = 30000) => until(pg, id => !!document.querySelector(`.onb-sheet[data-sheet="${id}"]:not(.out)`), id, ms);
const inLobby = (pg, ms = 60000) => until(pg, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !document.querySelector("#onb .onb-screen"), null, ms);
let n = 0;
// (page.screenshot can wait forever on fonts in this sandbox: straight from CDP)
async function shot(pg, name, what) {
  const file = `${PREFIX}-${String(++n).padStart(2, "0")}-${name}.png`;
  try {
    const cdp = await pg.context().newCDPSession(pg);
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    await cdp.detach().catch(() => {});
    await writeFile(join(OUT, file), Buffer.from(r.data, "base64"));
    shots.push(`${file} — ${what}`); console.log(`  shot ${file} · ${what}`);
    if (CONTRAST) {
      const rows = (await measure(pg, ROOTS)).filter(r => r.ratio != null && r.alpha >= 0.05);
      const low = rows.filter(r => r.ratio < r.need);
      for (const r of rows) contrastRows.push({ shot: name, ...r });
      console.log(`    contrast: ${rows.length} measured, ${low.length} under${low.length ? ": " + low.slice(0, 6).map(r => `${r.key} ${r.ratio}:1 (${r.ink} on ${r.bg})`).join(" · ") : ""}`);
    }
  } catch (e) { console.log(`  (shot failed) ${file}: ${e.message}`); }
}
async function context({ fresh = false, verify = false, oauth = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: "en-US" });
  await ctx.addInitScript(({ verify, oauth }) => {
    try { localStorage.setItem("rando-lang", "en"); if (verify) localStorage.setItem("stub-verify", "1"); if (oauth) localStorage.setItem("stub-oauth", "kakao,apple,google"); } catch {}
    globalThis.__sceneryNoSlow = true;     // (software GL here: keep the real glass)
  }, { verify, oauth });
  return ctx;
}
async function page(ctx, label) {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${label}: ${e.message}`));
  pg.on("dialog", d => d.accept());
  return pg;
}
async function section(name, fn) {
  console.log(`\n${name}`);
  n = { a: 0, b: 30, c: 40, d: 50 }[name[0]] ?? n;
  try { await fn(); } catch (e) { console.log(`  ✗ ${e.message}`); errors.push(`${name}: ${e.message}`); }
}

// ---- a: a fresh phone, from the start screen through its first open
if (ONLY.includes("a")) await section("a. a fresh phone", async () => {
  const ctx = await context({ fresh: true, verify: true, oauth: true });
  const P = await page(ctx, "fresh");
  await P.goto(appUrl());
  if (!await screenIs(P, "start", 90000)) throw new Error("no start screen");
  await until(P, () => document.body.classList.contains("scenery-live"), null, 90000);
  await sleep(2500);
  await shot(P, "start", "a first open: the start screen");
  await tap(P, ".st-panel [data-start]");
  const which = await Promise.race([
    until(P, () => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === "name", null, 30000).then(ok => ok && "name"),
    until(P, () => !!document.querySelector(".st-panel [data-setup]"), null, 30000).then(ok => ok && "setup"),
  ]);
  if (which === "name") {
    await sleep(600); await shot(P, "setup-name", "Start a party -> the name screen");
    await P.fill("#onb-name", "Alex"); await tap(P, "[data-next]");
    await screenIs(P, "char"); await sleep(4000);
    await shot(P, "setup-character", "-> the character screen");
    await tap(P, "[data-shuffle]"); await sleep(1500);
    await shot(P, "setup-character-shuffled", "after Shuffle");
    await tap(P, "[data-ok]");
  } else if (which === "setup") {
    await until(P, () => !!document.querySelector(".st-panel [data-setup] canvas"), null, 30000);
    await sleep(1500);
    await shot(P, "setup-card", "Start a party -> the setup card: a name, the character, 3D");
    await tap(P, ".st-panel [data-random]"); await sleep(1800);
    await shot(P, "setup-card-random", "after Randomize");
    await tap(P, ".st-panel [data-mode='2d']"); await sleep(2500);
    await shot(P, "setup-card-2d", "the 2D view: the room's own sprite, big");
    await tap(P, ".st-panel [data-mode='3d']"); await sleep(600);
    await tap(P, ".st-panel [data-go]");
  } else throw new Error("neither the old name screen nor the setup card");
  if (!await sheetIs(P, "invite", 60000)) throw new Error("no invite sheet");
  await sleep(1200);
  await shot(P, "invite-sheet", "your own party's invite sheet");
  await tap(P, '.onb-sheet[data-sheet="invite"] [data-close]'); await sleep(1200);
  await until(P, () => !document.querySelector("#pt-empty")?.hidden, null, 10000);
  await shot(P, "empty-room", "alone in the room: the invite card, the lobby's header");
  await tap(P, "#pt-back"); await sleep(600);
  await shot(P, "leave-confirm", "back -> Leave the party?");
  await tap(P, ".pt-confirm [data-no]"); await sleep(400);
  await P.evaluate(() => window.__onb.settings()); await sleep(900);
  await shot(P, "settings", "Settings");
  await tap(P, "[data-sheet=settings] [data-close]"); await sleep(400);
  P.evaluate(async () => (await import("/web/permissions.js")).prePrompt("location")); await sleep(800);
  await shot(P, "permission", "a permission pre-prompt");
  await tap(P, ".onb-perm [data-no]"); await sleep(300);
  await P.evaluate(() => { window.__onb.state.safety = false; window.__onb.beforeGame({ id: "ritual" }); }); await sleep(700);
  await shot(P, "safety", "the safety card before a first game");
  await tap(P, ".onb-safety button"); await sleep(400);
  await P.evaluate(async () => (await import("/web/permissions.js")).toast("Copied!")); await sleep(400);
  await shot(P, "toast", "a toast");
  await sleep(2600);
  P.evaluate(() => { window.__onb.verifySheet("public"); }).catch(() => {}); await sleep(1200);
  await shot(P, "verify", "Verify your number");
  await tap(P, "[data-sheet=verify] [data-later]"); await sleep(400);
  P.evaluate(() => { window.__onb.saveSheet("save"); }).catch(() => {}); await sleep(1200);
  await shot(P, "save-account", "Save your account");
  await tap(P, "[data-sheet=save] [data-close]"); await sleep(400);
  await P.evaluate(() => { const o = window.__onb, c = o.party.current; c.played = [
    { game: "ritual", highlight: null, with: ["Jae", "Mina", "Sol"] },
    { game: "sidequest", highlight: { kind: "quest", text: "Compliment a stranger's shoes like it's a wedding toast", by: "Mina" }, with: ["Jae", "Mina", "Sol"] },
    { game: "artgallery", highlight: null, with: ["Jae", "Mina", "Sol"] }]; o.recapPreview(c); });
  await sleep(3500);
  await shot(P, "recap", "the first party's recap");
  await tap(P, "[data-sheet=recap] [data-close]"); await sleep(400);
  await tap(P, "#pt-vote"); await sleep(1000);
  await shot(P, "votes-sheet", "the game votes sheet (the host, alone)");
  await tap(P, "#pt-picker-x"); await sleep(400);
  await P.evaluate(() => window.__onb.home()); await sleep(3500);
  await shot(P, "home", "Home");
  await ctx.close();
});

// ---- b: a lobby with people: the header, a profile card, End this game?, the results
if (ONLY.includes("b")) await section("b. a lobby with people", async () => {
  const ctx = await context();
  const H = await page(ctx, "jae");
  await H.goto(appUrl(who("jae")));
  if (!await screenIs(H, "start", 90000)) throw new Error("no start screen");
  await sleep(1500);
  await tap(H, ".st-panel [data-start]");
  if (!await sheetIs(H, "invite", 60000)) throw new Error("no party");
  const link = await H.evaluate(() => document.querySelector("[data-share]")?.dataset.link);
  const code = link?.match(/\/p\/([A-Z0-9]{4})/)?.[1];
  await tap(H, "[data-close]");
  const guests = [];
  for (const g of ["mina", "sol"]) {
    const pg = await page(ctx, g);
    await pg.goto(`${base}/test/hpparty.html?me=${g}&av=${encodeURIComponent(JSON.stringify(LOOKS[g]))}&party=${code}`);
    guests.push(pg);
  }
  if (!await until(H, () => document.querySelectorAll(".lr-av").length >= 3, null, 60000)) throw new Error("friends didn't arrive");
  await H.bringToFront(); await sleep(2500);
  await shot(H, "lobby", "the lobby with people: back, the host menu, the chat row, Game votes");
  await H.evaluate(() => document.querySelector('.lr-av[data-id="u-mina"] .lr-spr')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await until(H, () => !!document.querySelector("#y-card .y-card-3d canvas"), null, 20000);
  await sleep(1200);
  await shot(H, "profile-card", "tap someone: the profile card");
  await H.evaluate(() => { const w = document.querySelector(".y-card-wrap"); w?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); }); await sleep(600);
  await tap(H, "#pt-vote"); await sleep(1000);
  await shot(H, "votes-sheet-people", "the game votes sheet with people in");
  await H.evaluate(() => document.querySelector('[data-game="ritual"] .pv-t > b')?.click());
  if (!await until(H, () => !document.getElementById("hp-end")?.hidden, null, 40000)) throw new Error("the game didn't start");
  await tap(H, ".onb-safety button");
  await sleep(1500);
  await tap(H, "#hp-end"); await sleep(600);
  await shot(H, "end-game-ask", "End this game for everyone?");
  await tap(H, "#hp-ask-no"); await sleep(300);
  await tap(H, "#hp-end"); await sleep(300); await tap(H, "#hp-ask-yes");
  await until(H, () => !document.querySelector("#party-panel")?.hidden && !!document.querySelector("#pt-vote"), null, 30000);
  await sleep(800);
  await H.evaluate(async () => {
    const { showPodium } = await import("/web/partyboard.js");
    const c = window.__onb.party.current, host = document.querySelector("#party-panel .pt-floor-wrap") ?? document.getElementById("party-panel");
    const rows = c.room.members.map((m, i) => ({ id: m.id, handle: m.handle, total: [31, 24, 18, 12][i] ?? 5 }));
    showPodium(host, { no: 1, games: [1, 2, 3] }, rows, { me: c.room.me.id, avatars: Object.fromEntries(c.room.members.map(m => [m.id, m.avatar])), isHost: true, onNewSet: () => {}, onEnd: () => {} });
  });
  await sleep(2500);
  await shot(H, "party-results", "the party results: the podium, end / a new set");
  // a game's own final scores (hpkit.js resultsHtml, every game's end screen), over the game layer
  await H.evaluate(async () => {
    document.getElementById("pp")?.remove();
    const { resultsHtml } = await import("/web/hpkit.js");
    const c = window.__onb.party.current, layer = document.getElementById("game-layer") ?? document.body;
    const players = c.room.members.map((m, i) => ({ id: m.id, handle: m.handle, avatar: m.avatar, score: [14, 9, 6, 2][i] ?? 0 }));
    const w = document.createElement("div");
    w.id = "glass-shot-results";
    w.style.cssText = "position:fixed;inset:0;z-index:900;display:grid;place-items:center;padding:16px;background:rgba(6,10,30,.55)";
    w.innerHTML = `<div class="hp-results-wrap" style="width:min(100%,420px)">${resultsHtml(players, { title: "Humiliation Ritual", sub: "final scores", note: "right guess: 3-5 · performer: 2-4 · faster = more" })}</div>`;
    document.body.appendChild(w);
  });
  await sleep(1200);
  await shot(H, "game-results", "a game's final scores (every game's end screen)");
  // --old-results: the same card without the shared glass classes (what it looked like before them)
  if (args.includes("--old-results")) {
    await H.evaluate(() => document.querySelector("#glass-shot-results .hp-results")?.classList.remove("glass", "glass-dialog"));
    await sleep(500);
    await shot(H, "game-results-old", "the same final scores without the glass classes (the old card)");
  }
  await ctx.close();
});

// ---- c: the ?onb=0 chrome: the host menu, Style, Keep your new look?, the shop, a beacon's card
if (ONLY.includes("c")) await section("c. the map's chrome (?onb=0)", async () => {
  const ctx = await context();
  const A = await page(ctx, "tony");
  await A.goto(appUrl(`&onb=0&coins=200${who("mina")}`));
  await until(A, () => !document.getElementById("auth-status")?.hidden, null, 60000);
  await sleep(3000);
  await tap(A, "#nav-style");
  await until(A, () => !!document.querySelector("#style-view canvas"), null, 60000);
  await sleep(2500);
  await shot(A, "style", "the Style screen");
  if (await A.locator("#style-view [data-mode='2d']").count()) {
    await tap(A, "#style-view [data-mode='2d']"); await sleep(2500);
    await shot(A, "style-2d", "Style, the 2D view: the room's sprite, big");
    await tap(A, "#style-view [data-mode='3d']"); await sleep(500);
  }
  await A.locator("#outfit-tabs button", { hasText: /^Top$/ }).click(); await sleep(2500);
  await A.locator('#outfit-grid [data-slot="top"][data-value="denim-jacket"]').click(); await sleep(2200);
  await shot(A, "style-buy", "a shop item tried on: the Buy bar");
  await A.locator("#outfit-tabs button", { hasText: /^Shop$/ }).click(); await sleep(2500);
  await shot(A, "shop", "the shop");
  await tap(A, "#style-close"); await sleep(600);
  await shot(A, "style-ask", "leaving with changes: Keep your new look?");
  await A.evaluate(() => document.querySelector('#ss-ask [data-ask="discard"]')?.click()); await sleep(800);
  await tap(A, "#nav-host"); await sleep(1200);
  if (await A.locator('[data-priv="public"]').count()) await A.click('[data-priv="public"]');
  await A.locator("#pt-name").fill("Mina's party");
  await shot(A, "host-menu", "host a party (the ?onb=0 console)");
  await tap(A, "#pt-create"); await sleep(4000);
  await A.evaluate(() => window.__onb.party.togglePanel(false)); await sleep(3500);
  const at = await A.evaluate(() => { const b = document.querySelector(".pbeacon"); if (!b) return null; const m = b.style.transform.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/); return m ? [+m[1], +m[2]] : null; });
  if (at) {
    const fb = await A.locator(".frame canvas").first().boundingBox();
    const dx = fb.width / 2 - at[0], dy = fb.height * 0.42 - at[1];
    await A.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await A.mouse.down();
    for (let i = 1; i <= 12; i++) { await A.mouse.move(fb.x + fb.width / 2 + dx * i / 12, fb.y + fb.height / 2 + dy * i / 12); await sleep(30); }
    await A.mouse.up(); await sleep(1500);
  }
  await A.evaluate(() => document.querySelector(".pbeacon")?.click()); await sleep(1500);
  await shot(A, "party-card", "a public party's card under its beacon");
  await ctx.close();
});

// ---- d: a returning player's start screen (the avatar + name chip, once it exists)
if (ONLY.includes("d")) await section("d. a returning player", async () => {
  const ctx = await context();
  const R = await page(ctx, "sol");
  await R.goto(appUrl(who("sol")));
  if (!await screenIs(R, "start", 90000)) throw new Error("no start screen");
  await until(R, () => document.body.classList.contains("scenery-live"), null, 90000);
  await sleep(3000);
  await shot(R, "start-returning", "a returning player's start screen");
  if (await R.locator(".st-panel [data-me-chip]").count()) {
    await tap(R, ".st-panel [data-me-chip]");
    await until(R, () => !!document.querySelector(".st-panel [data-setup] canvas"), null, 30000); await sleep(1500);
    await shot(R, "edit-card", "tap the chip: the same card, to edit");
    await tap(R, ".st-panel [data-mode='2d']"); await sleep(2500);
    await shot(R, "edit-card-2d", "…in 2D");
    await tap(R, ".st-panel [data-go]"); await sleep(1200);
    await shot(R, "start-returning-after", "back on the start screen");
  }
  await tap(R, ".st-panel [data-join]"); await sleep(800);
  await shot(R, "join", "Join a party: the code");
  await ctx.close();
});

await writeFile(join(OUT, `${PREFIX}-SHOTS.md`), shots.map(s => `- ${s}`).join("\n") + "\n");
if (errors.length) console.log("\nerrors:\n  " + [...new Set(errors)].slice(0, 10).join("\n  "));
let under = 0;
if (CONTRAST) {
  const low = contrastRows.filter(r => r.ratio < r.need);
  under = low.length;
  const md = [`# glass text contrast, ${LIGHT} (${contrastRows.length} measured, ${low.length} under)`, "", "| shot | element | size | needs | ratio | ink on bg |", "|---|---|---|---|---|---|",
    ...contrastRows.map(r => `| ${r.shot} | ${r.key.replace(/\|/g, "/")} | ${r.size} | ${r.need} | ${r.ratio}${r.ratio < r.need ? " ✗" : ""} | ${r.ink} on ${r.bg} |`)];
  await writeFile(join(OUT, `${PREFIX}-contrast.md`), md.join("\n") + "\n");
  console.log(`\ncontrast (${LIGHT}): ${contrastRows.length} measured, ${low.length} under` + (low.length ? ":\n  " + low.map(r => `${r.shot}: ${r.key} ${r.ratio}:1 < ${r.need} (${r.ink} on ${r.bg})`).join("\n  ") : ""));
}
await browser.close(); close();
process.exit(under ? 1 : 0);
