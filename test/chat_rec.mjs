// The map's plaza chat, end to end on the REAL app page (offline: Supabase
// faked in test/stubs/supabase.js, with ?strictrt=1 so channels and auth
// events behave as supabase-js 2.118 does them). Three phones in one browser
// context: alice and bob in Itaewon, carol in Calgary (another area).
//
//   node test/chat_rec.mjs <dir> [--prefix=after] [--video] [--live-map]
//
// Checks (each line within 2 s of the send, by that phone's own clock):
//   - after a token refresh (the auth event supabase-js fires on boot as
//     INITIAL_SESSION and then about every hour) the chat still gets lines
//   - bob (on the map) says something: bob sees his own line, alice (same
//     area) sees it, carol (another area) doesn't
//   - another refresh; alice (hidden, exploring) says something: the chat
//     asks to show her on the map first, then she sees her own line, bob sees
//     it, carol doesn't
//   - carol says something in Calgary: she sees it, alice and bob don't
//   - a reload reads the area's lines back (they're stored), and only them
// Exits 1 if any check fails. <dir>/<prefix>-{alice,bob,carol}.png are the
// three phones at the end; --video records them side by side into
// <dir>/<prefix>-frames/ and, with FFMPEG=/path/to/ffmpeg, <dir>/<prefix>-chat.mp4.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/chat_rec.mjs <dir> [--prefix=after] [--video] [--live-map]"); process.exit(2); }
const PREFIX = args.find(a => a.startsWith("--prefix="))?.slice(9) ?? "chat";
const VIDEO = args.includes("--video");
await mkdir(OUT, { recursive: true });

const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  // three phones side by side: none of them is a background tab
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] });
// one context: the tabs share the fake server (BroadcastChannel + localStorage)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
// each phone notes when every chat line shows up (its own clock: the same
// machine's), so a slow software-GL page can't blur the 2 s budget
await ctx.addInitScript(() => {
  window.__chatAt = {};
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("pub-line")) window.__chatAt[n.textContent] ??= Date.now(); })
    .observe(document, { childList: true, subtree: true });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };

const ITAEWON = "devlat=37.5347&devlng=126.9945", CALGARY = "devlat=51.0447&devlng=-114.0719";
async function phone(name, where) {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text().slice(0, 200)}`); });
  await pg.goto(`${base}/app.html?onb=0&strictrt=1&crowd=2&me=${name}&${where}`);
  await ready(pg);
  await holdMap(pg);
  return pg;
}
// three 3D maps on software GL can starve a busy machine's main threads for
// tens of seconds; what's tested here is DOM and Realtime, so once a phone's
// map has drawn for a moment it holds that frame (the chat stays live over
// it). --live-map keeps them drawing.
async function holdMap(pg) {
  if (args.includes("--live-map")) return;
  await sleep(8000);
  await pg.evaluate(async () => { const { world3d } = await import("/web/world3d.js"); world3d.setPaused(true); world3d.setPaused = () => {}; });
}
const lines = pg => pg.evaluate(() => [...document.querySelectorAll("#pubchat-feed .pub-line")].map(l => l.textContent));
const has = async (pg, text) => (await lines(pg)).some(l => l.includes(text));
// ms from `sentAt` until `text` showed up on that phone (waits up to `wait` ms of wall time), or null
async function arrival(pg, text, sentAt, wait = 8000) {
  const t0 = Date.now();
  for (;;) {
    const at = await pg.evaluate(t => Object.entries(window.__chatAt).find(([l]) => l.includes(t))?.[1] ?? null, text);
    if (at !== null && await has(pg, text)) return Math.max(0, at - sentAt);
    if (Date.now() - t0 > wait) return null;
    await sleep(200);
  }
}
const inTime = (ms, what) => check(ms !== null && ms <= 2000, `${what}${ms !== null ? ` (${ms} ms)` : " (never)"}`);
const visible = pg => pg.evaluate(() => document.getElementById("zone-name")?.textContent !== "hidden · exploring");
const ready = pg => pg.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 180000 });

// a tap on a button that must be on top where a finger lands (nothing over
// it: the bar, a scrim, the notes button). Software GL can keep a page's
// main thread busy for long stretches, so the click itself is dispatched.
async function tap(pg, sel, label = sel) {
  const top = await pg.evaluate(s => {
    const e = document.querySelector(s); if (!e) return "missing";
    const b = e.getBoundingClientRect(); if (!b.width || !b.height) return "zero-size";
    const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return at && (at === e || e.contains(at)) ? "ok" : `covered by ${at?.id || at?.className || at?.tagName}`;
  }, sel);
  if (top !== "ok") check(false, `${label} is tappable (${top})`);
  await pg.evaluate(s => document.querySelector(s)?.click(), sel);
}
// say something in the plaza chat, as a player would: the chat button, type, send
// (and, if the chat asks to show you on the map first, yes). Returns when it
// went (that phone's clock) and whether it was asked.
async function say(pg, text) {
  await pg.bringToFront();
  if (await pg.locator("#pubchat-open").isVisible()) await tap(pg, "#pubchat-open", "the chat button");
  await pg.fill("#pubchat-input", text);
  let sentAt = await pg.evaluate(() => Date.now());
  await tap(pg, "#pubchat-send", "the send button");
  const ask = pg.locator("#pubchat-ask [data-yes]");
  try { await ask.waitFor({ state: "visible", timeout: 1500 }); } catch { return { sentAt, asked: false }; }
  await moment("alice is asked to show herself first");
  sentAt = await pg.evaluate(() => Date.now());
  await tap(pg, "#pubchat-ask [data-yes]", "the chat's Show me button");
  return { sentAt, asked: true };
}

const alice = await phone("alice", ITAEWON);
const bob = await phone("bob", ITAEWON);
const carol = await phone("carol", CALGARY);
const all = [["alice", alice], ["bob", bob], ["carol", carol]];
await sleep(2500);
// supabase-js refreshes the session token (about hourly, and when a phone wakes): the app's auth handler runs again
const refresh = async () => { for (const [, pg] of all) await pg.evaluate(() => window.__authEvent("TOKEN_REFRESHED")); await sleep(1200); };

// --video: the three phones side by side at each moment that matters (a
// screenshot of each, in turn: a continuous recording of three software-GL
// pages can't keep up on a busy machine), each held 2.5 s in <prefix>-chat.mp4
const rec = VIDEO ? { dir: join(OUT, `${PREFIX}-frames`), n: 0 } : null;
if (rec) await mkdir(rec.dir, { recursive: true });
async function moment(what) {
  if (!rec) return;
  const i = String(rec.n).padStart(2, "0");
  for (const [n, pg] of all) await pg.screenshot({ path: join(rec.dir, `${i}_${n}.png`), timeout: 120000 }).catch(e => console.warn("screenshot:", e.message));
  rec.n++;
  console.log(`  [frame ${i}] ${what}`);
}

// bob and carol go on the map the way the bar offers it (alice stays hidden, exploring)
for (const [n, pg] of [["bob", bob], ["carol", carol]]) {
  await pg.bringToFront();
  await tap(pg, "#nav-explore", "the bar's Explore button");
  await pg.waitForFunction(() => document.getElementById("zone-name")?.textContent !== "hidden · exploring", null, { timeout: 90000 }).catch(() => {});
  check(await visible(pg), `${n} is on the map after tapping the bar's Explore button`);
}
await moment("bob and carol on the map, alice hidden");
await refresh();

