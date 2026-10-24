// Orbiting is never locked: both hosts' rooms on their own (test/prophet.html,
// test/boss.html), a finger dragging the camera round while a line is still
// typing, then again right through a reveal (the chosen player popping in,
// the big name, the host pointing / holding the capsule up), and letting
// go: ~4 s later it glides home. One screencast per room; with
// FFMPEG=/path/to/ffmpeg also <dir>/orbit_<room>.mp4.
//   node test/orbit_rec.mjs <dir> [prophet|boss]
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const [OUT, ONLY] = process.argv.slice(2);
if (!OUT) { console.error("usage: node test/orbit_rec.mjs <dir> [prophet|boss]"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const LOOK = { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky" };

for (const room of ["prophet", "boss"].filter(r => !ONLY || r === ONLY)) {
  console.log(room);
  const pg = await browser.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1, hasTouch: true });
  pg.on("pageerror", e => { console.log(`  ✗ page error: ${e.message}`); fails++; });
  await pg.goto(`${base}/test/${room}.html?retro=high`);
  await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 90000 });
  // the big name, as the games put it up (screen space, over the scene)
  await pg.evaluate(() => import("/web/npcscene.js").then(m => { window.__ns = m; }));
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  const yaw = () => pg.evaluate(() => __p.debug.view.yaw);
  // a slow drag across the scene, above the dialog box
  const drag = async (x0, x1, y = 260, steps = 30) => { await pg.mouse.move(x0, y); await pg.mouse.down(); for (let i = 1; i <= steps; i++) { await pg.mouse.move(x0 + (x1 - x0) * i / steps, y + Math.sin(i / 5) * 10); await sleep(40); } };
  await sleep(1200);

  // 1. while he talks: the line is still typing as the camera swings round.
  // The first swing is pointer events sent in the same tick as the line (a
  // round trip to this software-GL page is slower than the typing), then a
  // real drag on top while it's still going
  const mid = await pg.evaluate(r => {
    __dlg.say(r === "prophet"
      ? "Sit down, kid. Fate's got a job for you. Relax, it's a small one. Nobody's asking you to fly. Just do the thing, and do it like you mean it, while they film."
      : "Pick a capsule. Any capsule. Take your time, I've got all night. Nobody leaves this basement until somebody performs, and tonight that somebody might be you.");
    const c = document.querySelector(".retro-canvas"), at = (type, x) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: 260, bubbles: true, isPrimary: true }));
    at("pointerdown", 330); for (let k = 1; k <= 8; k++) at("pointermove", 330 - k * 15); at("pointerup", 210);
    return { typing: !__dlg.done, yaw: __p.debug.want.yaw };
  }, room);
  ok(mid.typing && Math.abs(mid.yaw) > 0.2, `orbits while the line is still typing (yaw ${mid.yaw.toFixed(2)}, line still typing: ${mid.typing})`);
  await drag(200, 80, 260, 15); await drag(80, 340); await pg.mouse.up(); await sleep(1500);

  // 2. through a reveal: the chosen player pops in, the name slams in, he points / holds the capsule up
  await drag(320, 120);
  await pg.evaluate(([r, look]) => {
    const roomEl = document.getElementById("w");
    roomEl.classList.add("np-room"); roomEl.style.cssText = "position:relative;width:100vw;height:100vh;overflow:hidden;left:0;transform:none";
    __p.guest.show("alice", look, { pop: true, react: "surprised" });
    if (r === "prophet") { __p.setPose("aim"); __p.orb("burst"); __dlg.say("Relax. The ball already knows who's next... alice.", { cont: false }); }
    else { __p.capsule(null, "alice"); __p.capsuleState("inhand"); __p.setPose("hold"); __p.play("drag"); __dlg.say("alice. You're up."); }
    __ns.impact(roomEl); __ns.nameSlam(roomEl, "alice");
  }, [room, LOOK]);
  await drag(120, 340, 250, 40);
  const y2 = await yaw();
  ok(Math.abs(y2) > 0.3, `orbits through the reveal, the name on screen the whole time (yaw ${y2.toFixed(2)})`);
  await drag(340, 160, 250, 30); await pg.mouse.up();
  if (room === "prophet") { await sleep(1200); await pg.evaluate(() => { __p.setPose("reveal"); __p.puff(); __p.smokeCard(0); }); await drag(300, 140, 250, 30); await pg.mouse.up(); }
  // 3. let go: it stays put a moment, then glides home
  await sleep(2500);
  const y3 = await yaw();
  ok(Math.abs(y3) > 0.1, `just after letting go it stays where you left it (yaw ${y3.toFixed(2)})`);
  await sleep(4500);
  const y4 = await yaw();
  ok(Math.abs(y4) < 0.06, `~4 s later it has glided home (yaw ${y4.toFixed(3)})`);
  await cdp.send("Page.stopScreencast");
  // the frames, and an mp4 at the real pace
  const dir = join(OUT, `orbit_${room}`); await mkdir(dir, { recursive: true });
  const list = [];
  for (const [i, f] of frames.entries()) { const name = `f${String(i).padStart(4, "0")}.jpg`; await writeFile(join(dir, name), Buffer.from(f.data, "base64")); list.push([name, (frames[i + 1]?.t ?? f.t + 0.05) - f.t]); }
  await writeFile(join(dir, "list.txt"), list.map(([n, d]) => `file '${n}'\nduration ${Math.max(0.01, d).toFixed(3)}`).join("\n") + `\nfile '${list.at(-1)[0]}'\n`);
  if (process.env.FFMPEG) {
    execFileSync(process.env.FFMPEG, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30", "-pix_fmt", "yuv420p", join(OUT, `orbit_${room}.mp4`)]);
    console.log(`  wrote orbit_${room}.mp4 (${frames.length} frames)`);
  }
  await pg.close();
}
await browser.close(); close();
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
