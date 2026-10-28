// The onboarding on the REAL app page (Supabase faked offline), recorded:
//   Path A  a host (a returning player) starts a party from the start screen
//           and shares the invite; two friends are in; a FRESH phone (its
//           own storage, no account) opens the invite link /p/CODE: the
//           start screen with the party's name, name, character, the room
//           ("you're in!"), the host starts the suggested first game: the
//           safety card, the game's host lines.
//   Path B  a fresh phone opens the app on its own: the start screen, Start
//           a party, name, character, the invite sheet, the empty room with
//           its QR. (test/start_rec.mjs: the glass, the drift, the dive.)
//   checks  a declined location pre-prompt (the map still works), an
//           interrupted install (the invite survives a cold reopen), a guest
//           verifying mid-party (same account, still in the party), and
//           tap -> first game for 5 fresh phones (sizes, languages).
// Every screen is shot in English and in Korean.
//   node test/onboard_rec.mjs <dir> [en|ko|both] [--quick]    (FFMPEG=... for the mp4s)
// Fresh phones need their own storage, so each is its own browser context;
// the stub's realtime rides on BroadcastChannel, which doesn't cross
// contexts, so this script relays it between them.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/onboard_rec.mjs <dir> [en|ko|both] [--quick]"); process.exit(2); }
const LANGS = (process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "both") === "both" ? ["en", "ko"] : [process.argv[3]];
const QUICK = process.argv.includes("--quick");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
const tap = (pg, sel) => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const LOOKS = {
  jae: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  mina: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  sol: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
};

// ---- the relay: BroadcastChannel messages, from every context to every other
const contexts = [];
async function phoneContext({ lang = "en", viewport = { width: 390, height: 844 }, geo = false, verify = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, locale: lang === "ko" ? "ko-KR" : "en-US",
    ...(geo ? { geolocation: { latitude: 37.5347, longitude: 126.9945 }, permissions: ["geolocation"] } : {}) });
  await ctx.addInitScript(({ lang, verify }) => {
    try { if (!localStorage.getItem("rando-lang")) localStorage.setItem("rando-lang", lang); if (verify) localStorage.setItem("stub-verify", "1"); } catch {}
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (d) {
      post.call(this, d);
      if (!this.__relayed && this.name.startsWith("sbstub:") && window.__relay) window.__relay(this.name, d);
    };
  }, { lang, verify });
  await ctx.exposeBinding("__relay", async ({ context }, name, d) => {
    for (const other of contexts) {
      if (other === context) continue;
      const pg = other.pages().find(p => !p.isClosed());
      pg?.evaluate(([name, d]) => { const bc = new BroadcastChannel(name); bc.__relayed = true; bc.postMessage(d); setTimeout(() => bc.close(), 50); }, [name, d]).catch(() => {});
    }
  });
  contexts.push(ctx);
  return ctx;
}
async function page(ctx, url, label) {
  const pg = await ctx.newPage();
  pg.label = label;
  pg.on("pageerror", e => errors.push(`${label}: ${e.message}`));
  pg.on("dialog", d => d.accept());
  if (url) await pg.goto(url);
  return pg;
}
const appUrl = (q = "") => `${base}/app.html?devlat=37.5347&devlng=126.9945${q}`;
const lightUrl = (name, code) => `${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}&party=${code}`;
const screenIs = (pg, id, ms = 30000) => until(pg, id => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === id, id, ms);
const sheetIs = (pg, id, ms = 30000) => until(pg, id => !!document.querySelector(`.onb-sheet[data-sheet="${id}"]:not(.out)`), id, ms);

