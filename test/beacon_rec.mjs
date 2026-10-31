// A public party's house over its host, on the REAL app page (Supabase faked
// offline, test/appserve.mjs), three phones side by side:
//   tony  throws a public party (the host)
//   mina  on the map: the house pops in over tony's character, she taps it,
//         sees the card and joins
//   jae   on the map the whole time: the house stays up while they play
//         Side Quest, its card says "Playing Side Quest · round N" and
//         "You'll join at the next round"; tony leaves (the house moves to
//         mina, the new host), then mina leaves: the party's over and the
//         house pops out
// Then stills: the house by day and by night (?light=), a full party (the
// "Full" tag, the card's Join disabled), the host switching to invite only
// (the house gone at once), and someone joining mid-game: the lobby's "you'll
// join at the next round", then their seat at the next turn.
//
//   node test/beacon_rec.mjs <dir> [--only=rec,light,full,private,late]
// With FFMPEG=/path/to/ffmpeg the recording is also <dir>/house.mp4 (the
// three phones on one timeline).
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/beacon_rec.mjs <dir> [--only=rec,light,full,private,late]"); process.exit(2); }
const ONLY = args.find(a => a.startsWith("--only="))?.slice(7).split(",") ?? ["rec", "light", "full", "private", "late"];
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 60000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
const errors = [];
let passes = 0, fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (c) passes++; else fails++; return c; };
const LOOKS = {
  tony: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  mina: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  jae: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
  sol: { skin: "4", eyes: "keen", iris: "gray", hairColor: "platinum", hair: "buzz", head: "none", face: "none", top: "track-purple", bottom: "track-pants", shoes: "combat", neck: "none" },
  haru: { skin: "2", eyes: "sparkly", iris: "brown", hairColor: "black", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "wide-jeans", shoes: "hightop", neck: "none" },
};
const who = name => `&me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}`;
// everyone a few streets apart in Itaewon: the host's zone is the station's
const appUrl = (name, q = "") => `${base}/app.html?onb=0&devlat=37.5347&devlng=126.9945${who(name)}${q}`;
const lightUrl = (name, q = "") => `${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}${q}`;

