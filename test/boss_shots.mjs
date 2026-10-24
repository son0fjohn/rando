// The Ritual's host, The Boss, in the basement (web/boss.js, web/basement.js): loads, then each beat of a
// turn shot at the reference's phone size, with the dialog box (dialog.js);
// then looking around and the taps, driven with real pointer input (the
// same camera as the Prophet's, npcstage.js):
//   - a drag orbits the camera, it glides home ~3 s after letting go
//   - hold(true) keeps it home (a drag does nothing)
//   - a pinch zooms in a bit
//   - taps on him, the capsule box, the coffee cup and the lamp reach onTap
// node test/boss_shots.mjs <dir> [only] [--video]   (--video with FFMPEG=...: <dir>/orbit.mp4 of the look-around and the taps)
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";
const argv = process.argv.slice(2), VIDEO = argv.includes("--video");
const [OUT, ONLY] = argv.filter(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/boss_shots.mjs <dir> [only]"); process.exit(2); }
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
await pg.goto(`${base}/test/boss.html?retro=high`);
await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 90000 });
const failed = await pg.evaluate(() => window.__failed);
if (failed) { console.log("✗ the scene failed:", failed); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (name, fn, wait = 1200) => {
  if (ONLY && !name.startsWith(ONLY)) return;
  if (fn) await pg.evaluate(fn); await sleep(wait); await pg.screenshot({ path: join(OUT, `${name}.png`) }); console.log("  shot", name);
};
// a stand-in face for the capsule (in the game it's the player's own render)
await pg.evaluate(() => { window.dot = c => { const k = document.createElement("canvas"); k.width = k.height = 64; const g = k.getContext("2d"); g.fillStyle = c; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill(); g.fillStyle = "#222"; g.fillRect(20, 26, 6, 8); g.fillRect(38, 26, 6, 8); return k.toDataURL(); }; });
await shot("0-default", () => { __dlg.say("Pick a capsule. Any capsule.", { instant: true }); }, 2500);
await shot("1-reach", () => { __p.setPose("reach"); }, 1200);
await shot("2-hold", () => { __p.capsule(dot("#e9a"), "alice"); __p.capsuleState("inhand"); __p.setPose("hold"); __dlg.say("alice. You're up.", { instant: true }); }, 1500);
await shot("3-twist", () => { __p.play("twist"); }, 500);
await shot("4-open", () => { __p.capsuleState("open"); }, 700);
await shot("5-peek", () => { __p.setPose("peek"); __p.play("smirk"); }, 900);
await shot("6-shhh", () => { __p.capsuleState("hidden"); __p.setPose("shhh"); __dlg.say("Shhh.", { instant: true }); }, 1400);
await shot("7-nod", () => { __p.capsuleState("hidden"); __p.setPose("idle"); __p.play("nod"); __dlg.say("bob got it. alice, not bad.", { instant: true }); }, 700);
await shot("8-drag", () => { __p.play("drag"); }, 1300);
await shot("9-korean", () => { __dlg.say("쉿... 이건 너만 보는 거야.", { instant: true, name: "보스" }); }, 2400);
await pg.evaluate(() => { __dlg.say("Pick a capsule. Any capsule.", { instant: true, name: "The Boss" }); __p.setPose("idle"); });
console.log("  capsule on screen:", JSON.stringify(await pg.evaluate(() => __p.capsuleRect())));

if (!ONLY || ONLY.startsWith("o")) {
  // film it (the page's own frames, CDP screencast)
  const frames = [], cdpV = VIDEO ? await pg.context().newCDPSession(pg) : null;
  if (cdpV) {
    cdpV.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdpV.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
    await cdpV.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: 752, maxHeight: 1344, everyNthFrame: 1 });
    // show the finger: a dot where it touches (for the video only)
    await pg.evaluate(() => {
      const st = document.createElement("style"); st.textContent = ".tdot{position:fixed;z-index:99;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.45);border:2px solid #fff;pointer-events:none;transition:opacity .35s}"; document.head.appendChild(st);
      const dots = new Map();
      addEventListener("pointerdown", e => { const d = document.createElement("i"); d.className = "tdot"; d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; document.body.appendChild(d); dots.set(e.pointerId, d); }, true);
      addEventListener("pointermove", e => { const d = dots.get(e.pointerId); if (d) { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; } }, true);
      const up = e => { const d = dots.get(e.pointerId); if (d) { dots.delete(e.pointerId); d.style.opacity = "0"; setTimeout(() => d.remove(), 400); } };
      addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
    });
    await sleep(1200);
  }
  // ---- looking around (real pointer input on the canvas)
  const view = () => pg.evaluate(() => ({ ...__p.debug.view }));
  const drag = async (x0, y0, x1, y1, steps = 12) => { await pg.mouse.move(x0, y0); await pg.mouse.down(); for (let i = 1; i <= steps; i++) { await pg.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16); } await pg.mouse.up(); };
  await drag(300, 200, 80, 230);
  await sleep(700);
  const v1 = await view();
  ok(v1.yaw > 0.4, `a drag to the left orbits the camera round (yaw ${v1.yaw.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "o1-orbit-right.png") }); console.log("  shot o1-orbit-right");
  await drag(80, 200, 380, 200); await sleep(200); await drag(80, 200, 380, 200); await sleep(200); await drag(80, 200, 380, 200);
  await sleep(900);
  const v2 = await view();
  ok(v2.yaw >= -0.43 && v2.yaw <= 0.62, `it stops at -24° on the left (yaw ${v2.yaw.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "o2-orbit-left.png") }); console.log("  shot o2-orbit-left");
  await sleep(2500);
  const v2b = await view();
  ok(Math.abs(v2b.yaw) > 0.3, `2.5 s after letting go it's still where you left it (yaw ${v2b.yaw.toFixed(2)})`);
  await sleep(3500);
  const v3 = await view();
  ok(Math.abs(v3.yaw) < 0.08 && Math.abs(v3.pitch) < 0.05, `~4 s after letting go it glides back home (yaw ${v3.yaw.toFixed(3)})`);
  // never locked: mid-line (the text still typing) a drag still orbits
  await pg.evaluate(() => __dlg.say("Relax. The ball already knows who's next, and so do I, and so does everybody else in here."));
  await drag(300, 200, 60, 200); await sleep(500);
  const v4 = await view();
  ok(Math.abs(v4.yaw) > 0.3, `while a line is typing a drag still orbits (yaw ${v4.yaw.toFixed(2)})`);
  await sleep(6000);
  const cdp = await pg.context().newCDPSession(pg);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch("touchStart", [[160, 250], [220, 250]]);
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [[160 - i * 8, 250], [220 + i * 8, 250]]); await sleep(16); }
  await touch("touchEnd", []);
  await sleep(600);
  const v5 = await view();
  ok(v5.zoom < 0.95 && v5.zoom >= 0.71, `a pinch zooms in a bit (zoom ${v5.zoom.toFixed(2)})`);
  await pg.screenshot({ path: join(OUT, "o3-pinch.png") }); console.log("  shot o3-pinch");
  await sleep(4500);
  // ---- taps
  await pg.evaluate(() => { window.__taps = []; __p.onTap = k => { __taps.push(k); if (k === "boss") __dlg.quip("You owe me a laugh, kid."); return true; }; });
  await pg.mouse.click(250, 352); await sleep(300);           // the capsule box
  await pg.mouse.click(330, 385); await sleep(300);           // the coffee cup
  await pg.screenshot({ path: join(OUT, "t1-tap-cup.png") }); console.log("  shot t1-tap-cup");
  await sleep(2500);
  await pg.mouse.click(14, 300); await sleep(200);            // the lamp's shade, at the left edge
  await pg.mouse.click(140, 185); await sleep(500);           // his face
  await pg.screenshot({ path: join(OUT, "t2-tap-him.png") }); console.log("  shot t2-tap-him");
  const taps = await pg.evaluate(() => __taps);
  ok(taps.includes("box"), "tap the box: the capsules rattle");
  ok(taps.includes("cup"), "tap the cup: he takes a sip");
  ok(taps.includes("lamp"), "tap the lamp: it flickers");
  ok(taps.includes("boss"), "tap him: onTap('boss') (a line, and a drag on the cigar or a slow nod)");
  ok(await pg.evaluate(() => document.querySelector(".dlg-text").textContent === "You owe me a laugh, kid."), "his quip shows in the dialog box");
  await sleep(2900);
  ok(await pg.evaluate(() => document.querySelector(".dlg-text").textContent.startsWith("Pick a capsule")), "…then the line it interrupted comes back");
  if (cdpV) {
    await sleep(800);
    await cdpV.send("Page.stopScreencast").catch(() => {});
    const dir = join(OUT, "orbit");
    await mkdir(dir, { recursive: true });
    let list = "ffconcat version 1.0\n";
    for (let i = 0; i < frames.length; i++) {
      const n = `f${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(dir, n), Buffer.from(frames[i].data, "base64"));
      list += `file ${n}\nduration ${Math.max(0.016, (frames[i + 1]?.t ?? frames[i].t + 0.5) - frames[i].t).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list);
    if (process.env.FFMPEG) execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-i", join(dir, "frames.ffconcat"), "-vf", "fps=30,scale=376:672,setsar=1", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "24", join(OUT, "orbit.mp4")]);
    console.log(`  ${frames.length} frames${process.env.FFMPEG ? " -> orbit.mp4" : ""}`);
  }
}
console.log(errs.length ? `✗ page errors: ${errs.join(" | ")}` : "✓ no page errors");
await browser.close(); close();
process.exit(errs.length || fails ? 1 : 0);
