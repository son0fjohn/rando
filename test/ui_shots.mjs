// Screenshots of every house-party screen, for before/after design reviews:
// party creation, the lobby (host + guest), the game picker, party settings,
// app settings, and every Secret Diary screen through the points screen and
// the results. Same stack as party_e2e.mjs (real party.js + game modules +
// CSS, network/3D/audio stubbed). Phone-sized (390x844 @2x).
//
//   node test/ui_shots.mjs <dir> [--video] [--diary=3d|sprite|css] [--browser=webkit]
//
// --video (Chromium) screencasts the host's phone from creating the party,
// through the lobby and the game picker, to the end of the first Secret Diary
// question (its points screen) into <dir>/flow/ — with FFMPEG=/path/to/ffmpeg
// set it also writes <dir>/flow.mp4.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium, webkit, devices } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const SHOTS = args.find(a => !a.startsWith("--"));
if (!SHOTS) { console.error("usage: node test/ui_shots.mjs <dir> [--video] [--diary=…]"); process.exit(2); }
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1];
// --long: everyone writes the longest answers (Korean and English) to show
// how they fit the diary page, and the reveal zooms into one
const LONG = args.includes("--long");
const LONG_ANSWERS = [
  "Honestly? I once pretended to be my own twin for an entire weekend just to get out of a group project and nobody noticed. Still proud, no regrets lol!!",
  "솔직히 말하면 나는 지난 주말에 단체 과제를 피하려고 이틀 내내 내 쌍둥이인 척했는데 아무도 눈치채지 못했어 지금도 그게 내 인생 최고의 연기였다고 생각하고 후회는 전혀 없어 다음에도 또 할 거야 진짜로",
  "probably the time I sang the whole karaoke song with the wrong lyrics on purpose and the entire bar joined in, then the manager gave us free fries for it",
  "나는 아직도 공룡이 어딘가 살아있다고 믿어 진지하게 그리고 그걸 증명하려고 주말마다 산에 가서 발자국을 찾아다니는데 친구들은 다 나를 놀려 근데 언젠가 꼭 찾을 거야",
].map(t => t.slice(0, 150));
const VIDEO = args.includes("--video"), DIARY_MODE = opt("diary") ?? null, ENGINE = opt("browser") ?? "chromium";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".svg": "image/svg+xml" };

const indexHtml = await readFile(join(ROOT, "web/index.html"), "utf8");
const CSS = indexHtml.slice(indexHtml.indexOf("<style>"), indexHtml.indexOf("</style>") + "</style>".length);
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    let body = await readFile(p);
    if (p.endsWith("test/hpparty.html")) body = Buffer.from(body.toString().replace("<!--INDEX_CSS-->", CSS));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(SHOTS, { recursive: true });

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = ENGINE === "webkit" ? await webkit.launch()
  : await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] });