// ---------------------------------------------------------------- phones
// each its own window (a background tab doesn't render, its screencast would
// freeze), one context: they share the BroadcastChannel "network"
let browserCdp = null;
async function newWindow(ctx) {
  browserCdp ??= await browser.newBrowserCDPSession();
  if (!ctx._cid) {
    const first = await ctx.newPage();
    const s = await ctx.newCDPSession(first);
    ctx._cid = (await s.send("Target.getTargetInfo")).targetInfo.browserContextId;
    return first;
  }
  const made = ctx.waitForEvent("page");
  await browserCdp.send("Target.createTarget", { url: "about:blank", browserContextId: ctx._cid, newWindow: true, background: false });
  const pg = await made;
  await pg.setViewportSize({ width: 390, height: 844 });
  return pg;
}
async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, locale: "en-US" });
  await ctx.addInitScript(() => { try { localStorage.setItem("rando-lang", "en"); localStorage.setItem("rando-hint-v1", "1"); } catch {} });
  return ctx;
}
async function app(ctx, name, q = "") {
  const pg = await newWindow(ctx);
  pg.label = name;
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("dialog", d => d.accept());
  if (process.env.DEBUG_REC) pg.on("console", m => { if (/party|beacon|house/i.test(m.text())) console.log(`    [${name}] ${m.text()}`); });
  await pg.goto(appUrl(name, q));
  await until(pg, () => !document.getElementById("auth-status")?.hidden && !!window.__onb?.party, null, 120000);
  // (a calmer frame rate: three software-GL maps on one machine)
  await pg.evaluate(async () => { (await import("/web/world3d.js")).world3d.maxFps = 15; });
  // (this sandbox's software GL starves the pages' timers: a host's 2.5 s
  // announce can arrive 8 s+ apart, past the directory's expiry, and the
  // house would blink. Here an entry only goes with the host's "gone" — the
  // party ending, going invite only, the host leaving — which is what's tested)
  await pg.evaluate(async () => {
    const { directory } = await import("/web/net.js");
    setInterval(() => { for (const r of directory.rooms.values()) r.seenAt = Date.now(); }, 1000);
  });
  return pg;
}
async function light(ctx, name, q = "") {
  const pg = await newWindow(ctx);
  pg.label = name;
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await pg.goto(lightUrl(name, q));
  await until(pg, () => window.__ready === true);
  await pg.evaluate(() => { window.__onb ??= { party: window.party }; });
  return pg;
}
// (page.screenshot can wait forever on fonts in this sandbox: straight from CDP)
async function shot(pg, name, note = "") {
  const cdp = await pg.context().newCDPSession(pg);
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach().catch(() => {});
  await writeFile(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  console.log(`  shot ${name}.png${note ? ` — ${note}` : ""}`);
}
// the film: each phone shot about once a second (a live screencast of three
// software-GL pages starves this sandbox; this keeps the pages responsive)
async function screencast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  let on = true, busy = false;
  const grab = async () => {
    if (!on || busy) return;
    busy = true;
    try { const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }); frames.push({ t: Date.now() / 1000, data: r.data }); } catch {}
    busy = false;
  };
  const timer = setInterval(grab, 1000);
  return { frames, stop: async () => { on = false; clearInterval(timer); } };
}
async function writeFilm(name, casts) {
  await Promise.all(casts.map(c => c.stop()));
  const all = casts.flatMap(c => c.frames.map(f => f.t));
  if (!all.length) return;
  const t0 = Math.min(...all), t1 = Math.max(...all) + 0.5;
  const dirs = [];
  for (const [k, c] of casts.entries()) {
    const dir = join(OUT, name, `phone${k + 1}`);
    await mkdir(dir, { recursive: true });
    let list = "ffconcat version 1.0\n";
    const fr = c.frames;
    for (let i = 0; i < fr.length; i++) {
      const n = `f${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(dir, n), Buffer.from(fr[i].data, "base64"));
      const start = i === 0 ? t0 : fr[i].t, end = fr[i + 1]?.t ?? t1;
      list += `file ${n}\nduration ${Math.max(0.016, end - start).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list);
    dirs.push(dir);
  }
  console.log(`  frames in ${join(OUT, name)} (${casts.map(c => c.frames.length).join(" / ")}, ${Math.round(t1 - t0)} s)`);
  if (!process.env.FFMPEG) return;
  const inputs = dirs.flatMap(d => ["-f", "concat", "-safe", "0", "-i", join(d, "frames.ffconcat")]);
  const scale = dirs.map((_, i) => `[${i}:v]fps=30,scale=390:844,setsar=1[v${i}]`).join(";");
  const stack = dirs.length > 1 ? `${dirs.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${dirs.length}[out]` : "[v0]null[out]";
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${scale};${stack}`, "-map", "[out]", "-pix_fmt", "yuv420p", "-crf", "26", join(OUT, `${name}.mp4`)]);
  console.log(`  wrote ${join(OUT, `${name}.mp4`)}`);
}

// ---------------------------------------------------------------- steps
// the host: Host -> the form -> public -> throw it
async function throwParty(H, { name = "Tony's party", vibe = "chaotic", cap = null } = {}) {
  await H.evaluate(() => document.getElementById("nav-host")?.click());
  await until(H, () => !!document.querySelector("#pt-create"));
  await sleep(400);
  await H.evaluate(({ name, vibe, cap }) => {
    const P = window.__onb.party;
    document.querySelector(`[data-vibe="${vibe}"]`)?.click();
    document.querySelector('[data-priv="public"]')?.click();
    document.getElementById("pt-name").value = name;
    if (cap) { P.form.cap = cap; document.getElementById("pt-cap").value = cap; }
  }, { name, vibe, cap });
  // (going public asks the verification gate first: wait for its answer)
  await until(H, () => window.__onb.party.form.privacy === "public", null, 20000);
  await sleep(700);
  await H.evaluate(() => document.getElementById("pt-create").click());
  return until(H, () => /^[A-Z0-9]{4}$/.test(document.getElementById("pt-code-chip")?.textContent ?? ""), null, 30000);
}
const code = H => H.evaluate(() => window.__onb.party.current?.meta.code);
// a light page (test/hpparty.html) throws a public party; its zone is one of
// the fake server's launch zones (what backend.js's hook gives on the app)
async function lightParty(H, { name = "Tony's party", vibe = "chaotic", cap = 6 } = {}) {
  await H.evaluate(({ name, vibe, cap }) => {
    party.hooks.beaconZone = async () => ({ id: "itaewon-station", lat: 37.5346, lng: 126.9946 });
    Object.assign(party.form, { privacy: "public", name, vibe, cap });
    return party.create().then(() => party.togglePanel(true));
  }, { name, vibe, cap });
  return until(H, () => !!party.current?.zone, null, 10000);
}
// what this phone's map shows
const houses = pg => pg.evaluate(async () => (await import("/web/partybeacon.js")).partyBeacons.debug());
const hasHouse = (pg, hostId, ms = 90000) => until(pg, async id => {
  const { partyBeacons } = await import("/web/partybeacon.js");
  return partyBeacons.debug().some(h => h.host === id && h.hasHost);
}, hostId, ms);
const noHouse = (pg, ms = 20000) => until(pg, async () => (await import("/web/partybeacon.js")).partyBeacons.size === 0, null, ms);
// the camera over the house: its host, the house and its tag in the frame
// the camera (locked on you since #57: the house stands 15-35 m from your zone's centre) zoomed in or out
async function look(pg, { dist = 150, theta = null } = {}) {
  await pg.evaluate(async ({ dist, theta }) => {
    const { world3d } = await import("/web/world3d.js");
    const { partyBeacons } = await import("/web/partybeacon.js");
    const h = partyBeacons.debug()[0];
    if (!h?.pos) return;
    world3d.cam.dist = dist; if (theta != null) world3d.cam.theta = theta;
    world3d.camGoal = null;
    world3d.applyCamera(); world3d.needsRender = true;
  }, { dist, theta });
  await sleep(500);
}
const tapHouse = async pg => {
  for (let i = 0; i < 40; i++) {
    const r = await pg.evaluate(() => { const t = document.querySelector(".phouse-tag:not(.out)"); if (t && t.style.display !== "none") { t.click(); return true; } return false; }).catch(e => { console.log("    (tap:", e.message, ")"); return false; });
    if (r) return true;
    await sleep(1500);
  }
  return false;
};
const card = pg => pg.evaluate(() => {
  const el = document.getElementById("party-card");
  if (!el || el.hidden) return null;
  const q = s => el.querySelector(s)?.textContent?.trim() ?? null;
  return { name: q("#pc-name"), host: q(".pc-who small"), vibe: q(".pc-vibe"), count: q(".pc-count"), status: q(".pc-status span"), next: el.querySelector(".pc-next")?.hidden ? null : q(".pc-next"), join: q("#pc-join"), disabled: !!el.querySelector("#pc-join")?.disabled, char: !!el.querySelector("#pc-char canvas, #pc-char .cv-spr") };
});
const state = pg => pg.evaluate(() => { const P = window.__onb.party, c = P.current; return JSON.stringify({ cur: c?.room.id, members: c?.room.members.map(m => m.id), host: c?.room.hostId, launched: c?.launched, n: P.playerCount?.(), panel: document.getElementById("party-panel")?.hidden, floor: !!document.querySelector("#party-panel #pt-floor"), err: document.getElementById("pt-err")?.textContent, pv: document.getElementById("pv-err")?.textContent, onb: document.querySelector(".onb-screen:not(.out)")?.dataset.screen, card: !document.getElementById("party-card")?.hidden, game: window.__game?.s?.phase ?? null }); }).catch(e => e.message);
const inLobby = (pg, ms = 120000) => until(pg, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor"), null, ms);
const toMap = pg => pg.evaluate(() => window.__onb.party.togglePanel(false));

// ================================================================ the recording
if (ONLY.includes("rec")) {
  console.log("\n— the recording: throw a public party, the house, tap, join, a game, the end");
  const ctx = await newCtx();
  const T = await light(ctx, "tony", "&bots=1");      // (the host on the light page: one software-GL map less)
  const M = await app(ctx, "mina", "&light=night");
  const J = await app(ctx, "jae", "&light=night");
  await sleep(6000);                                     // the world streams in
  const casts = [await screencast(T), await screencast(M), await screencast(J)];
  await sleep(1500);
  ok(await lightParty(T, { vibe: "chaotic" }), "tony throws a public party");
  ok(await hasHouse(M, "u-tony") && await hasHouse(J, "u-tony"), "the house pops in over tony's character on mina's and jae's maps");
  await look(M); await look(J);
  await sleep(2500);
  await shot(M, "rec-01-house", "mina's map: tony under his house");
  ok(await tapHouse(M), "mina taps the house");
  await until(M, () => !!document.querySelector("#party-card:not([hidden]) #pc-join"));
  await sleep(1800);
  const c1 = await card(M);
  ok(c1 && /Tony's party/.test(c1.name) && /tony is hosting/.test(c1.host) && c1.vibe === "Chaotic" && c1.count === "1/6 players" && c1.status === "In lobby" && c1.join === "Join party" && !c1.disabled, `the card: host, vibe, players, status, Join (${JSON.stringify(c1)})`);
  await shot(M, "rec-02-card", "the party card");
  await M.evaluate(() => document.getElementById("pc-join")?.click());
  if (!ok(await inLobby(M), "mina joins: the lobby")) { console.log("    mina:", await state(M)); await shot(M, "fail-mina-join"); }
  await sleep(2500);
  ok(await until(J, async () => (await import("/web/partybeacon.js")).partyBeacons.debug()[0]?.n === "2/6", null, 60000), "jae's tag: 2/6");
  // the host starts Side Quest (tony, mina + a bot): its setup, go
  for (let i = 0; i < 5 && !(await T.evaluate(() => !!window.__onb.party.current?.launched)); i++) {
    await T.evaluate(() => window.__onb.party.startGame("sidequest"));
    await sleep(3000);
  }
  if (!await until(T, () => window.__game?.s?.phase === "setup", null, 60000)) { console.log("    tony:", await state(T)); await shot(T, "fail-tony-start"); }
  await sleep(2500);
  await T.evaluate(() => window.__game.input("sq-go"));
  ok(await until(T, () => ["howto", "spin", "quest", "do"].includes(window.__game?.s?.phase), null, 20000), "Side Quest is on");
  await sleep(2000);
  ok((await houses(J)).length === 1, "the house stays up on jae's map during the game");
  await look(J);
  await T.evaluate(() => { if (window.__game?.s?.phase === "howto") window.__game.input("skip"); });
  await until(T, () => window.__game?.s?.phase === "quest" || window.__game?.s?.phase === "do", null, 30000);
  await sleep(3500);
  await tapHouse(J);
  await until(J, () => /Playing/.test(document.querySelector("#party-card:not([hidden]) .pc-status span")?.textContent ?? ""), null, 10000);
  await sleep(1500);
  const c2 = await card(J);
  ok(c2 && /^Playing Side Quest · round 1$/.test(c2.status) && c2.next === "You'll join at the next round" && !c2.disabled, `jae's card mid-game: "${c2?.status}", "${c2?.next}"`);
  await shot(J, "rec-03-card-playing", "the card while they play: the game and its round, you'd come in at the next round");
  await J.evaluate(() => document.getElementById("pc-close")?.click());
  await sleep(1500);
  await shot(J, "rec-04-house-in-game", "jae's map: the house still up during the game");
  // the host ends the game, back to the lobby; then leaves: mina hosts now
  await T.evaluate(() => window.__game.endByHost());
  await until(T, () => !window.__onb.party.current?.launched, null, 20000);
  await sleep(2500);
  await T.evaluate(() => window.__onb.party.exit("leave"));
  ok(await hasHouse(J, "u-mina", 30000), "tony leaves: the house moves to mina, the new host");
  await look(J);
  await sleep(3000);
  await shot(J, "rec-05-house-moved", "the house over mina now");
  await M.evaluate(() => window.__onb.party.exit("leave"));
  ok(await noHouse(J, 20000), "mina leaves too: the party's over, the house pops out");
  await sleep(2500);
  await shot(J, "rec-06-gone", "no house");
  await writeFilm("house", casts);
  await ctx.close();
}

// ================================================================ day and night
if (ONLY.includes("light")) {
  console.log("\n— the house by day and by night");
  for (const L of ["night", "day", "sunset"]) {
    const ctx = await newCtx();
    const H = await light(ctx, "tony", "&pub=1");
    await lightParty(H, { vibe: "chill" });
    const V = await app(ctx, "mina", `&light=${L}`);
    ok(await hasHouse(V, "u-tony", 40000), `${L}: the house over tony`);
    await sleep(4000);
    await look(V, { dist: 120 });
    await sleep(2500);
    await shot(V, `house-${L}`, `the house by ${L}`);
    await look(V, { dist: 360 });
    await sleep(2000);
    await shot(V, `house-${L}-far`, `the house by ${L}, zoomed out`);
    if (L !== "sunset") {
      await tapHouse(V);
      await sleep(2200);
      await shot(V, `card-${L}`, `the card by ${L}`);
    }
    await ctx.close();
  }
}

// ================================================================ full
if (ONLY.includes("full")) {
  console.log("\n— a full party");
  const ctx = await newCtx();
  const H = await light(ctx, "tony");
  await lightParty(H, { vibe: "sporty", cap: 3 });
  const c = await H.evaluate(() => party.current.meta.code);
  await light(ctx, "sol", `&party=${c}`);
  await light(ctx, "haru", `&party=${c}`);
  const V = await app(ctx, "mina", "&light=night");
  ok(await until(V, async () => (await import("/web/partybeacon.js")).partyBeacons.debug()[0]?.full === true, null, 40000), "3/3: the house is Full");
  await sleep(3000);
  await look(V, { dist: 120 });
  await sleep(2000);
  ok(await V.evaluate(() => document.querySelector(".phouse-tag .ph-full")?.textContent === "Full"), "its tag says Full");
  await shot(V, "full-house", "a full party: the Full tag");
  await tapHouse(V);
  await sleep(2200);
  const cf = await card(V);
  ok(cf?.disabled && cf.join === "Full" && cf.count === "3/3 players", `the card: Join disabled (${JSON.stringify(cf)})`);
  await shot(V, "full-card", "a full party's card: Join disabled");
  await ctx.close();
}

// ================================================================ public -> private
if (ONLY.includes("private")) {
  console.log("\n— public -> invite only");
  const ctx = await newCtx();
  const H = await app(ctx, "tony", "&light=night");
  const V = await app(ctx, "mina", "&light=night");
  await sleep(4000);
  ok(await throwParty(H, { vibe: "chill" }), "tony throws a public party");
  ok(await hasHouse(V, "u-tony"), "the house is up");
  await look(V, { dist: 120 });
  await sleep(1500);
  await shot(V, "private-1-before", "public: the house");
  // the host's party settings: Who can come -> Invite only
  await H.evaluate(() => { const P = window.__onb.party; P.settingsOpen = true; P._onTV(); });
  await until(H, () => !!document.querySelector('[data-privacy="private"]'));
  await sleep(800);
  await shot(H, "private-2-setting", "the host's party settings: who can come");
  const t0 = Date.now();
  await H.evaluate(() => document.querySelector('[data-privacy="private"]')?.click());
  ok(await noHouse(V, 10000), `invite only: the house is gone (${Date.now() - t0} ms)`);
  await sleep(800);
  await shot(V, "private-3-after", "invite only: no house");
  ok(await H.evaluate(() => window.__onb.party.current.meta.privacy === "private"), "the party is invite only");
  await ctx.close();
}

// ================================================================ mid-game join
if (ONLY.includes("late")) {
  console.log("\n— joining mid-game: the next round");
  const ctx = await newCtx();
  const H = await light(ctx, "tony", "&bots=2");
  await lightParty(H);
  await H.evaluate(() => party.startGame("sidequest"));
  await until(H, () => window.__game?.s?.phase === "setup", null, 20000);
  await H.evaluate(() => window.__game.input("sq-go"));
  await until(H, () => ["spin", "quest", "do"].includes(window.__game?.s?.phase), null, 30000);
  const V = await app(ctx, "jae", "&light=night");
  ok(await hasHouse(V, "u-tony", 40000), "the house, mid-game");
  await look(V, { dist: 120 });
  await sleep(1500);
  await tapHouse(V);
  await sleep(1800);
  await shot(V, "late-1-card", "mid-game: You'll join at the next round");
  await V.evaluate(() => document.getElementById("pc-join")?.click());
  ok(await inLobby(V), "jae joins: the lobby");
  await sleep(1200);
  const line = await V.evaluate(() => document.getElementById("pt-next")?.textContent);
  ok(/you'll join at the next round/.test(line ?? ""), `jae's lobby: "${line}"`);
  await shot(V, "late-2-lobby", "in the lobby: you'll join at the next round");
  ok(await H.evaluate(() => !window.__game.seated("u-jae")), "no seat in the turn that's on");
  // the turn ends (the host skips ahead): the next one seats jae, whose phone gets the game
  for (let i = 0; i < 6 && !(await H.evaluate(() => window.__game.seated("u-jae"))); i++) { await H.evaluate(() => window.__game.input("skip")); await sleep(1500); }
  ok(await H.evaluate(() => window.__game.seated("u-jae")), "the next turn: jae has a seat");
  ok(await until(V, () => !!window.__game?.s && window.__onb?.party?.current?.launched, null, 20000), "jae's phone is in the game");
  await sleep(3000);
  await shot(V, "late-3-in-game", "jae in Side Quest from the next turn");
  await ctx.close();
}

console.log(`\n${passes} passed, ${fails} failed`);
if (errors.length) console.log("page errors:\n" + [...new Set(errors)].slice(0, 20).join("\n"));
await browser.close(); close();
process.exit(fails ? 1 : 0);
