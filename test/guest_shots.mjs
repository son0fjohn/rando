// The chosen player in the game hosts' rooms (npcstage.js guestSpot):
// Side Quest's rooftop (test/prophet.html), sitting on a cushion at the
// table's right end, and the Ritual's basement (test/boss.html), standing at
// the table's right end by the door. Each outfit at the default view and
// both ends of the orbit (plus low and high), with the dialog box up; and a
// screen-space check that they stay clear of the host, the ball / the box
// and the dialog box in the default view. One contact sheet per room.
//   node test/guest_shots.mjs <dir> [prophet|boss] [--outfits=puffer,long]
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--") && !["prophet", "boss"].includes(a));
const ONLY = args.find(a => ["prophet", "boss"].includes(a));
const PICK = (args.find(a => a.startsWith("--outfits="))?.slice(10) ?? "").split(",").filter(Boolean);
if (!OUT) { console.error("usage: node test/guest_shots.mjs <dir> [prophet|boss] [--outfits=puffer,long]"); process.exit(2); }
await mkdir(OUT, { recursive: true });

// the outfits most likely to clip in a sitting or standing pose
export const OUTFITS = {
  puffer: { skin: "5", hair: "middle-part", hairColor: "black", top: "puffer-black", bottom: "cargo-chain", shoes: "skate-blue" },
  long: { skin: "2", hair: "long-bangs", hairColor: "brown", top: "sweat-babyblue", bottom: "skirt-long", shoes: "skate-blue", eyes: "doe" },
  beanie: { skin: "3", hair: "wolf", hairColor: "pink", head: "beanie-phones", top: "sweat-babyblue", bottom: "skirt-pleated", shoes: "skate-blue" },
  plain: {},
};
const outfits = Object.entries(OUTFITS).filter(([k]) => !PICK.length || PICK.includes(k));

const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errs = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };

for (const room of ["prophet", "boss"].filter(r => !ONLY || r === ONLY)) {
  const pg = await browser.newPage({ viewport: { width: 376, height: 672 }, deviceScaleFactor: 1, hasTouch: true });
  pg.on("pageerror", e => errs.push(`${room}: ${e.message}`));
  pg.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) console.log("  [page]", m.text()); });
  await pg.goto(`${base}/test/${room}.html?retro=high`);
  await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 90000 });
  const failed = await pg.evaluate(() => window.__failed);
  if (failed) { console.log(`✗ ${room} failed:`, failed); process.exit(1); }
  await pg.evaluate(() => { __dlg.say(location.pathname.includes("boss") ? "You're up." : "Relax. The ball already knows who's next.", { instant: true }); });
  const [lo, hi] = await pg.evaluate(() => __p.debug.VIEW.yawRange);
  const P = await pg.evaluate(() => __p.debug.VIEW.pitchRange);
  const views = [["default", 0, 0], ["far-left", lo, 0], ["far-right", hi, 0], ["far-left-high", lo, P[1]], ["far-right-low", hi, P[0]]];
  const files = [];
  for (const [name, look] of outfits) {
    await pg.evaluate(async ([id, look]) => { await __p.guest.show(id, look, { pop: true }); }, [`u-${name}`, look]);
    await sleep(1500);
    for (const [label, yaw, pitch] of views) {
      // hold a pointer down (so it doesn't glide home), put the view there
      await pg.mouse.move(370, 8); await pg.mouse.down();
      await pg.evaluate(([y, p]) => { Object.assign(__p.debug.want, { yaw: y, pitch: p, zoom: 1 }); }, [yaw, pitch]);
      await sleep(1500);
      const file = `${room}_${name}_${label}.png`;
      await pg.screenshot({ path: join(OUT, file) });
      if (label === "default") {
        // where they are on screen against what must stay clear
        const r = await pg.evaluate(() => {
          const g = __p.guest.rect(), h = __p.debug.hostRect();
          const prop = __p.debug.propRect();
          const d = document.querySelector("#d .dlg-box").getBoundingClientRect();
          const R = o => ({ l: o.left, t: o.top, r: o.right ?? o.left + o.width, b: o.bottom ?? o.top + o.height });
          const area = o => Math.max(0, o.r - o.l) * Math.max(0, o.b - o.t);
          const inter = (a, b) => area({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
          if (!g) return null;
          const G = R(g), H = R(h), P = R(prop), D = R(d);
          const front = h ? g.depth < h.depth : true;
          return {
            guest: { l: Math.round(G.l), t: Math.round(G.t), r: Math.round(G.r), b: Math.round(G.b) },
            inView: G.l >= 0 && G.r <= innerWidth && G.t >= 0 && G.b <= innerHeight,
            overlaps: {
              [location.pathname.includes("boss") ? "the Boss (in front of him)" : "the Prophet (in front of him)"]: front && inter(G, H) / area(H) > 0.04,
              [location.pathname.includes("boss") ? "the capsule box (in front of it)" : "the crystal ball (in front of it)"]: inter(G, P) > 0 && g.depth < prop.depth,
              "the dialog box": inter(G, D) > 0,
            },
          };
        });
        if (r) {
          ok(r.inView, `${room} · ${name}: fully in the default view (${JSON.stringify(r.guest)})`);
          for (const [what, hit] of Object.entries(r.overlaps)) ok(!hit, `${room} · ${name}: clear of ${what}`);
        } else ok(false, `${room} · ${name}: on screen`);
      }
      await pg.mouse.up();
      files.push([`${name} · ${label}`, file]);
    }
    console.log(`  ${room}: ${name}`);
  }
  // one at a time: showing someone new replaces the last one
  const n = await pg.evaluate(async () => { await __p.guest.show("u-a", {}, { pop: true }); await __p.guest.show("u-b", { top: "puffer-black" }, { pop: true }); return __p.guest.count?.() ?? -1; });
  if (n >= 0) ok(n === 1, `${room}: exactly one chosen player in the scene after a new pick (${n})`);
  await pg.evaluate(() => __p.guest.hide());
  await sleep(1200);
  const gone = await pg.evaluate(() => !__p.guest.root.visible);
  ok(gone, `${room}: hidden, they're gone from the scene`);
  const html = `<body style="margin:0;background:#111;color:#ddd;font:13px system-ui;display:flex;flex-wrap:wrap;gap:6px;padding:6px;width:${views.length * 382}px">` +
    files.map(([l, f]) => `<figure style="margin:0"><img src="${f}" width="376"><figcaption>${l}</figcaption></figure>`).join("") + "</body>";
  await writeFile(join(OUT, `guest_${room}.html`), html);
  const sh = await browser.newPage({ viewport: { width: views.length * 382 + 12, height: 800 } });
  await sh.goto(pathToFileURL(resolve(OUT, `guest_${room}.html`)).href);
  await sh.waitForLoadState("load");
  await sh.screenshot({ path: join(OUT, `guest_${room}.png`), fullPage: true });
  await sh.close(); await pg.close();
}
await browser.close(); close();
if (errs.length) { console.log(errs.join("\n")); process.exit(1); }
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