// 1. bob, on the map, in Itaewon
let s = await say(bob, "hi from bob");
inTime(await arrival(bob, "hi from bob", s.sentAt), "bob sees his own message");
inTime(await arrival(alice, "hi from bob", s.sentAt), "alice (same area) gets bob's message");
check(!(await has(carol, "hi from bob")), "carol (Calgary) doesn't get bob's message");
await moment("bob said hi: bob and alice have it, carol (Calgary) doesn't");

// 2. another refresh; alice, hidden: the chat asks to show her first
await refresh();
s = await say(alice, "hey bob, at the station");
check(s.asked, "alice (hidden) is asked to show herself on the map before her message goes");
inTime(await arrival(alice, "hey bob, at the station", s.sentAt), "alice sees her own message");
inTime(await arrival(bob, "hey bob, at the station", s.sentAt), "bob (same area) gets alice's message");
check(await visible(alice), "alice is on the map now");
check(!(await has(carol, "hey bob")), "carol (Calgary) doesn't get alice's message");
await moment("alice, on the map now, answered: both have it");

// 3. carol, in Calgary
s = await say(carol, "hello from calgary");
inTime(await arrival(carol, "hello from calgary", s.sentAt), "carol sees her own message");
await sleep(1500);
check(!(await has(alice, "calgary")) && !(await has(bob, "calgary")), "alice and bob (Itaewon) don't get carol's message");
await moment("carol said hello in Calgary: only she has it");
await bob.bringToFront();
await sleep(1500);

// the three phones at the end
for (const [n, pg] of all) await pg.screenshot({ path: join(OUT, `${PREFIX}-${n}.png`), timeout: 120000 }).catch(e => console.warn("screenshot:", e.message));

// 4. stored: a reload reads the area's lines back
await bob.reload(); await ready(bob); await holdMap(bob);
await bob.waitForFunction(() => document.querySelectorAll("#pubchat-feed .pub-line").length > 2, null, { timeout: 30000 }).catch(() => {});
check(await has(bob, "hey bob, at the station") && await has(bob, "hi from bob"), "after a reload bob reads both Itaewon messages back");
check(!(await has(bob, "calgary")), "…and not Calgary's");
await carol.reload(); await ready(carol); await holdMap(carol);
await carol.waitForFunction(() => document.querySelectorAll("#pubchat-feed .pub-line").length > 0, null, { timeout: 30000 }).catch(() => {});
check(await has(carol, "hello from calgary"), "after a reload carol reads Calgary's message back");
check(!(await has(carol, "hi from bob")) && !(await has(carol, "coffee line")), "…and none of Itaewon's");

if (rec?.n) {
  const ff = process.env.FFMPEG;
  if (ff) {
    try {
      for (let i = 0; i < rec.n; i++) {
        const k = String(i).padStart(2, "0");
        execFileSync(ff, ["-y", "-loglevel", "error", ...all.flatMap(([n]) => ["-i", join(rec.dir, `${k}_${n}.png`)]),
          "-filter_complex", "[0][1][2]hstack=inputs=3", join(rec.dir, `${k}.png`)]);
      }
      execFileSync(ff, ["-y", "-loglevel", "error", "-framerate", "0.4", "-i", join(rec.dir, "%02d.png"),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "10", join(OUT, `${PREFIX}-chat.mp4`)]);
      console.log(`${rec.n} moments -> ${join(OUT, `${PREFIX}-chat.mp4`)} (side by side: ${join(rec.dir, "NN.png")})`);
    } catch (e) { console.warn("ffmpeg failed:", e.message); }
  } else console.log(`${rec.n} moments in ${rec.dir} (FFMPEG=… for an mp4)`);
}

const failed = results.filter(r => !r.ok).length;
await writeFile(join(OUT, `${PREFIX}-results.json`), JSON.stringify({ results, errors }, null, 2));
if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
console.log(`${results.length - failed}/${results.length} checks passed`);
await browser.close(); await close();
process.exit(failed ? 1 : 0);
