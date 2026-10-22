// Screenshot the Secret Diary models (test/diary3d.html): stills of each kind
// and a live 6-diary shelf mid-unlock and after. Prints triangle counts, the
// frame-time benchmark and the unlock fps, optionally under CPU throttling.
//
//   node test/diary3d_shots.mjs [screenshot-dir] [--throttle=4] [--n=6] [--video]
//
// Exits non-zero if the models don't load or one is over 5k triangles.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const SHOTS = args.find(a => !a.startsWith("--")) ?? null;
const opt = k => args.find(a => a.startsWith(`--${k}`))?.split("=")[1];
const THROTTLE = +(opt("throttle") ?? 1), N = +(opt("n") ?? 6), VIDEO = args.includes("--video");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".glb": "model/gltf-binary" };

const indexHtml = await readFile(join(ROOT, "web/index.html"), "utf8");
const CSS = indexHtml.slice(indexHtml.indexOf("<style>"), indexHtml.indexOf("</style>") + "</style>".length);
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    let body = await readFile(p);
    if (p.endsWith("test/diary3d.html")) body = Buffer.from(body.toString().replace("<!--INDEX_CSS-->", CSS));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(VIDEO && SHOTS ? { recordVideo: { dir: SHOTS, size: { width: 390, height: 844 } } } : {}) });
const pg = await ctx.newPage();
pg.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}] ${m.text()}`); });
pg.on("pageerror", e => console.log(`[pageerror] ${e.message}`));
if (THROTTLE > 1) { const cdp = await ctx.newCDPSession(pg); await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE }); }
await pg.goto(`${base}/test/diary3d.html?n=${N}`);
await pg.waitForFunction(() => window.__ready, null, { timeout: 120000 });
const r = await pg.evaluate(() => window.__ready);
console.log(JSON.stringify({ throttle: THROTTLE, n: N, ...r }));
if (SHOTS) {
  await pg.screenshot({ path: `${SHOTS}/diary3d_done.png` });
  await pg.locator(".stage").screenshot({ path: `${SHOTS}/diary3d_shelf_open.png` });
  await pg.click("#go");
  await pg.waitForTimeout(500);
  await pg.locator(".stage").screenshot({ path: `${SHOTS}/diary3d_shelf_locked.png` });
  await pg.waitForTimeout(800);
  await pg.locator(".stage").screenshot({ path: `${SHOTS}/diary3d_shelf_mid.png` });
  await pg.waitForTimeout(2500);
}
await ctx.close();
await browser.close();
server.close();
// the brief's budget: under ~5k triangles a model, and the shelf has to come up
const bad = !r.ok ? "the models didn't load" : Object.entries(r.tris).filter(([, n]) => n > 5000).map(([k, n]) => `${k} has ${n} triangles`).join(", ");
if (bad) { console.error("✗ " + bad); process.exit(1); }
console.log("✓ three models load, each under 5k triangles; the shelf unlocks");
