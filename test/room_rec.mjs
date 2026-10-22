// The party room, end to end, recorded: five phones with different
// characters join (pop in at the door), walk around the furniture, the host
// taps the TV (walks over, the game picker opens), then taps a guest and
// their profile card slides up (3D, drag to spin, wave), closed by a swipe.
// Uses the REAL avatar3 models (the party test page normally stubs them),
// so sprites are the players' own characters.
//
//   node test/room_rec.mjs <dir> [--vibe=chill|chaotic|sporty]
// Writes <dir>/room.mp4 when FFMPEG=/path/to/ffmpeg is set, plus stills.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--")) ?? "room-rec";
const VIBE = args.find(a => a.startsWith("--vibe="))?.split("=")[1] ?? "chill";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".glb": "model/gltf-binary" };
const indexHtml = await readFile(join(ROOT, "web/index.html"), "utf8");
const CSS = indexHtml.slice(indexHtml.indexOf("<style>"), indexHtml.indexOf("</style>") + "</style>".length);
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    let body = await readFile(p);
    if (p.endsWith("test/hpparty.html")) body = Buffer.from(body.toString().replace("<!--INDEX_CSS-->", CSS).replace(/\s*"\/web\/avatar3\.js": "[^"]+",?/, ""));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const PEOPLE = {
  alice: { skin: "2", hair: "f1", hairColor: "brown", face: "f1", iris: "blue", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-white-stripe" },
  bob: { skin: "4", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "tee-white-graphic", bottom: "jeans-baggy-blue", shoes: "sneaker-hitop-black" },
  cy: { skin: "1", hair: "f2", hairColor: "red", face: "f2", iris: "green", top: "tee-baggy-black", bottom: "skirt-pleated-black", shoes: "clog-pink" },
  dee: { skin: "3", hair: "m3", hairColor: "white", face: "f5", iris: "navy", top: "none", bottom: "track-navy", shoes: "boot-work-tan" },
  eve: { skin: "5", hair: "f4", hairColor: "yellow", face: "f6", iris: "blue", top: "tee-white-graphic", bottom: "shorts-green", shoes: "sneaker-white-lowtop" },
};
async function phone(name, qs = "") {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(PEOPLE[name]))}${qs}`);
  await pg.waitForFunction(() => window.__ready);
  return pg;
}
// tap the room at backdrop pixel (x, y)
const tapRoom = (pg, x, y) => pg.evaluate(([x, y]) => {
  const st = document.querySelector(".lr-stage"), r = st.getBoundingClientRect(), s = r.width / window.party.current.lobby.R.w;
  const ev = (t) => new PointerEvent(t, { bubbles: true, clientX: r.left + x * s, clientY: r.top + y * s, pointerId: 1 });
  st.dispatchEvent(ev("pointerdown"));
}, [x, y]);
async function screencast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  return async dir => {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await mkdir(dir, { recursive: true });
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
    return frames.length;
  };
}

try {
  const A = await phone("alice");
  await A.click("#party-btn");
  await A.fill("#pt-name", "Saturday night");
  await A.click(`[data-vibe="${VIBE}"]`);
  await A.click("#pt-create");
  await A.waitForFunction(() => /[A-Z0-9]{4}/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
  const code = (await A.locator("#pt-code-chip").textContent()).replace(/[^A-Z0-9]/g, "");
  // let the host's own sprite render before the recording starts
  await sleep(4000);
  const cast = await screencast(A);
  await sleep(800);
  const guests = [];
  for (const n of ["bob", "cy", "dee", "eve"]) { guests.push(await phone(n, `&party=${code}`)); await A.bringToFront(); await sleep(900); }
  const [B, C, D, E] = guests;
  await A.waitForFunction(() => document.querySelectorAll(".lr-av").length === 5, null, { timeout: 30000 });
  await sleep(6000);                         // everyone's 3D sprites render (cached after)
  await A.screenshot({ path: join(OUT, "01-joined.png") });
  // everyone wanders: paths go around the tables
  // apartment spots (704x1200): on the rug, by the cushion, by the lamp, front, window
  const spots = [[360, 760], [200, 640], [560, 560], [380, 1040], [420, 470]];
  await tapRoom(B, ...spots[0]); await sleep(300);
  await tapRoom(C, ...spots[1]); await sleep(300);
  await tapRoom(D, ...spots[2]); await sleep(300);
  await tapRoom(E, ...spots[3]); await sleep(300);
  await tapRoom(A, ...spots[4]);
  await A.bringToFront();
  await sleep(3500);
  await A.screenshot({ path: join(OUT, "02-walking.png") });
  await tapRoom(B, spots[2][0] - 60, spots[2][1] + 40); await tapRoom(C, spots[0][0] + 20, spots[0][1] - 30);
  await sleep(2600);
  await A.screenshot({ path: join(OUT, "03-mingling.png") });
  // host taps the TV: walks over, the picker opens
  await A.evaluate(() => document.querySelector(".lr-tv").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await A.waitForFunction(() => !document.getElementById("pt-picker")?.hidden, null, { timeout: 15000 }).catch(() => errors.push("picker didn't open from the TV"));
  await sleep(1200);
  await A.screenshot({ path: join(OUT, "04-tv-picker.png") });
  await A.click("#pt-picker-x");
  await sleep(700);
  // tap bob: his profile card
  await A.evaluate(() => document.querySelector('.lr-av[data-id="u-bob"] .lr-spr').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await A.waitForSelector("#y-card .y-card-3d canvas", { timeout: 20000 }).catch(() => errors.push("card has no live 3D"));
  await sleep(1200);
  await A.screenshot({ path: join(OUT, "05-card.png") });
  // drag to spin
  const box = await A.locator(".y-card-3d").boundingBox();
  await A.mouse.move(box.x + 40, box.y + 90); await A.mouse.down();
  for (let i = 0; i < 12; i++) { await A.mouse.move(box.x + 40 + i * 10, box.y + 90); await sleep(40); }
  await A.mouse.up();
  await sleep(900);
  await A.screenshot({ path: join(OUT, "06-card-spun.png") });
  await A.click("#y-card-wave");
  await sleep(1300);
  await B.screenshot({ path: join(OUT, "07-bob-sees-wave.png") });
  await A.bringToFront();
  // swipe down to close
  const cb = await A.locator(".y-card").boundingBox();
  await A.mouse.move(cb.x + cb.width / 2, cb.y + 12); await A.mouse.down();
  for (let i = 0; i < 8; i++) { await A.mouse.move(cb.x + cb.width / 2, cb.y + 12 + i * 20); await sleep(30); }
  await A.mouse.up();
  await sleep(900);
  await tapRoom(A, ...spots[0]);
  await sleep(2500);
  await A.screenshot({ path: join(OUT, "08-after.png") });
  // one leaves: poof
  await E.close();
  await sleep(1500);
  console.log(`  🎬 ${await cast(join(OUT, "room"))} frames`);
  const stats = await A.evaluate(() => ({ people: document.querySelectorAll(".lr-av").length, card: !!document.getElementById("y-card") }));
  console.log("  after:", JSON.stringify(stats));
} catch (e) { console.error("room_rec failed:", e); }
finally {
  if (errors.length) console.log("errors:\n" + errors.slice(0, 12).join("\n"));
  await browser.close(); server.close();
}
