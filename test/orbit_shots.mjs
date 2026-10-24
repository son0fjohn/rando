// The game hosts' rooms at every angle the look-around can reach: Side
// Quest's rooftop (test/prophet.html) and the Ritual's basement
// (test/boss.html), at the far left, mid left, the default view, mid right
// and the far right of the orbit, then zoomed in at the far ends and the
// middle, plus a low and a high pitch at the far ends. One contact sheet
// per room (orbit_<room>.png) and every shot on its own.
//   node test/orbit_shots.mjs <dir> [prophet|boss]
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const [OUT, ONLY] = process.argv.slice(2);
if (!OUT) { console.error("usage: node test/orbit_shots.mjs <dir> [prophet|boss]"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errs = [];
for (const room of ["prophet", "boss"].filter(r => !ONLY || r === ONLY)) {
  const pg = await browser.newPage({ viewport: { width: 376, height: 672 }, deviceScaleFactor: 1, hasTouch: true });
  pg.on("pageerror", e => errs.push(`${room}: ${e.message}`));
  await pg.goto(`${base}/test/${room}.html?retro=high`);
  await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 90000 });
  await pg.evaluate(() => { __dlg.say("…", { instant: true }); });
  const range = await pg.evaluate(() => __p.debug.VIEW.yawRange);
  const [lo, hi] = range, P = await pg.evaluate(() => __p.debug.VIEW.pitchRange);
  const shots = [
    ["far left", lo, 0, 1], ["mid left", lo / 2, 0, 1], ["center", 0, 0, 1], ["mid right", hi / 2, 0, 1], ["far right", hi, 0, 1],
    ["far left, zoomed", lo, 0, 0.72], ["center, zoomed", 0, 0, 0.72], ["far right, zoomed", hi, 0, 0.72],
    ["far left, high", lo, P[1], 1], ["far right, low", hi, P[0], 1],
  ];
  const files = [];
  for (const [label, yaw, pitch, zoom] of shots) {
    // hold a pointer down (so it doesn't glide home), put the view there
    await pg.mouse.move(370, 660); await pg.mouse.down();
    await pg.evaluate(([y, p, z]) => { Object.assign(__p.debug.want, { yaw: y, pitch: p, zoom: z }); }, [yaw, pitch, zoom]);
    await sleep(1600);
    const file = `${room}_${label.replace(/[, ]+/g, "-")}.png`;
    await pg.screenshot({ path: join(OUT, file) });
    await pg.mouse.up();
    files.push([label, file, yaw]);
    console.log(`  ${room}: ${label} (yaw ${(yaw * 180 / Math.PI).toFixed(0)}°)`);
  }
  // contact sheet
  const html = `<body style="margin:0;background:#111;color:#ddd;font:13px system-ui;display:flex;flex-wrap:wrap;gap:6px;padding:6px;width:${5 * 382}px">` +
    files.map(([l, f, y]) => `<figure style="margin:0"><img src="${f}" width="376"><figcaption>${l} · yaw ${(y * 180 / Math.PI).toFixed(0)}°</figcaption></figure>`).join("") + "</body>";
  await writeFile(join(OUT, `orbit_${room}.html`), html);
  const sh = await browser.newPage({ viewport: { width: 5 * 382 + 12, height: 800 } });
  await sh.goto(pathToFileURL(resolve(OUT, `orbit_${room}.html`)).href);
  await sh.waitForLoadState("load");
  await sh.screenshot({ path: join(OUT, `orbit_${room}.png`), fullPage: true });
  await sh.close(); await pg.close();
}
await browser.close(); close();
if (errs.length) { console.log(errs.join("\n")); process.exit(1); }
