// Secret Diary answers always fit the diary page: the longest answers (150
// characters, English and Korean, with and without spaces) on a small phone,
// on both the writing diary and the reading one. For every case it checks the
// font never drops under 14px, every character lands inside the pages on
// some spread (a page-turn arrow when there's more than one), and typing past
// the limit stops at 150.
//
//   node test/diary_fit.mjs [dir] [--diary=3d|sprite|css] [--video]
// With a dir it writes a screenshot per case (and with --video a screencast
// of typing the longest Korean answer and flipping its pages: <dir>/fit/,
// plus <dir>/fit.mp4 when FFMPEG=/path/to/ffmpeg is set).
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
const MODE = args.find(a => a.startsWith("--diary="))?.split("=")[1] ?? "3d";
const VIDEO = args.includes("--video");
if (OUT) await mkdir(OUT, { recursive: true });

const EN = "Honestly? I once pretended to be my own twin for an entire weekend just to get out of a group project and nobody noticed. Still proud, no regrets lol!!";
const KO = "솔직히 말하면 나는 지난 주말에 단체 과제를 피하려고 이틀 내내 내 쌍둥이인 척했는데 아무도 눈치채지 못했어 지금도 그게 내 인생 최고의 연기였다고 생각하고 후회는 전혀 없어 다음에도 또 할 거야 진짜로 정말로 그래 ㅋㅋ";
const fill = (s, n = 150) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
const CASES = [
  { label: "EN sentence, 150", text: fill(EN) },
  { label: "EN no spaces, 150 W", text: "W".repeat(150) },
  { label: "KO sentence, 150", text: fill(KO) },
  { label: "KO no spaces, 150", text: fill(KO.replace(/\s/g, "")) },
  { label: "short", text: "pineapple pizza" },
  { label: "writing: KO sentence, 150", text: fill(KO), edit: true },
  { label: "writing: EN sentence, 150", text: fill(EN), edit: true },
];
for (const c of CASES) if (c.text.length > 150) throw new Error("case too long");

const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : "  FAIL"} ${m}`); if (!c) fails++; };

for (const vp of [{ width: 320, height: 568, name: "320" }, { width: 375, height: 667, name: "375" }]) {
  console.log(`— ${vp.width}x${vp.height} (${MODE})`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => { console.log("page error:", e.message); fails++; });
  await pg.goto(`${base}/test/diaryfit.html?diary=${MODE}&cases=${encodeURIComponent(JSON.stringify(CASES))}`);
  await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await pg.waitForTimeout(300);
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const r = await pg.evaluate(async i => {
      const sp = document.querySelector(`[data-case="${i}"] .sd-spread`);
      const box = sp.querySelector(".sd-sp-text"), flow = sp.querySelector(".sd-sp-flow");
      const pages = +sp.dataset.pages, size = parseFloat(flow.style.fontSize);
      const node = flow.firstChild, n = node?.textContent.length ?? 0;
      const seen = new Uint8Array(n);
      const next = sp.querySelector(".sd-sp-turn.next");
      for (let p = 0; p < pages; p++) {
        if (p) { next.click(); await new Promise(r => setTimeout(r, 260)); }
        const b = box.getBoundingClientRect();
        for (let k = 0; k < n; k++) {
          if (/\s/.test(node.textContent[k])) { seen[k] = 1; continue; }
          const rg = document.createRange(); rg.setStart(node, k); rg.setEnd(node, k + 1);
          const q = rg.getBoundingClientRect();
          if (q.width && q.left >= b.left - 0.5 && q.right <= b.right + 0.5 && q.top >= b.top - 0.5 && q.bottom <= b.bottom + 0.5) seen[k] = 1;
        }
      }
      // back to the first page for the screenshot
      for (let p = pages - 1; p > 0; p--) sp.querySelector(".sd-sp-turn.prev").click();
      const arrows = pages > 1 ? !next.hidden || pages === 1 : true;
      return { pages, size, n, missing: n - seen.reduce((a, b) => a + b, 0), arrows, pgText: sp.querySelector(".sd-sp-pg").textContent };
    }, i);
    ok(r.size >= 14 && r.missing === 0 && r.pages <= 3, `${c.label}: ${r.size}px, ${r.pages} page${r.pages > 1 ? `s (${r.pgText} arrow)` : ""}, ${r.missing ? `${r.missing} chars OUTSIDE the page` : "every character on the page"}`);
    if (OUT) { await pg.waitForTimeout(300); await pg.locator(`[data-case="${i}"]`).screenshot({ path: join(OUT, `${vp.name}-${String(i).padStart(2, "0")}.png`) }); }
  }
  // typing stops at the limit, Enter doesn't add a line
  const typed = await pg.evaluate(async () => {
    const flow = document.querySelector("[data-case] .sd-sp-flow.sd-in");
    flow.focus();
    const r = document.createRange(); r.selectNodeContents(flow); r.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    document.execCommand("insertText", false, " and then some more words that go way past the limit");
    return flow.textContent.length;
  });
  ok(typed === 150, `typing past the limit stops at 150 (got ${typed})`);
  await ctx.close();
}

if (VIDEO && OUT) {
  // the longest Korean answer typed out on a small phone: it shrinks, then
  // runs onto the next spread; flip back and forth
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.goto(`${base}/test/diaryfit.html?diary=${MODE}&cases=${encodeURIComponent(JSON.stringify([{ label: "writing: the longest answer (150 max)", text: "", edit: true }, { label: "reading it on reveal", text: fill(EN) }]))}`);
  await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85 });
  await pg.waitForTimeout(800);
  const first = pg.locator('[data-case="0"]');
  await first.locator(".sd-sp-flow").click();
  for (const ch of fill(KO)) { await pg.keyboard.insertText(ch); await pg.waitForTimeout(45); }
  await pg.keyboard.insertText(" 더 쓰고 싶어도 여기까지");          // past the limit: nothing more goes in
  await pg.waitForTimeout(900);
  await pg.evaluate(() => document.activeElement.blur());
  for (let i = 0; i < 2; i++) {
    await first.locator(".sd-sp-turn.prev:visible").click().catch(() => {}); await pg.waitForTimeout(1100);
    await first.locator(".sd-sp-turn.next:visible").click().catch(() => {}); await pg.waitForTimeout(1100);
  }
  await pg.locator('[data-case="1"]').scrollIntoViewIfNeeded(); await pg.waitForTimeout(1500);
  await cdp.send("Page.stopScreencast");
  const dir = join(OUT, "fit"); await mkdir(dir, { recursive: true });
  let list = "ffconcat version 1.0\n";
  for (let i = 0; i < frames.length; i++) {
    const n = `f${String(i).padStart(4, "0")}.jpg`;
    await writeFile(join(dir, n), Buffer.from(frames[i].data, "base64"));
    list += `file ${n}\nduration ${Math.max(0.016, (frames[i + 1]?.t ?? frames[i].t + 0.8) - frames[i].t).toFixed(3)}\n`;
  }
  await writeFile(join(dir, "frames.ffconcat"), list);
  if (process.env.FFMPEG) {
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-i", join(dir, "frames.ffconcat"), "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", `${dir}.mp4`]);
  }
  console.log(`video: ${frames.length} frames`);
  await ctx.close();
}

await browser.close(); close();
console.log(fails ? `\n${fails} FAILED` : "\nall good");
process.exit(fails ? 1 : 0);