const ctx = ENGINE === "webkit" ? await browser.newContext({ ...devices["iPhone 15"] })
  : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (pg, fn, arg, ms = 20000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const errors = [];
async function phone(name, qs = "") {
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await pg.goto(`${base}/test/hpparty.html?me=${name}${qs}${DIARY_MODE ? `&diary=${DIARY_MODE}` : ""}`);
  await pg.waitForFunction(() => window.__ready);
  return pg;
}
let A = null;
const taken = [];
const shot = async (pg, name, note) => {
  await pg.bringToFront(); await sleep(250);
  await pg.screenshot({ path: join(SHOTS, `${name}.png`) });
  taken.push(`${name} — ${note}`);
  console.log(`  📸 ${name}`);
  if (A && pg !== A) await A.bringToFront();
};
const step = async (label, fn) => { try { await fn(); } catch (e) { console.log(`  ✗ ${label}: ${e.message.split("\n")[0]}`); } };

// CDP screencast of one phone; stop() writes frames + an ffconcat list
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
  A = await phone("alice");
  const cast = VIDEO && ENGINE === "chromium" ? await screencast(A) : null;
  await sleep(600);
  await A.click("#party-btn");
  await sleep(400);
  await shot(A, "01-party-create", "throw a house party / join by code");
  await A.fill("#pt-name", "Saturday night");
  await A.click("#pt-create");
  await until(A, () => /[A-Z0-9]{4}/.test(document.getElementById("pt-code-chip")?.textContent ?? ""));
  const code = (await A.locator("#pt-code-chip").textContent()).replace(/[^A-Z0-9]/g, "");
  await sleep(900);
  await shot(A, "02-lobby-alone", "host alone in the lobby");
  const B = await phone("bob", `&party=${code}`);
  const C = await phone("cy", `&party=${code}`);
  const D = await phone("dee", `&party=${code}`);
  await until(A, () => document.querySelectorAll(".lr-av").length === 4, null, 30000);
  await sleep(1200);
  await step("ready-up", async () => { const r = B.locator("#pt-ready"); if (await r.count()) { await r.click(); await sleep(500); } });
  await shot(A, "03-lobby-host", "host's lobby, 4 in the room");
  await shot(B, "04-lobby-guest", "guest's lobby");
  await step("settings", async () => {
    const g = A.locator("#pt-settings-btn");
    if (await g.count()) { await g.click(); await sleep(500); await shot(A, "05-settings", "settings (sound, party settings)"); await A.click("#ui-settings-x").catch(() => {}); await sleep(300); }
  });
  await B.click("#pt-vote");
  await sleep(500);
  await B.click('[data-vote="secretdiary"]');
  await sleep(600);
  await shot(B, "06-vote", "a player votes for the next game");
  await B.click("#pt-picker-x");
  await A.click("#pt-vote");
  await sleep(700);
  await shot(A, "07-game-votes", "the host's game votes, most votes first");
  await step("party settings", async () => {
    await A.click("#pv-settings-h");
    const s = A.locator(".pt-settings");
    if (await s.count()) { await s.scrollIntoViewIfNeeded(); await sleep(300); await shot(A, "08-party-settings", "party settings (18+, diary max level)"); }
  });
  await A.click('[data-game="secretdiary"]');
  await until(A, () => document.querySelectorAll(".sd-card").length >= 3);
  await sleep(700);
  await shot(A, "10-sd-deal-host", "Secret Diary: the host's deal");
  await shot(B, "11-sd-deal-guest", "Secret Diary: a guest waiting for the deal");
  await A.click("#sd-send");
  const players = [A, B, C, D];
  for (const pg of players) await until(pg, () => document.querySelectorAll(".sd-q").length >= 3);
  await sleep(600);
  await shot(B, "12-sd-answer", "Secret Diary: answering (written + yes/no on your diary)");
  for (const [j, pg] of players.entries()) {
    const n = await pg.locator(".sd-q").count();
    for (let k = 0; k < n; k++) {
      const q = pg.locator(".sd-q").nth(k);
      if (await q.locator(".sd-in").count()) await q.locator(".sd-in").fill((LONG ? LONG_ANSWERS : ["sneaking a nap at work", "pineapple on pizza is elite", "나는 아직도 공룡을 믿어", "honestly? karaoke"])[j]);
      else await q.locator(`[data-yn="${j % 2 ? "no" : "yes"}"]`).click();
    }
    if (pg === B) { await sleep(400); await shot(B, "13-sd-answer-filled", "Secret Diary: answers filled in, YES/NO stamped"); }
    await pg.click("#sd-submit");
  }
  await until(B, () => /question 1 of/.test(document.querySelector(".sd-qcount")?.textContent ?? ""), null, 20000);
  const type = await A.evaluate(() => window.__game?.s?.batch?.[window.__game.s.qi]?.type);
  await sleep(1200);
  await shot(B, `14-sd-reveal-${type}-unlocking`, `Secret Diary: ${type} reveal mid-unlock`);
  await until(B, () => !document.querySelector(".sealed"), null, 15000);
  await sleep(500);
  await shot(B, `15-sd-reveal-${type}`, `Secret Diary: ${type} reveal, opened`);
  const zoomShot = async () => {
    const cell = B.locator(".sd-dcell.open").filter({ hasNot: B.locator(".sd-dyours") }).first();
    if (!(await cell.count())) return;
    await cell.click(); await sleep(1200);
    await shot(B, "15b-sd-zoom", "Secret Diary: a diary read big (zoomed in)");
    const nx = B.locator(".sd-zoom .sd-sp-turn.next:visible");
    if (await nx.count()) { await nx.click(); await sleep(600); await shot(B, "15c-sd-zoom-page2", "Secret Diary: the same diary, page 2"); }
    await B.locator(".sd-zclose").click().catch(() => {}); await sleep(300);
  };
  if (type === "written") await zoomShot();
  for (const pg of players) await pg.click("#sd-lock").catch(() => {});
  await until(B, () => !!document.querySelector(".sd-pts"), null, 20000);
  await sleep(1800);
  await shot(B, "16-sd-points", "Secret Diary: points after a question");
  if (cast) { await sleep(1500); console.log(`  🎬 flow: ${await cast(join(SHOTS, "flow"))} frames`); }
  // the other question type, then the results
  let other = false;
  for (let g = 0; g < 12; g++) {
    await A.click("#sd-next").catch(() => {});
    const ok = await until(B, () => /question \d+ of/.test(document.querySelector(".sd-qcount")?.textContent ?? "") || !!document.querySelector(".hp-res-title"), null, 20000);
    if (!ok || await B.locator(".hp-res-title").count()) break;
    const t = await A.evaluate(() => window.__game?.s?.batch?.[window.__game.s.qi]?.type);
    if (t !== type && !other) {
      other = true;
      await until(B, () => !document.querySelector(".sealed"), null, 15000);
      await sleep(500);
      await shot(B, `17-sd-reveal-${t}`, `Secret Diary: ${t} reveal, opened`);
      if (t === "written") await zoomShot();
    }
    for (const pg of players) await pg.click("#sd-lock").catch(() => {});
    await until(B, () => !!document.querySelector(".sd-pts") || !!document.querySelector(".hp-res-title"), null, 20000);
  }
  await until(B, () => !!document.querySelector(".hp-res-title"), null, 30000);
  await sleep(1200);
  await shot(B, "18-results", "results screen");
} catch (e) {
  console.error("ui_shots failed:", e);
} finally {
  await writeFile(join(SHOTS, "index.txt"), taken.join("\n") + "\n");
  if (errors.length) console.log("page errors:\n" + errors.slice(0, 10).join("\n"));
  await browser.close();
  server.close();
}