// ---- recordings (CDP screencast -> frames -> mp4)
async function cast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").catch(() => {}) };
}
async function writeVideo(name, casts) {
  await Promise.all(casts.map(c => c.stop()));
  const all = casts.flatMap(c => c.frames.map(f => f.t)); if (!all.length) return;
  const t0 = Math.min(...all), t1 = Math.max(...all) + 0.5, dirs = [];
  for (const [k, c] of casts.entries()) {
    const dir = join(OUT, name, `phone${k + 1}`); await mkdir(dir, { recursive: true });
    let list = "ffconcat version 1.0\n";
    for (let i = 0; i < c.frames.length; i++) {
      const n = `f${String(i).padStart(5, "0")}.jpg`;
      await writeFile(join(dir, n), Buffer.from(c.frames[i].data, "base64"));
      const st = i === 0 ? t0 : c.frames[i].t, en = c.frames[i + 1]?.t ?? t1;
      list += `file ${n}\nduration ${Math.max(0.016, en - st).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list); dirs.push(dir);
  }
  if (!process.env.FFMPEG) return;
  const inputs = dirs.flatMap(d => ["-f", "concat", "-i", join(d, "frames.ffconcat")]);
  const scale = dirs.map((_, i) => `[${i}:v]fps=24,scale=390:844,setsar=1[v${i}]`).join(";");
  const stack = dirs.length > 1 ? `${dirs.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${dirs.length}[out]` : "[v0]null[out]";
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${scale};${stack}`, "-map", "[out]", "-pix_fmt", "yuv420p", "-crf", "26", join(OUT, `${name}.mp4`)]);
  console.log(`  wrote ${name}.mp4 (${Math.round(t1 - t0)} s)`);
}
const shot = async (pg, lang, n, what) => { await pg.screenshot({ path: join(OUT, `${lang}-${n}.png`), timeout: 120000 }).catch(e => console.log("  (shot failed)", n, e.message)); console.log(`  shot ${lang}-${n}${what ? ` · ${what}` : ""}`); };
// a person's pace: read a screen, type like a thumb
const human = !QUICK;
const read = (ms = 1400) => sleep(human ? ms : 250);
async function typeName(pg, sel, text) { await pg.click(sel); await pg.keyboard.type(text, { delay: human ? 140 : 10 }); }

// ---- a host with a party (Home -> Throw a party -> the invite sheet) and two friends in it
async function hostParty(lang, { shots = true } = {}) {
  const ctx = await phoneContext({ lang });
  const H = await page(ctx, appUrl(`&me=jae&av=${encodeURIComponent(JSON.stringify(LOOKS.jae))}`), "jae");
  ok(await screenIs(H, "start", 90000), `${lang}: a returning player lands on the start screen`);
  await sleep(4000);
  if (shots) await shot(H, lang, "B5-start", "the start screen: Start a party, Join a party");
  await tap(H, ".st-panel [data-start]");
  ok(await sheetIs(H, "invite"), `${lang}: Start a party -> a party, and the invite sheet`);
  await sleep(1200);
  if (shots) await shot(H, lang, "B7-invite", "the invite sheet: share, messages, copy, QR");
  const link = await H.evaluate(() => document.querySelector("[data-share]")?.dataset.link);
  const code = link?.match(/\/p\/([A-Z0-9]{4})/)?.[1];
  ok(!!code && /\?n=/.test(link), `${lang}: the invite link is /p/${code} with the party's name (${link?.replace(base, "")})`);
  await tap(H, "[data-close]");
  const fctx = await phoneContext({ lang });
  const F = [await page(fctx, lightUrl("mina", code), "mina"), await page(fctx, lightUrl("sol", code), "sol")];
  ok(await until(H, () => document.querySelectorAll(".lr-av").length >= 3, null, 60000), `${lang}: two friends are in`);
  return { H, F, code, link, ctx, fctx };
}

// ---- Path A: a fresh phone, from the invite link to the first game
async function pathA(lang, party, { record = false, shots = true, viewport, name = lang === "ko" ? "지우" : "Alex", tag = "" } = {}) {
  const ctx = await phoneContext({ lang, viewport });
  const N = await page(ctx, null, `new${tag}`);
  const casts = record ? [await cast(N), await cast(party.H)] : [];
  const t0 = Date.now();
  await N.goto(party.link.replace(/^https?:\/\/[^/]+/, base));
  ok(await screenIs(N, "start", 60000), `${lang}${tag}: the invite opens the start screen, the party's name on it`);
  const steps = { start: Date.now() - t0 };
  if (shots) { await until(N, () => !!document.querySelector(".st-invite b") && document.querySelector(".st-invite b").textContent !== "…", null, 20000); await shot(N, lang, "A1-invite", "an invite: the party's name on the glass, no buttons"); }
  ok(await screenIs(N, "name"), `${lang}${tag}: straight on -> what should people call you`);
  steps.name = Date.now() - t0;
  if (shots) { await tap(N, "[data-suggest]"); await sleep(400); await shot(N, lang, "A2-name", "the name, with a suggestion"); await N.fill("#onb-name", ""); }
  await typeName(N, "#onb-name", name);
  await read(500);
  await tap(N, "[data-next]");
  ok(await screenIs(N, "char"), `${lang}${tag}: -> the character`);
  steps.character = Date.now() - t0;
  await sleep(shots ? 4000 : 800);
  if (shots) await shot(N, lang, "A3-character", "a random starter look on the platform");
  await tap(N, "[data-shuffle]"); await read(1200); await tap(N, "[data-shuffle]"); await read(1600);
  if (shots) await shot(N, lang, "A3b-shuffled", "after Shuffle");
  await tap(N, "[data-ok]");
  ok(await until(N, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor"), null, 30000), `${lang}${tag}: -> straight into the party room`);
  if (shots) { await until(N, () => !!document.querySelector(".onb-in"), null, 8000); await shot(N, lang, "A4-youre-in", "you're in! everyone already here waves"); }
  const tIn = Date.now() - t0;
  steps.room = tIn;
  ok(await until(N, () => !!document.querySelector(".onb-in") || window.__youreIn, null, 25000), `${lang}${tag}: "you're in!"`);
  ok(await until(party.H, () => document.querySelectorAll(".lr-av").length >= 4, null, 30000), `${lang}${tag}: the host sees them arrive`);
  ok(await until(N, () => !!document.querySelector(".onb-hint"), null, 10000), `${lang}${tag}: a first-time hint on the vote button`);
  if (shots) await shot(N, lang, "A5-room-hint", "the room, a first-time hint on the vote button");
  // the host starts the suggested first game
  await tap(party.H, "#pt-vote"); await sleep(800);
  if (shots) await shot(party.H, lang, "A6-first-game-badge", "Game votes: Great first game");
  await party.H.evaluate(() => document.querySelector('[data-game="ritual"] .pv-t > b')?.click());
  ok(await until(N, () => !!document.querySelector(".onb-safety"), null, 30000), `${lang}${tag}: the first game starts: the safety card first`);
  const tGame = Date.now() - t0;
  steps.game = tGame;
  console.log(`    (steps, ms from the tap: ${Object.entries(steps).map(([k, v]) => `${k} ${v}`).join(" · ")})`);
  await sleep(600);
  if (shots) await shot(N, lang, "A7-safety", "before the first game: Be cool…");
  await read(1800);
  await tap(N, ".onb-safety button");
  const lines = await until(N, () => !!window.__howto, null, 40000);
  ok(lines, `${lang}${tag}: the Boss says what to do (first time only)`);
  if (!lines) console.log("    (debug)", await N.evaluate(() => JSON.stringify({ st: localStorage.getItem("rando-onb-v1"), safety: document.querySelectorAll(".onb-safety").length, phase: document.body.className })));
  await sleep(2200);
  if (shots) await shot(N, lang, "A8-host-lines", "the game's host: one or two lines");
  await sleep(3000);
  const ev = await N.evaluate(() => (window.__events ?? []).map(e => e.name));
  ok(["app_open", "party_link_opened", "name_set", "character_shuffled", "character_confirmed", "joined_party", "first_game_started"].every(n => ev.includes(n)), `${lang}${tag}: analytics: ${[...new Set(ev)].join(", ")}`);
  const src = await N.evaluate(() => (window.__events ?? []).find(e => e.name === "app_open")?.props.source);
  ok(src === "invite_link", `${lang}${tag}: app_open source = invite_link`);
  if (record) await writeVideo(`pathA-${lang}`, casts);
  // the host ends the game: back to the room for the next phone
  await tap(party.H, "#hp-end"); await sleep(400); await tap(party.H, "#hp-ask-yes");
  await until(party.H, () => !!document.querySelector("#pt-vote") && !document.querySelector("#party-panel")?.hidden, null, 30000);
  if (shots) {
    // the first party's recap (a whole set of 3 games is too long for here: its games are filled in)
    await until(N, () => !document.querySelector("#party-panel")?.hidden, null, 30000);
    await N.evaluate(() => { const o = window.__onb, c = o.party.current; c.played = [
      { game: "ritual", highlight: null, with: ["jae", "mina", "sol"] },
      { game: "sidequest", highlight: { kind: "quest", text: "Compliment a stranger's shoes like it's a wedding toast", by: "mina" }, with: ["jae", "mina", "sol"] },
      { game: "artgallery", highlight: null, with: ["jae", "mina", "sol"] }]; o.recapPreview(c); });
    ok(await sheetIs(N, "recap"), `${lang}${tag}: the first party's recap`);
    await sleep(4000);
    await shot(N, lang, "A9-recap", "the recap: everyone together, the best moment, throw your own, share");
    await tap(N, "[data-sheet=recap] [data-close]");
  }
  return { N, ctx, tIn, tGame, steps };
}

// ---- Path B: a fresh phone opening the app on its own
async function pathB(lang, { record = false, shots = true } = {}) {
  const ctx = await phoneContext({ lang, verify: true });
  const P = await page(ctx, null, "cold");
  const casts = record ? [await cast(P)] : [];
  await P.goto(appUrl());
  ok(await screenIs(P, "start", 90000), `${lang}: a cold open: the start screen over the night city`);
  await sleep(5000);
  if (shots) await shot(P, lang, "B1-start", "the start screen");
  await read(); await tap(P, ".st-panel [data-start]");
  ok(await screenIs(P, "name"), `${lang}: Start a party -> name`);
  await sleep(500);
  if (shots) await shot(P, lang, "B3-name", "the name");
  await typeName(P, "#onb-name", lang === "ko" ? "새벽 여우" : "Midnight Fox"); await read(500);
  await tap(P, "[data-next]");
  ok(await screenIs(P, "char"), `${lang}: -> character`);
  await sleep(4000);
  if (shots) await shot(P, lang, "B4-character", "the character");
  await tap(P, "[data-shuffle]"); await read(1400);
  await tap(P, "[data-ok]");
  // a private party with friends never asks for a number (test/auth_rec.mjs covers the stranger features)
  ok(await sheetIs(P, "invite", 45000), `${lang}: -> straight to the party and its invite sheet (no phone)`);
  ok(await P.evaluate(() => !document.querySelector('.onb-sheet[data-sheet="verify"]')), `${lang}: …no verification asked for a private party`);
  await sleep(1200);
  if (shots) await shot(P, lang, "B7b-invite-own", "your own party's invite sheet");
  await P.evaluate(() => document.querySelector(".onb-qr")?.click()); await sleep(600);
  if (shots) await shot(P, lang, "B8-qr", "the QR big, for friends in the room");
  await tap(P, "[data-close]"); await sleep(1500);
  ok(await until(P, () => !document.querySelector("#pt-empty")?.hidden), `${lang}: alone in the room: invite your friends, the QR`);
  if (shots) await shot(P, lang, "B9-empty-room", "the empty room: invite, games work best with 3+");
  const ev = await P.evaluate(() => (window.__events ?? []).map(e => `${e.name}${e.props.trigger ? `:${e.props.trigger}` : ""}`));
  ok(ev.includes("own_party_created") && !ev.some(n => n.startsWith("verification_")), `${lang}: analytics: own_party_created, and no verification`);
  if (record) await writeVideo(`pathB-${lang}`, casts);
  // settings: language, permissions, account
  await P.evaluate(() => window.__onb.settings()); await sleep(800);
  if (shots) await shot(P, lang, "B10-settings", "Settings: language, location, notifications, account");
  await P.evaluate(() => document.querySelector("[data-sheet=settings] [data-close]")?.click());
  return { P, ctx };
}

// ---- a declined location pre-prompt: the map still works
async function declinedLocation(lang) {
  const ctx = await phoneContext({ lang });
  const P = await page(ctx, appUrl(`&me=dana&av=${encodeURIComponent(JSON.stringify(LOOKS.mina))}`), "dana");
  await screenIs(P, "start", 90000); await sleep(2000);
  await tap(P, ".st-panel [data-join]"); await sleep(300);
  await tap(P, ".st-panel [data-nearby]");
  ok(await until(P, () => !!document.querySelector(".onb-perm")), `${lang}: "nearby" asks first, with a pre-prompt (no system dialog yet)`);
  await sleep(500);
  await shot(P, lang, "C1-location-preprompt", "the location pre-prompt");
  await P.evaluate(() => document.querySelector(".onb-perm [data-no]")?.click());
  ok(await until(P, () => document.body.classList.contains("onb-on") === false && !!document.getElementById("navbar")), `${lang}: Not now -> the map anyway`);
  await sleep(1500);
  await shot(P, lang, "C2-map-declined", "declined: the map works, a gentle note");
  const ev = await P.evaluate(() => (window.__events ?? []).filter(e => /permission/.test(e.name)).map(e => `${e.name}:${e.props.permission}`));
  ok(ev.includes("permission_prompted:location") && ev.includes("permission_declined:location"), `${lang}: ${ev.join(", ")}`);
  ok(await P.evaluate(() => !document.getElementById("nav-home").hidden), `${lang}: a way back to the start screen on the map`);
  await ctx.close(); contexts.splice(contexts.indexOf(ctx), 1);
}

// ---- an interrupted install: the invite survives a cold reopen
async function interrupted(lang, party) {
  const ctx = await phoneContext({ lang });
  const N = await page(ctx, party.link.replace(/^https?:\/\/[^/]+/, base), "interrupted");
  ok(await screenIs(N, "start", 60000), `${lang}: the invite's start screen`);
  await screenIs(N, "name", 60000);
  await N.goto(appUrl());     // the app closed and opened again, with no link
  ok(await until(N, () => !!document.querySelector(".st-panel .st-invite"), null, 60000), `${lang}: reopened cold: the same party's invite is back (kept on the phone)`);
  await screenIs(N, "name", 60000); await typeName(N, "#onb-name", "Reo"); await tap(N, "[data-next]");
  await screenIs(N, "char"); await sleep(800); await tap(N, "[data-ok]");
  ok(await until(N, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor"), null, 30000), `${lang}: -> in that party`);
  ok(await N.evaluate(() => !JSON.parse(localStorage.getItem("rando-onb-v1") ?? "{}").pending), `${lang}: the kept invite is cleared once they're in`);
  await N.evaluate(() => window.__onb.party.leave());
  await ctx.close(); contexts.splice(contexts.indexOf(ctx), 1);
}

// ---- a guest verifying mid-party: the same account, still in the party
async function upgradeMidParty(lang, party) {
  const ctx = await phoneContext({ lang, verify: true });
  const N = await page(ctx, party.link.replace(/^https?:\/\/[^/]+/, base), "upgrader");
  await screenIs(N, "name", 60000); await typeName(N, "#onb-name", "Kit"); await tap(N, "[data-next]");
  await screenIs(N, "char"); await sleep(800); await tap(N, "[data-ok]");
  await until(N, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor"), null, 30000);
  const id0 = await N.evaluate(async () => (await import("/web/backend.js")).sb.auth.getSession().then(r => r.data.session.user.id));
  await N.evaluate(() => { window.__onb.verifySheet("save"); });
  await sleep(400);
  await shot(N, lang, "D1-verify-midparty", "Save my progress, mid-party");
  await typeName(N, "#onb-phone", "01098765432"); await tap(N, "[data-send]");
  await until(N, () => !!document.querySelector("#onb-otp")); await typeName(N, "#onb-otp", "123456");
  await sleep(1500);
  const after = await N.evaluate(async () => { const u = (await (await import("/web/backend.js")).sb.auth.getSession()).data.session.user; return { id: u.id, phone: u.phone, anon: u.is_anonymous }; });
  ok(after.id === id0 && after.phone === "+821098765432" && after.anon === false, `${lang}: verified, same account (${after.id}), the number linked (${after.phone})`);
  ok(await N.evaluate(() => !document.querySelector("#party-panel")?.hidden && !!document.querySelector("#pt-floor")), `${lang}: still in the party`);
  ok(await until(party.H, id => [...document.querySelectorAll(".lr-av")].length >= 4, after.id, 10000), `${lang}: the host still sees them`);
  await N.evaluate(() => window.__onb.party.leave());
  await ctx.close(); contexts.splice(contexts.indexOf(ctx), 1);
}

// ================================================================ run
const timings = [];
const ONLY = process.argv.find(a => a.startsWith("--only="))?.slice(7);
if (ONLY === "fresh") {
  const party = await hostParty("en", { shots: false });
  const r = await pathA("en", party, { shots: false, tag: " fresh" });
  console.log(`  in ${r.tIn} · first game ${r.tGame}`);
  console.log(errors.length ? `✗ page errors: ${[...new Set(errors)].slice(0, 6).join(" | ")}` : "✓ no page errors");
  await browser.close(); close(); process.exit(fails ? 1 : 0);
}
for (const [li, lang] of LANGS.entries()) {
  console.log(`\n==== ${lang}`);
  console.log("\nPath B (a cold open)");
  const b = await pathB(lang, { record: li === 0 });
  await b.ctx.close(); contexts.splice(contexts.indexOf(b.ctx), 1);
  console.log("\nPath A (an invite link)");
  const party = await hostParty(lang);
  const a = await pathA(lang, party, { record: li === 0 });
  timings.push({ lang, phone: "390x844", tIn: a.tIn, tGame: a.tGame });
  await tap(a.N, "#pt-leave"); await a.ctx.close(); contexts.splice(contexts.indexOf(a.ctx), 1);
  if (li === 0) {
    console.log("\nA declined location");
    await declinedLocation(lang);
    console.log("\nAn interrupted install");
    await interrupted(lang, party);
    console.log("\nA guest verifying mid-party");
    await upgradeMidParty(lang, party);
    console.log("\nTap -> first game, 5 fresh phones");
    const PHONES = [["iPhone SE", { width: 320, height: 568 }, "en"], ["iPhone 8", { width: 375, height: 667 }, "ko"], ["Galaxy S", { width: 360, height: 780 }, "ko"], ["iPhone 14", { width: 390, height: 844 }, "en"], ["iPhone Plus", { width: 414, height: 896 }, "ko"]];
    for (const [i, [label, viewport, l]] of PHONES.entries()) {
      const r = await pathA(l, party, { shots: false, viewport, tag: ` #${i + 1} ${label}`, name: l === "ko" ? `민지${i}` : `Sam${i}` });
      timings.push({ lang: l, phone: label, tIn: r.tIn, tGame: r.tGame, run: i + 1, steps: r.steps });
      await tap(r.N, "#pt-leave"); await r.ctx.close(); contexts.splice(contexts.indexOf(r.ctx), 1);
    }
  }
  for (const c of [party.ctx, party.fctx]) { await c.close(); contexts.splice(contexts.indexOf(c), 1); }
}
const runs = timings.filter(x => x.run).map(x => x.tGame).sort((a, b) => a - b);
console.log("\nTap -> in the room / -> first game (ms):");
for (const x of timings) console.log(`  ${x.run ? `#${x.run} ` : ""}${x.phone} ${x.lang}: in ${x.tIn} · first game ${x.tGame}`);
if (runs.length) console.log(`  median tap -> first game over ${runs.length} fresh phones: ${runs[Math.floor(runs.length / 2)]} ms`);
await writeFile(join(OUT, "timings.json"), JSON.stringify({ human, timings, median: runs[Math.floor(runs.length / 2)] ?? null }, null, 1));
console.log(errors.length ? `✗ page errors: ${[...new Set(errors)].slice(0, 6).join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errors.length || fails ? 1 : 0);
