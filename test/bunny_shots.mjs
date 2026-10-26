// The Art Gallery's host, Bunny, in the masquerade gala (web/bunny.js,
// web/gala.js): loads, then each beat of a piece shot at the reference's
// phone size, with the plaques and the dialog box (dialog.js); the orbit's
// ends; then looking around and the taps, driven with real pointer input
// (the same camera as the Prophet's and the Boss's, npcstage.js):
//   - a drag orbits the camera (as far as ±40° here), it glides home ~4 s after letting go
//   - a pinch zooms in a bit
//   - taps on her, the frame, a candle and a guest reach onTap
// node test/bunny_shots.mjs <dir> [only] [--photo=<url>]
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
const argv = process.argv.slice(2);
const [OUT, ONLY] = argv.filter(a => !a.startsWith("--"));
const PHOTO = argv.find(a => a.startsWith("--photo="))?.slice(8) ?? "/web/games/captions/c5.jpg";
if (!OUT) { console.error("usage: node test/bunny_shots.mjs <dir> [only] [--photo=<url>]"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 376, height: 672 }, deviceScaleFactor: 2, hasTouch: true });
const errs = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
pg.on("pageerror", e => errs.push(e.message));
pg.on("response", r => { if (r.status() >= 400 && !/favicon/.test(r.url())) console.log("  [" + r.status() + "]", r.url()); });
pg.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) console.log("  [page]", m.text()); });
await pg.goto(`${base}/test/bunny.html?retro=high`);
await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 90000 });
const failed = await pg.evaluate(() => window.__failed);
if (failed) { console.log("✗ the scene failed:", failed); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, fn, wait = 1200) => {
  if (ONLY && !name.startsWith(ONLY)) return;
  if (fn) await pg.evaluate(fn); await sleep(wait); await pg.screenshot({ path: join(OUT, `${name}.png`) }); console.log("  shot", name);
};
await pg.evaluate(p => { __p.room.photo(p); }, PHOTO);
// the default view: the photo unveiled, the plaques, her opening line (the approved picture)
await shot("0-default", () => { __p.room.drape(false, { instant: true }); __p.room.spot(1); __plaques(["museum of regret", "do not perceive me"]); __dlg.say("Welcome to the gallery. Masks on. Judge everything.", { instant: true }); }, 2500);
await shot("1-covered", () => { __p.room.drape(true, { instant: true }); __p.room.spot(0); __plaques(null); __dlg.say("Exhibit 2. Still under velvet. Contain yourselves.", { instant: true }); }, 1400);
await shot("2-unveil", () => { __p.room.drape(false); __p.room.spot(1); __p.setPose("unveil"); __dlg.say("Exhibit 2. Note the brushwork. Breathtaking.", { instant: true }); }, 1100);
await shot("2b-unveiled", null, 1500);
await shot("3-gavel", () => { __p.setPose("idle"); __p.play("gavel"); __plaques(["museum of regret", "do not perceive me"], "vote"); __dlg.say("Two titles. One truth. Choose wisely.", { instant: true }); }, 700);
await shot("3b-gavel-rap", null, 1600 * 0.72 - 700 + 40);
await shot("4-judge", () => { __p.play("judge"); __dlg.hide(); }, 1300);
await shot("5-sold", () => { __p.play("gavel"); __dlg.show(); __dlg.say("Sold. To no one.", { instant: true }); }, 1250);
await shot("6-applause", () => { __p.play("applause"); __dlg.say("The people have spoken. Tragically.", { instant: true }); }, 1050);
await shot("7-sip", () => { __p.play("sip"); __dlg.say("Correct. You have taste. Barely.", { instant: true }); }, 1300);
await shot("8-korean", () => { __dlg.say("갤러리에 오신 걸 환영해요. 가면 쓰고. 전부 심사하세요.", { instant: true, name: "버니" }); }, 2400);
await pg.evaluate(() => { __dlg.say("Welcome to the gallery. Masks on. Judge everything.", { instant: true, name: "Bunny" }); __p.setPose("idle"); __plaques(["museum of regret", "do not perceive me"]); });
// the orbit's ends (held down so it doesn't glide home): far left, centre, far right, low, high
const [lo, hi] = await pg.evaluate(() => __p.debug.VIEW.yawRange), [plo, phi] = await pg.evaluate(() => __p.debug.VIEW.pitchRange);
for (const [name, yaw, pitch] of [["o-far-left", lo, 0], ["o-centre", 0, 0], ["o-far-right", hi, 0], ["o-left-low", lo, plo], ["o-right-high", hi, phi]]) {
  if (ONLY && !name.startsWith(ONLY)) continue;
  await pg.mouse.move(370, 8); await pg.mouse.down();
  await pg.evaluate(([y, p]) => Object.assign(__p.debug.want, { yaw: y, pitch: p, zoom: 1 }), [yaw, pitch]);
  await sleep(1500);
  await pg.screenshot({ path: join(OUT, `${name}.png`) }); console.log("  shot", name);
  // the frame and the plaques stay in view and readable
  const fr = await pg.evaluate(() => __p.debug.frameRect());
  ok(fr.left >= -4 && fr.right <= 380 && fr.top >= 0, `${name}: the photo in the frame is in view (${Math.round(fr.left)}..${Math.round(fr.right)})`);
  const r = await pg.evaluate(() => { const b = document.getElementById("pl").getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; });
  ok(r.l >= -2 && r.r <= 378 && r.t > 60 && r.b < 560 && r.w >= 160, `${name}: the plaques are on screen and readable (${Math.round(r.l)}..${Math.round(r.r)} × ${Math.round(r.t)}..${Math.round(r.b)})`);
  await pg.mouse.up();
}
await sleep(4500);

