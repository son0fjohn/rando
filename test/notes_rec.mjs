// Notes on the map, recorded on the REAL app page offline (test/appserve.mjs
// /app.html, Supabase faked: test/stubs/notes_stub.js; locations simulated
// with ?devlat=&devlng=, moved with history.replaceState). Two phones in one
// browser context (one fake server), each in its own window, both guests
// (no phone verification: 020_notes_no_verify.sql). Every tap is a real
// pointer tap at the element's centre, after checking nothing covers it:
//   alice leaves a text note, a photo (a JPEG the test builds WITH an EXIF
//   GPS block: the uploaded bytes are checked for APP1 / Exif / GPS), a meme,
//   and a magenta "bad" picture the fake moderator rejects;
//   bob sees the markers from ~450 m away; a tap says "Get closer to read
//   this"; he walks closer until the 80 m ring shows; opens the text note
//   (upvotes, agrees), the photo and the meme (their moderated public
//   copies, drawn); leaves a note of his own; alice sees the view, the score
//   and the agree; bob reports the meme and it's gone for both; alice on a
//   residential block: "Notes can't be left here"; zoomed out, a spot's
//   notes fold into a hub.
//   Then a production project that isn't set up (the stub's ?notesSetup=):
//   019 never applied -> the 📝 button says "Notes aren't switched on yet";
//   no buckets -> a photo says "Photos and memes aren't switched on yet", and
//   the message stays (a text note still goes).
//   node test/notes_rec.mjs [dir]        (FFMPEG=/path/to/ffmpeg for notes.mp4; else frame strips)
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
import { hasMetadata } from "../web/noteimage.js";

const OUT = process.argv[2] || "/tmp/claude-0/-home-user-rando/639064d3-21be-5570-b1b9-d494a1b0bb43/scratchpad/notes";
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true).catch(() => false);
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const report = [];

// places: A by Itaewon station (a street), a residential block 400 m north-west
const A = { lat: 37.5347, lng: 126.9945 };
const RES = { lat: 37.537578, lng: 126.992612 };
const off = (p, n, e) => ({ lat: p.lat + n / 110540, lng: p.lng + e / (111320 * Math.cos(p.lat * Math.PI / 180)) });

