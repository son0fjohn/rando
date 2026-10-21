// Screenshot test/charsprite.html: six test characters as room sprites next
// to their 3D versions, every facing and walk frame, the pixel-figure
// fallback, and all six standing and walking in the party room at night.
//   node test/charsprite_shots.mjs <dir>
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2] ?? "charsprite-shots";
const { base, close } = await serve();
await mkdir(OUT, { recursive: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
pg.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log(`  [page] ${m.text()}`); });
pg.on("pageerror", e => console.log(`  [error] ${e.message}`));
await pg.goto(`${base}/test/charsprite.html`);
await pg.waitForFunction(() => window.__done, null, { timeout: 240000 }).catch(() => console.log("  timed out"));
console.log(await pg.locator("#info").textContent());
await pg.waitForTimeout(2500);
await pg.screenshot({ path: join(OUT, "sprites.png"), fullPage: true });
await pg.locator("#pairs").screenshot({ path: join(OUT, "pairs.png") });
await pg.locator("#sheets").screenshot({ path: join(OUT, "sheets.png") });
await pg.locator("#room").screenshot({ path: join(OUT, "room-standing.png") });
// catch them mid-walk
await pg.evaluate(() => { const r = window.__room; const spots = [[260, 700], [480, 640], [220, 880], [460, 960], [300, 1080], [560, 760]]; [...r.people.keys()].forEach((id, i) => r.walk(id, spots[i % spots.length], false)); });
await pg.waitForTimeout(450);
await pg.locator("#room").screenshot({ path: join(OUT, "room-walking.png") });
// a few seconds of them wandering, as a clip (FFMPEG=... for an mp4)
await pg.locator("#room").scrollIntoViewIfNeeded();
const cdp = await pg.context().newCDPSession(pg), frames = [];
cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90 });
for (let k = 0; k < 3; k++) {
  await pg.evaluate(k => { const r = window.__room; const S = [[180, 620], [420, 560], [300, 760], [520, 840], [200, 960], [420, 1040], [600, 600], [140, 1100]]; [...r.people.keys()].forEach((id, i) => r.walk(id, S[(i + k * 3) % S.length], false)); }, k);
  await pg.waitForTimeout(2600);
}
await cdp.send("Page.stopScreencast");
const { writeFile } = await import("node:fs/promises");
const dir = join(OUT, "walk"); await mkdir(dir, { recursive: true });
let list = "ffconcat version 1.0\n";
for (let i = 0; i < frames.length; i++) {
  const n = `f${String(i).padStart(4, "0")}.jpg`;
  await writeFile(join(dir, n), Buffer.from(frames[i].data, "base64"));
  list += `file ${n}\nduration ${Math.max(0.016, (frames[i + 1]?.t ?? frames[i].t + 0.5) - frames[i].t).toFixed(3)}\n`;
}
await writeFile(join(dir, "frames.ffconcat"), list);
if (process.env.FFMPEG) {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-i", join(dir, "frames.ffconcat"), "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", `${dir}.mp4`]);
}
await browser.close(); close();