if (!ONLY || ONLY.startsWith("l")) {
  // ---- looking around (real pointer input on the canvas)
  const view = () => pg.evaluate(() => ({ ...__p.debug.view }));
  await pg.evaluate(() => addEventListener("pointerup", () => { window.__lastUp = performance.now(); }, true));
  const drag = async (x0, y0, x1, y1, steps = 12) => { await pg.mouse.move(x0, y0); await pg.mouse.down(); for (let i = 1; i <= steps; i++) { await pg.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await pg.mouse.up(); };
  await drag(330, 140, 60, 150);
  await sleep(700);
  const v1 = await view();
  ok(v1.yaw > 0.4, `a drag to the left orbits the camera round (yaw ${v1.yaw.toFixed(2)})`);
  for (let i = 0; i < 3; i++) { await drag(330, 140, 40, 140); await sleep(150); }
  await sleep(900);
  const v2 = await view();
  ok(v2.yaw > 0.65 && v2.yaw <= 0.701, `it goes as far as ~40° and stops there (yaw ${v2.yaw.toFixed(2)})`);
  await pg.evaluate(async () => { const w = 6000 - (performance.now() - window.__lastUp); if (w > 0) await new Promise(r => setTimeout(r, w)); });
  const v3 = await view();
  ok(Math.abs(v3.yaw) < 0.08 && Math.abs(v3.pitch) < 0.05, `~4 s after letting go it glides back home (yaw ${v3.yaw.toFixed(3)})`);
  // never locked: mid-unveil (the drape sliding, a line typing) a drag still orbits
  await pg.evaluate(() => { __p.room.drape(true, { instant: true }); __p.room.drape(false); __p.setPose("unveil"); __dlg.say("Exhibit 3. The artist was clearly going through something. We all were."); });
  await drag(60, 150, 330, 150); await sleep(500);
  const v4 = await view();
  ok(v4.yaw < -0.3, `during the unveil a drag still orbits (yaw ${v4.yaw.toFixed(2)})`);
  await pg.evaluate(() => __p.setPose("idle"));
  await sleep(6000);
  const cdp = await pg.context().newCDPSession(pg);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch("touchStart", [[160, 250], [220, 250]]);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [[160 - i * 8, 250], [220 + i * 8, 250]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(600);
  const v5 = await view();
  ok(v5.zoom < 0.95 && v5.zoom >= 0.71, `a pinch zooms in a bit (zoom ${v5.zoom.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "l-pinch.png") }); console.log("  shot l-pinch");
  await sleep(5000);
  // ---- taps
  await pg.evaluate(() => { __dlg.say("Welcome to the gallery. Masks on. Judge everything.", { instant: true }); window.__taps = []; __p.onTap = k => { __taps.push(k); if (k === "bunny") __dlg.quip("Don't touch the art. Or me."); return true; }; });
  await pg.mouse.click(190, 215); await sleep(300);           // the photo in the frame
  await pg.mouse.click(290, 168); await sleep(300);           // a candle on the right sconce
  await pg.mouse.click(318, 380); await sleep(400);           // the guests on the right
  await pg.screenshot({ path: join(OUT, "t1-tap-guests.png") }); console.log("  shot t1-tap-guests");
  await pg.mouse.click(88, 330); await sleep(500);            // her
  await pg.screenshot({ path: join(OUT, "t2-tap-her.png") }); console.log("  shot t2-tap-her");
  const taps = await pg.evaluate(() => __taps);
  ok(taps.includes("frame"), "tap the frame: its spotlight flickers");
  ok(taps.includes("candle"), "tap a candle: it flickers");
  ok(taps.includes("guestR"), "tap a guest: they raise their glasses");
  ok(taps.includes("bunny"), "tap her: onTap('bunny') (a line, and a sip or a slow nod)");
  ok(await pg.evaluate(() => document.querySelector(".dlg-text").textContent === "Don't touch the art. Or me."), "her quip shows in the dialog box");
  await sleep(2900);
  ok(await pg.evaluate(() => document.querySelector(".dlg-text").textContent.startsWith("Welcome to the gallery")), "…then the line it interrupted comes back");
}
console.log(errs.length ? `✗ page errors: ${errs.join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errs.length || fails ? 1 : 0);
