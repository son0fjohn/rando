// Screenshot test/charsprite.html: the three test characters as flat room
// sprites (every facing + walk frame) and the silhouette fallback.
//   node test/charsprite_shots.mjs <dir>
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = process.argv[2] ?? "charsprite-shots";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".glb": "model/gltf-binary" };
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
await mkdir(OUT, { recursive: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 900, height: 1000 } });
pg.on("console", m => { if (m.type() !== "debug") console.log(`  [page] ${m.text()}`); });
pg.on("pageerror", e => console.log(`  [error] ${e.message}`));
await pg.goto(`http://127.0.0.1:${server.address().port}/test/charsprite.html`);
await pg.waitForFunction(() => window.__done, null, { timeout: 120000 }).catch(() => console.log("  timed out"));
console.log(await pg.locator("#info").textContent());
await pg.screenshot({ path: join(OUT, "sprites.png"), fullPage: true });
await pg.locator("#big").screenshot({ path: join(OUT, "facings.png") });
await pg.locator("#ref").screenshot({ path: join(OUT, "reference.png") });
await browser.close(); server.close();