// (1x: two live 3D maps in software GL on one CPU; 2x quadruples the work)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
// every toast the page shows, recorded as it's added (on a slow machine a 3 s
// toast can come and go between two polls)
const TOASTS = () => { window.__toasts = []; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("glass-toast")) window.__toasts.push(n.textContent); }).observe(document.documentElement, { childList: true, subtree: true }); };
await ctx.addInitScript(TOASTS);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("rando-hint-v1", "1");
    localStorage.setItem("stub-moderate-ms", "6000");   // (long enough to see "pending" on a slow machine)
  } catch {}

});
const bcdp = await browser.newBrowserCDPSession();
let cid = null;
async function win() {
  if (!cid) { const p = await ctx.newPage(); cid = (await (await ctx.newCDPSession(p)).send("Target.getTargetInfo")).targetInfo.browserContextId; return p; }
  const made = ctx.waitForEvent("page");
  await bcdp.send("Target.createTarget", { url: "about:blank", browserContextId: cid, newWindow: true, background: false });
  const pg = await made; await pg.setViewportSize({ width: 390, height: 844 }); return pg;
}
async function phone(name, at, { pg = null, q = "" } = {}) {
  pg ??= await win();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  pg.on("console", m => { if (/\[notes\]/.test(m.text())) console.log(`  [${name}] ${m.text().slice(0, 300)}`); });
  await pg.goto(`${base}/app.html?onb=0&me=${name}&verify=1&mode=night&devlat=${at.lat}&devlng=${at.lng}${q}`);
  await pg.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 90000 });
  ok(await until(pg, () => document.body.classList.contains("notes-on") && !!document.getElementById("notes-leave"), null, 180000), `${name}: the world screen has "Leave a note"`);
  return pg;
}
async function cast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  return { pg, frames, stop: () => cdp.send("Page.stopScreencast").catch(() => {}) };
}
// a shot: the page itself (page.screenshot, which waits for a fresh frame:
// slow on a busy machine without a GPU); if that times out, the phone's
// latest screencast frame (which can lag a step behind)
const shots = [];
const shot = async (pg, n, note) => {
  await pg.bringToFront(); await sleep(2200);     // (a dialog's fade-in, on a slow machine)
  const t0 = Date.now();
  let okShot = await pg.screenshot({ path: join(OUT, `${n}.jpg`), type: "jpeg", quality: 82, timeout: 180000 }).then(() => true).catch(() => false);
  if (!okShot) {
    const c = casts.find(x => x.pg === pg), f = c?.frames[c.frames.length - 1];
    if (f) { await writeFile(join(OUT, `${n}.jpg`), Buffer.from(f.data, "base64")); okShot = true; console.log(`  (${n}: the screencast's last frame)`); }
  }
  if (okShot) { shots.push({ n, note }); console.log(`  shot ${n} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
};
// the phone being used draws (at 15 fps), the other one's map is paused
// (software GL on a shared CPU: two live maps starve each other)
async function use(pg) {
  for (const c of casts) await c.pg.evaluate(async on => { const { world3d } = await import("/web/world3d.js"); world3d.maxFps = 15; world3d.setPaused(!on); }, c.pg === pg).catch(() => {});
  await pg.bringToFront();
  await until(pg, () => document.body.classList.contains("notes-on"), null, 20000);    // (the notes layer is back with the map)
}
// a real tap at the element's centre (pointer events, hit testing), after
// checking that it's what's on top there (nothing over the 📝 button or a marker)
const hits = [];
async function tap(pg, sel) {
  const look = () => pg.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = r.width ? document.elementFromPoint(x, y) : null;
    return { x, y, on: !!top && (top === el || el.contains(top)), top: top ? `${top.tagName.toLowerCase()}${top.id ? "#" + top.id : ""}.${String(top.className).split(" ")[0]}` : "nothing (not shown)" };
  }, sel);
  // (up to 10 s for it to be shown and settle: a sheet sliding in, a layer coming back)
  let at = await look();
  for (let i = 0; i < 20 && at && !at.on; i++) { await sleep(500); at = await look(); }
  if (!at) return false;
  if (!at.on) { hits.push(`${sel} under ${at.top}`); console.log(`  ✗ ${sel} is covered by ${at.top}`); fails++; }
  await pg.mouse.click(at.x, at.y);
  return true;
}
const move = (pg, p) => pg.evaluate(p => { const u = new URL(location.href); u.searchParams.set("devlat", p.lat); u.searchParams.set("devlng", p.lng); history.replaceState(null, "", u); }, p);
// the camera over a spot (as a pan would), at a zoom
const look = (pg, p, dist = 175) => pg.evaluate(async ({ p, dist }) => {
  const { world3d } = await import("/web/world3d.js");
  const g = world3d.geo(p.lat, p.lng);
  world3d.observing = true; world3d.target.set(g.x, g.y, g.z); world3d.camGoal = { ...world3d.cam, dist, elev: 0.75 }; world3d.applyCamera();
}, { p, dist });
const marks = pg => pg.evaluate(async () => (await import("/web/notes.js")).notes.markers);
const refresh = pg => pg.evaluate(async () => (await import("/web/notes.js")).notes.refresh());
const toastHas = (pg, text) => until(pg, t => (window.__toasts ?? []).some(x => x.includes(t)) || [...document.querySelectorAll(".glass-toast")].some(e => e.textContent.includes(t)), text, 30000);
// a picture made in the page: a JPEG from a canvas, optionally WITH a hand-built EXIF GPS block
const picture = (pg, kind, exif) => pg.evaluate(async ({ kind, exif }) => {
  const { withExifGps, hasMetadata } = await import("/web/noteimage.js");
  const c = Object.assign(document.createElement("canvas"), { width: 1600, height: 1200 }), g = c.getContext("2d");
  if (kind === "bad") { g.fillStyle = "#ff00ff"; g.fillRect(0, 0, 1600, 1200); g.fillStyle = "#fff"; g.font = "bold 120px sans-serif"; g.fillText("flagged test image", 200, 640); }
  else {
    const sky = g.createLinearGradient(0, 0, 0, 1200);
    sky.addColorStop(0, kind === "meme" ? "#ffb347" : "#1d2b64"); sky.addColorStop(1, kind === "meme" ? "#ff5f6d" : "#f8cdda");
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 1200);
    g.fillStyle = "#2b2b3a"; for (let i = 0; i < 9; i++) g.fillRect(i * 180, 520 - (i % 3) * 120, 150, 700);
    g.fillStyle = "#ffe08a"; for (let i = 0; i < 60; i++) g.fillRect(20 + (i * 97) % 1560, 560 + (i * 53) % 560, 22, 30);
    g.fillStyle = kind === "meme" ? "#3a1c71" : "#ffd36b"; g.beginPath(); g.arc(1200, 260, 120, 0, 7); g.fill();
  }
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (exif) bytes = withExifGps(bytes);
  return { bytes: Array.from(bytes), meta: hasMetadata(bytes) };
}, { kind, exif });
async function compose(pg) {
  await tap(pg, "#notes-leave");
  const done = await until(pg, () => !!document.querySelector(".note-compose .ns-post"), null, 90000);
  if (!done) console.log("    (Leave a note got to:", JSON.stringify(await pg.evaluate(async () => ({ step: (await import("/web/notes.js")).notes.step,
    sheets: [...document.querySelectorAll(".onb-sheet, .onb-perm, .notes-scrim")].map(e => e.className), toasts: [...document.querySelectorAll(".glass-toast")].map(e => e.textContent) }))), ")");
  if (done) await sleep(1200);     // (the sheet slides in: tap it once it sits still)
  return done;
}
async function post(pg) {
  await tap(pg, ".note-compose .ns-post");
  const done = await until(pg, () => !document.querySelector(".note-compose"), null, 180000);
  if (!done) console.log("    (composer says:", JSON.stringify(await pg.evaluate(() => document.querySelector(".ns-err")?.textContent + " | " + document.querySelector(".ns-post")?.textContent)), ")");
  return done;
}

console.log("\nTwo phones");
const casts = [];
const P1 = await phone("alice", A);
casts.push(await cast(P1));
await P1.evaluate(async () => { const { world3d } = await import("/web/world3d.js"); world3d.setPaused(true); });
const P2 = await phone("bob", off(A, 450, -60));
casts.push(await cast(P2));

// ---- alice leaves a text note
console.log("\nalice: a text note, a photo, a meme (and a picture the moderator rejects)");
await use(P1);
await look(P1, A, 150); await sleep(2500);
await shot(P1, "01-alice-map", "alice on the street by Itaewon station: the round 📝 note button");
ok(await compose(P1), "Leave a note opens the composer (verified, a public street)");
await P1.locator(".note-compose .ns-text").fill("call me 010-1234-5678"); await sleep(400);
ok(await P1.evaluate(() => document.querySelector(".ns-err").textContent.length > 0 && document.querySelector(".ns-post").disabled), "the filter stops a phone number as you type");
await shot(P1, "02-filter", "a phone number in a note: blocked on the phone (and the server checks again)");
await P1.locator(".note-compose .ns-text").fill("Best tteokbokki on this street. Get the cheese one 🧀"); await sleep(300);
await shot(P1, "03-compose-text", "the composer: Text / Photo / Meme, 5 left today");
ok(await post(P1), "the text note is left");
ok(await until(P1, () => document.querySelectorAll("#notes-layer .note-pin.k-text").length >= 1, null, 10000), "its marker is on the map at once");

// a photo WITH EXIF GPS
await move(P1, off(A, -22, 18));
ok(await compose(P1), "composer again, 22 m on");
await tap(P1, '.ns-seg [data-k="photo"]');
ok(await P1.evaluate(() => !!document.querySelector(".ns-cap").offsetParent && !document.querySelector(".ns-mtop").offsetParent), "Photo: one optional line, no meme captions (they showed in Photo too)");
const photo = await picture(P1, "photo", true);
ok(photo.meta.app1 && photo.meta.exif && photo.meta.gps, "the test photo carries an EXIF APP1 segment with a GPS block (37.5347 N, 126.9945 E)");
await P1.setInputFiles(".note-compose [data-lib-in]", { name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo.bytes) });
await until(P1, () => !document.querySelector(".ns-preview").hidden, null, 10000);
await P1.locator(".note-compose .ns-cap").fill("the sky over Itaewon tonight"); await sleep(400);
await shot(P1, "04-compose-photo", "a photo from the library, with a line");
const before = await P1.evaluate(() => window.__noteUploads.length);
ok(await post(P1), "the photo note is left");
const up = await P1.evaluate(n => window.__noteUploads[n], before);
const upBytes = Uint8Array.from(up?.bytes ?? []);
const meta = hasMetadata(upBytes);
const ascii = Buffer.from(upBytes).toString("latin1");
const exifCheck = { inputHadGps: photo.meta.gps, uploaded: { bytes: upBytes.length, app1: meta.app1, exif: meta.exif, gps: meta.gps, other: meta.other, anyExifString: ascii.includes("Exif\0\0") } };
const dims = await P1.evaluate(async b => { const bm = await createImageBitmap(new Blob([Uint8Array.from(b)], { type: "image/jpeg" })); return [bm.width, bm.height]; }, Array.from(upBytes));
ok(meta.jpeg && !meta.app1 && !meta.exif && !meta.gps && !meta.other.length && !ascii.includes("Exif\0\0"), `the uploaded bytes carry no APP1 / Exif / GPS (${upBytes.length} bytes, segments clean)`);
ok(Math.max(...dims) <= 1280, `re-encoded at most 1280 px on the long side (${dims.join(" x ")} from 1600 x 1200)`);
ok(/^u-alice\/[0-9a-f-]{36}\.jpg$/.test(up?.path ?? ""), `uploaded into alice's own folder of the private bucket (${up?.path})`);
report.push({ exif: exifCheck, dims });
ok(await until(P1, () => document.querySelector("#notes-layer .note-pin.k-photo.pending"), null, 5000), "the photo's marker is pending (only alice sees it)");

// a meme
await move(P1, off(A, 25, 5));     // (by Danco, like the text note: the two make a hub)
ok(await compose(P1), "composer, 25 m north");
await tap(P1, '.ns-seg [data-k="meme"]');
ok(await P1.evaluate(() => !!document.querySelector(".ns-mtop").offsetParent && !document.querySelector(".ns-cap").offsetParent), "Meme: the top / bottom captions show, the photo's line doesn't");
const mp = await picture(P1, "meme", false);
await P1.setInputFiles(".note-compose [data-lib-in]", { name: "meme.jpg", mimeType: "image/jpeg", buffer: Buffer.from(mp.bytes) });
await until(P1, () => !document.querySelector(".ns-preview").hidden, null, 10000);
await P1.locator(".note-compose .ns-mtop").fill("when the last train"); await sleep(200);
await P1.locator(".note-compose .ns-mbottom").fill("is 4 minutes away"); await sleep(600);
await shot(P1, "05-compose-meme", "the meme maker: white Impact, black outline, drawn on a canvas live");
ok(await post(P1), "the meme is left");
// the flagged picture
await move(P1, off(A, -8, -48));
ok(await compose(P1), "one more: a picture the moderator should refuse");
await tap(P1, '.ns-seg [data-k="photo"]');
const bad = await picture(P1, "bad", false);
await P1.setInputFiles(".note-compose [data-lib-in]", { name: "bad.jpg", mimeType: "image/jpeg", buffer: Buffer.from(bad.bytes) });
await until(P1, () => !document.querySelector(".ns-preview").hidden, null, 10000);
ok(await post(P1), "left (pending)");
await sleep(500);
await shot(P1, "06-alice-pending", "alice's map: the text note, and her three pictures pending (dashed)");
// the fake moderator: 6 s
await sleep(7000); await refresh(P1); await sleep(1500);
const m1 = await marks(P1);
ok(m1.filter(m => m.kind !== "text" && !m.state).length === 2 && m1.some(m => m.state === "rejected"), `moderated: the photo and the meme pass, the magenta one is rejected (${m1.map(m => `${m.kind}:${m.state ?? "live"}`).join(", ")})`);
await shot(P1, "07-alice-moderated", "after the check: two pictures live, the flagged one greyed (rejected: only alice sees it)");

// ---- bob, unverified and far away
console.log("\nbob: far away, then closer");
await use(P2);
// bob is a guest (no phone): he can leave one too (020_notes_no_verify.sql)
ok(await compose(P2), "bob (a guest, not verified) opens the composer");
await P2.locator(".note-compose .ns-text").fill("hello from up the hill"); await sleep(300);
await shot(P2, "08-bob-compose", "bob, a guest with no phone number, writing a note ~450 m away");
ok(await post(P2), "bob's note is left: no verification needed");
await sleep(800);
// (at 175: past HUB_DIST (200) a spot's notes fold into one hub and their own markers hide)
await look(P2, A, 175); await sleep(1500); await refresh(P2); await sleep(2500);
const m2 = await marks(P2);
const theirs = m2.filter(m => !m.mine);
ok(theirs.length === 3 && !theirs.some(m => m.near), `from ~450 m: alice's 3 notes on bob's map (text, photo, meme; the rejected one isn't), none in range (${theirs.map(m => m.kind).join(", ")})`);
await shot(P2, "09-bob-far", "bob ~450 m away, looking over: the markers, no rings");
const textId = theirs.find(m => m.kind === "text").id, memeId = theirs.find(m => m.kind === "meme").id, photoId = theirs.find(m => m.kind === "photo").id;
await tap(P2, `.note-pin[data-id="${textId}"]`);
ok(await toastHas(P2, "Get closer to read this"), "tapping one from there: \"Get closer to read this\"");
await shot(P2, "10-bob-closer", "Get closer to read this");
// zoomed out: the spot's notes fold into a hub
await look(P2, A, 380); await sleep(2500);
const hub = await P2.evaluate(() => [...document.querySelectorAll(".note-hub")].map(h => h.textContent));
ok(hub.length >= 1, `zoomed out: the notes at a spot fold into a hub (${hub.join(" / ")})`);
await shot(P2, "11-bob-hub", "zoomed out: a hub with its count and the spot's name");
// walking closer, 40 m at a time, until the ring shows
let steps = 0, ringAt = null;
await look(P2, A, 175);
for (let d = 400; d >= 0; d -= 40) {
  const p = off(A, d, -60 * d / 450);
  await move(P2, p); await sleep(1700); steps++;
  const m = await marks(P2);
  if (m.find(x => x.id === textId)?.near) { ringAt = d; break; }
}
ok(ringAt !== null && ringAt <= 90, `walking closer (${steps} steps): the ring shows at ~${ringAt} m`);
await shot(P2, "12-bob-ring", "within 80 m: the soft glowing ring");
await tap(P2, `.note-pin[data-id="${textId}"]`);
ok(await until(P2, () => !!document.querySelector(".note-open .nc-text"), null, 15000), "bob opens the text note");
const v0 = await P2.evaluate(() => document.querySelector(".note-open .nc-meta").textContent);
ok(/1 view/.test(v0) && !/alice/i.test(await P2.evaluate(() => document.querySelector(".note-open").textContent)), `content, time and views ("${v0}"), and nothing says who wrote it`);
await shot(P2, "13-bob-open", "an opened note: the text, when, views, score, agree / disagree, report");
await tap(P2, ".note-open .nc-up");
ok(await until(P2, () => document.querySelector(".note-open .nc-score")?.textContent === "+1", null, 10000), "upvote: +1");
await tap(P2, ".note-open .nc-agree");
ok(await until(P2, () => document.querySelector(".note-open .nc-agree b")?.textContent === "1", null, 10000), "agree: 1");
await shot(P2, "14-bob-voted", "upvoted and agreed (one each; tapping again takes it back)");
await tap(P2, ".note-open .nc-x"); await sleep(600);
// the photo: its moderated public copy, drawn
await move(P2, off(A, -10, 10)); await look(P2, off(A, -22, 18), 150); await sleep(2200);
await tap(P2, `.note-pin[data-id="${photoId}"]`);
ok(await until(P2, () => { const i = document.querySelector(".note-open .nc-pic img"); return !!i?.complete && i.naturalWidth > 0; }, null, 15000), "bob opens the photo: the picture is drawn (the public copy)");
ok(/the sky over Itaewon/.test(await P2.evaluate(() => document.querySelector(".note-open .nc-text")?.textContent ?? "")), "with its line");
await shot(P2, "14b-bob-photo", "bob opens alice's photo note");
await tap(P2, ".note-open .nc-x"); await sleep(600);

// ---- alice sees it
await use(P1);
await move(P1, A); await look(P1, A, 150); await sleep(1500);
await tap(P1, `.note-pin[data-id="${textId}"]`);
ok(await until(P1, () => !!document.querySelector(".note-open .nc-text"), null, 15000), "alice opens her own note");
const a1 = await P1.evaluate(() => ({ meta: document.querySelector(".note-open .nc-meta").textContent, score: document.querySelector(".note-open .nc-score").textContent, agree: document.querySelector(".note-open .nc-agree b").textContent }));
ok(/1 view/.test(a1.meta) && a1.score === "+1" && a1.agree === "1", `alice sees bob's visit: ${a1.meta} · score ${a1.score} · agree ${a1.agree}`);
await shot(P1, "15-alice-views", "the author's view: 1 view, +1, 1 agree, and Take it down instead of voting");
await tap(P1, ".note-open .nc-x"); await sleep(400);

// ---- bob reports the meme
await use(P2);
await move(P2, off(A, 30, 0)); await look(P2, off(A, 25, 5), 150); await sleep(2000);
await tap(P2, `.note-pin[data-id="${memeId}"]`);
ok(await until(P2, () => { const i = document.querySelector(".note-open .nc-pic img"); return !!i?.complete && i.naturalWidth > 0; }, null, 15000), "bob opens the meme (the moderated public copy, drawn)");
await sleep(800);
await shot(P2, "16-bob-meme", "the meme, opened");
await tap(P2, ".note-open .nc-report");
ok(await until(P2, () => !!document.querySelector(".note-confirm [data-yes]"), null, 5000), "Report asks first");
await shot(P2, "17-report-confirm", "Report this note? It's hidden for everyone right away");
await tap(P2, ".note-confirm [data-yes]");
ok(await toastHas(P2, "Reported"), "reported");
await sleep(800);
ok(!(await marks(P2)).some(m => m.id === memeId), "the meme is gone from bob's map at once");
await shot(P2, "18-bob-reported", "reported: gone from the map");
await refresh(P1); await sleep(1500);
ok(!(await marks(P1)).some(m => m.id === memeId), "…and from alice's (hidden for everyone until reviewed)");

// ---- a residential block
console.log("\nalice on a residential block");
await use(P1);
await move(P1, RES); await look(P1, RES, 150); await sleep(2500);
await tap(P1, "#notes-leave");
ok(await until(P1, () => document.querySelector(".note-blocked")?.textContent.includes("Notes can't be left here"), null, 20000), "on a residential block: \"Notes can't be left here\"");
await shot(P1, "19-residential", "Notes can't be left here (a block of homes in Itaewon's map data)");
await tap(P1, ".note-blocked [data-ok]");
// Korean
await P1.evaluate(async () => { (await import("/web/i18n.js")).setLang("ko"); }); await sleep(300);
await tap(P1, "#notes-leave");
ok(await until(P1, () => document.querySelector(".note-blocked")?.textContent.includes("여기에는 쪽지를 남길 수 없어요"), null, 20000), "…and in Korean: \"여기에는 쪽지를 남길 수 없어요\"");
await shot(P1, "20-residential-ko", "the same in Korean");
await tap(P1, ".note-blocked [data-ok]");
await P1.evaluate(async () => { (await import("/web/i18n.js")).setLang("en"); });

// ---- a production project that isn't set up for notes (the stub's ?notesSetup=)
console.log("\nnot set up: 019 never applied; no buckets");
await Promise.all(casts.map(c => c.pg.evaluate(async () => { const { world3d } = await import("/web/world3d.js"); world3d.setPaused(true); }).catch(() => {})));
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
await ctx2.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
await ctx2.addInitScript(TOASTS);
{
  const pg = await phone("cy", A, { pg: await ctx2.newPage(), q: "&notesSetup=none" });
  await pg.evaluate(async () => { const { world3d } = await import("/web/world3d.js"); world3d.maxFps = 15; });
  await look(pg, A, 150); await sleep(1500);
  await tap(pg, "#notes-leave");
  ok(await toastHas(pg, "Notes aren't switched on yet"), "019 not applied: the 📝 button says \"Notes aren't switched on yet\" (no composer that fails at the end)");
  ok(!(await pg.evaluate(() => !!document.querySelector(".note-compose"))), "and no composer opens");
  await shot(pg, "21-not-set-up", "the server has no notes yet (019 not applied): said at once, on the tap");
  await pg.goto(`${base}/app.html?onb=0&me=cy&mode=night&devlat=${A.lat}&devlng=${A.lng}&notesSetup=no-buckets`);
  ok(await until(pg, () => document.body.classList.contains("notes-on"), null, 180000), "cy again, on a project without the buckets");
  await look(pg, A, 150); await sleep(1500);
  ok(await compose(pg), "the composer opens (the API is there)");
  await tap(pg, '.ns-seg [data-k="photo"]');
  const ph = await picture(pg, "photo", false);
  await pg.setInputFiles(".note-compose [data-lib-in]", { name: "IMG_0100.jpg", mimeType: "image/jpeg", buffer: Buffer.from(ph.bytes) });
  await until(pg, () => !document.querySelector(".ns-preview").hidden, null, 10000);
  await tap(pg, ".note-compose .ns-post");
  ok(await until(pg, () => /Photos and memes aren't switched on yet/.test(document.querySelector(".note-compose .ns-err")?.textContent ?? ""), null, 20000), "a photo: \"Photos and memes aren't switched on yet\"");
  await sleep(1500);
  ok(/aren't switched on yet/.test(await pg.evaluate(() => document.querySelector(".note-compose .ns-err")?.textContent ?? "")), "and the message stays (it isn't wiped by the form's own check)");
  await shot(pg, "22-no-buckets", "no buckets in Storage: the photo is refused with a reason that stays on screen");
  await tap(pg, '.ns-seg [data-k="text"]');
  await pg.locator(".note-compose .ns-text").fill("text still works"); await sleep(300);
  ok(await post(pg), "a text note still goes");
  await pg.close();
}
await ctx2.close();

// ---- what went to the server: positions only ever snapped
const coins = await P1.evaluate(() => window.__coins());
const stored = coins.notes.list.map(n => [n.lat, n.lng]);
const { snap } = await import("../web/notegeo.js");
ok(stored.every(([lat, lng]) => { const s = snap(lat, lng); return s.lat === lat && s.lng === lng; }), "every stored note position is a 20 m cell centre");
ok(!JSON.stringify(coins.notes).includes(String(off(A, -22, 18).lat)), "no raw position was stored");

// ---- the recording
await Promise.all(casts.map(c => c.stop()));
for (const [k, c] of casts.entries()) {
  const dir = join(OUT, `frames-${k ? "bob" : "alice"}`); await mkdir(dir, { recursive: true });
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < c.frames.length; i++) {
    const n = `f${String(i).padStart(5, "0")}.jpg`;
    await writeFile(join(dir, n), Buffer.from(c.frames[i].data, "base64"));
    list += `file ${n}\nduration ${Math.max(0.016, (c.frames[i + 1]?.t ?? c.frames[i].t + 0.5) - c.frames[i].t).toFixed(3)}\n`;
  }
  await writeFile(join(dir, "frames.ffconcat"), list);
  console.log(`  ${c.frames.length} frames -> ${dir}`);
  if (process.env.FFMPEG) {
    try {
      execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-i", join(dir, "frames.ffconcat"), "-vf", "fps=24,scale=390:844,setsar=1", "-pix_fmt", "yuv420p", "-crf", "27", join(OUT, `notes-${k ? "bob" : "alice"}.mp4`)]);
      console.log(`  wrote notes-${k ? "bob" : "alice"}.mp4`);
    } catch (e) { console.log("  (ffmpeg failed)", e.message); }
  }
}
// frame strips: the shots, five to a row, labelled
if (shots.length) {
  const pg = await ctx.newPage();
  await pg.setViewportSize({ width: 5 * 260, height: 600 });
  const imgs = await Promise.all(shots.map(async s => ({ ...s, src: `data:image/jpeg;base64,${(await readFile(join(OUT, `${s.n}.jpg`))).toString("base64")}` })));
  for (let r = 0; r * 5 < imgs.length; r++) {
    const row = imgs.slice(r * 5, r * 5 + 5);
    await pg.setContent(`<body style="margin:0;background:#0b1020;display:flex;gap:6px;padding:6px;font:12px -apple-system,sans-serif;color:#dfe6ff">${row.map(s => `<figure style="margin:0;width:250px"><img src="${s.src}" style="width:250px;display:block;border-radius:8px"><figcaption style="padding:4px 2px"><b>${s.n}</b> ${s.note.replace(/</g, "&lt;")}</figcaption></figure>`).join("")}</body>`);
    await sleep(300);
    await pg.screenshot({ path: join(OUT, `strip-${r + 1}.png`), fullPage: true });
  }
  await pg.close();
}
await writeFile(join(OUT, "shots.md"), shots.map(s => `- ${s.n}.jpg — ${s.note}`).join("\n") + "\n");
await writeFile(join(OUT, "report.json"), JSON.stringify({ fails, errors, covered: hits, ...report[0] }, null, 2));
console.log("\nEXIF check:", JSON.stringify(report[0]?.exif));
if (errors.length) { console.log("\npage errors:"); for (const e of errors) console.log("  " + e); }
console.log(`\n${fails ? `${fails} FAILED` : "all passed"} · ${shots.length} shots in ${OUT}`);
await browser.close(); close();
process.exit(fails || errors.length ? 1 : 0);
