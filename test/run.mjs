// Serve the repo and run test/hptest.html in headless Chromium.
//   node test/run.mjs            # pass/fail summary
//   node test/run.mjs --verbose  # include console output from the page
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const verbose = process.argv.includes("--verbose");
// this sandbox ships Chromium under a pinned build dir; prefer it over the
// version playwright would otherwise try to download
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const logs = [];
page.on("console", m => { logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", e => { logs.push(`[pageerror] ${e.message}`); });

await page.goto(`${base}/test/hptest.html`);
await page.waitForFunction(() => window.__done, { timeout: 120000 }).catch(() => {});
const text = await page.locator("#out").innerText();
const done = await page.evaluate(() => window.__done ?? null);

console.log(text);
if (verbose || !done || done.fail) {
  const noise = logs.filter(l => !/\[warning\]/.test(l));
  if (noise.length) console.log("\n--- page console ---\n" + noise.slice(0, 40).join("\n"));
}
await browser.close();
server.close();

if (!done) { console.error("\nharness did not finish"); process.exit(2); }
process.exit(done.fail ? 1 : 0);
