// The multiplayer suite: several real guests playing together, each its own
// browser context (own session, storage, GPS), on the real app page.
//
//   npm run test:multiplayer -- [--players=2,4,8] [--runs=5] [--only=presence,chat,…]
//                               [--base=<url>] [--out=<dir>] [--games=sidequest,…]
//                               [--video] [--fps=8] [--slow=1.5] [--draw-all] [--real-gps] [--allow-production]
//
//   tests      presence chat hosting games hostcontrols leaving notes disconnect
//   --base     a Vercel PREVIEW deployment (or BASE_URL=…). Without it the
//              suite runs offline: test/appserve.mjs, Supabase faked in memory,
//              one fake server for every phone (test/stubs/mpshared.js).
//              Production (randoirl.vercel.app) is refused unless
//              --allow-production (or ALLOW_PRODUCTION=1) is given.
//   --out      results.md, results.json, and for each failure a folder with
//              every phone's screen, state and console, the test's trace (and
//              each phone's video with --video)
//   --fps      how often each phone draws (software GL: many live 3D maps
//              starve a small machine; 0 = as fast as it can)
//   --slow     multiplies every test's time limit (a loaded machine)
//   --draw-all offline, a phone's map stops drawing once it's there and a test
//              isn't looking at it (its state runs on); this keeps them all drawing
//   --real-gps each phone's location comes from the browser context's geolocation only
//              (by default the app's ?devlat=&devlng= override is set too: a starved
//              machine can miss the app's 10 s geolocation timeout)
//   --presence-timeout  offline: how long the fake Realtime takes to notice a
//              dropped phone's dead socket (default 60 s; it never says goodbye)
// Not part of `npm test` or CI: a tool to run on demand.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "../appserve.mjs";
import { World, saveArtifacts, keepVideos, sleep } from "./lib.mjs";
import { TESTS } from "./tests.mjs";
import { GAMES } from "./games.mjs";

const arg = (k, d = null) => { const a = process.argv.slice(2).find(x => x === `--${k}` || x.startsWith(`--${k}=`)); return a === undefined ? d : a.includes("=") ? a.slice(a.indexOf("=") + 1) : true; };
const PLAYERS = String(arg("players", "2,4,8")).split(",").map(Number).filter(n => n >= 2 && n <= 8);
const RUNS = Math.max(1, +arg("runs", 1));
const ONLY = String(arg("only", Object.keys(TESTS).join(","))).split(",").filter(t => TESTS[t]);
const BASE = arg("base", process.env.BASE_URL ?? null);
const OUT = arg("out", process.env.MP_OUT ?? "test-results/multiplayer");
const FPS = +arg("fps", 8);
const DRAW_ALL = !!arg("draw-all", false);
const REAL_GPS = !!arg("real-gps", false);
const PRESENCE_S = +arg("presence-timeout", 60);
const SLOW = +arg("slow", 1);
const VIDEO = !!arg("video", false);
const GAMES_ONLY = arg("games", null)?.split(",") ?? null;
const PROD = ["randoirl.vercel.app"];
// the limits, per test (minutes, before --slow)
const LIMIT = { presence: 12, chat: 10, hosting: 12, games: 100, hostcontrols: 15, leaving: 14, notes: 14, disconnect: 25 };

if (BASE) {
  const host = new URL(BASE).hostname;
  if (PROD.includes(host) && !(arg("allow-production") || process.env.ALLOW_PRODUCTION === "1")) {
    console.error(`refusing to run against production (${host}): use a Vercel preview URL, or --allow-production if you really mean it`);
    process.exit(2);
  }
}
await mkdir(OUT, { recursive: true });
const server = BASE ? null : await serve({ realAvatars: true });
const base = BASE ? BASE.replace(/\/$/, "") : server.base;
const offline = !BASE;
console.log(`multiplayer suite: ${ONLY.join(", ")} · players ${PLAYERS.join("/")} · ${RUNS} run(s) · ${offline ? `offline (${base})` : `against ${base}`} · out ${OUT}`);

const results = [];
const started = new Date().toISOString();
const tagOf = () => Math.random().toString(36).slice(2, 6);

async function runOne(test, n, run) {
  const tag = tagOf();
  const dir = join(OUT, "failures", `run${run}-${test}-${n}p-${tag}`);
  const log = [];
  const t0 = Date.now();
  const say = m => { const l = `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${m}`; log.push(l); if (process.env.MP_VERBOSE) console.log("   ", l); };
  const w = await World.create({ base, offline, out: OUT, fps: FPS, video: VIDEO, log: say, slow: SLOW, pauseIdle: offline && !DRAW_ALL, realGps: REAL_GPS, presenceTimeoutMs: PRESENCE_S * 1000, query: offline ? { strictrt: 1 } : {} });
  const checks = [], notes = [], rows = [];
  const T = {
    w, n, tag, run, dir, log: say, opts: { games: GAMES_ONLY },
    check(c, m) { checks.push({ ok: !!c, m }); say(`${c ? "✓" : "✗"} ${m}`); return !!c; },
    need(c, m) { if (!this.check(c, m)) throw Object.assign(new Error(m), { need: true }); },
    note(m) { notes.push(m); say(`· ${m}`); },
    row(id, pass, m) { rows.push({ id, pass, m }); say(`${pass === null ? "–" : pass ? "✓" : "✗"} [${id}] ${m}`); },
  };
  let error = null, timedOut = false;
  const limit = (LIMIT[test] ?? 15) * 60000 * SLOW;
  try {
    await Promise.race([
      TESTS[test](T),
      sleep(limit).then(() => { timedOut = true; throw new Error(`timed out after ${Math.round(limit / 60000)} min`); }),
    ]);
  } catch (e) { error = e; say(`!! ${e.notImplemented ? "" : "error: "}${e.message}`); }
  const failed = checks.filter(c => !c.ok);
  const rowFails = rows.filter(r => r.pass === false);
  const pass = !error && !failed.length && !rowFails.length;
  const cause = error?.notImplemented ? error.message : error ? (error.need ? `stopped: ${error.message}` : error.message) : failed.length ? failed.map(c => c.m).join(" · ") : rowFails.length ? rowFails.map(r => `${r.id}: ${r.m}`).join(" · ") : "";
  if (!pass) await saveArtifacts(w, dir, { log, why: cause }).catch(e => console.log("   (artifacts:", e.message, ")"));
  await w.close();
  await keepVideos(w, join(dir, "video"), !pass).catch(() => {});
  const r = { test, players: n, run, tag, pass, notImplemented: !!error?.notImplemented, timedOut, ms: Date.now() - t0, cause, checks: checks.length, failedChecks: failed.map(c => c.m), notes, rows, artifacts: pass ? null : dir };
  results.push(r);
  console.log(`${pass ? "PASS" : "FAIL"}  ${test.padEnd(12)} ${n}p  run ${run}  ${(r.ms / 1000).toFixed(0)}s${pass ? "" : `  ${cause.slice(0, 300)}`}${rows.length ? `  [${rows.map(x => `${x.id.replace("game:", "")}:${x.pass === null ? "–" : x.pass ? "ok" : "FAIL"}`).join(" ")}]` : ""}`);
  await writeResults();
  return r;
}

// test × players × run -> ✓ / ✗ / NI (not implemented) / – (not run)
async function writeResults() {
  const mark = r => (!r ? "·" : r.notImplemented ? "NI" : r.pass ? "✓" : "✗");
  const rowMark = (r, id) => { const x = r?.rows.find(y => y.id === id); return !r ? "·" : !x ? (r.pass ? "✓" : "✗") : x.pass === null ? "–" : x.pass ? "✓" : "✗"; };
  const lines = [`# Multiplayer suite results`, "", `${offline ? "offline (test/appserve.mjs, Supabase faked; one fake server for all phones)" : `against ${base}`} · started ${started} · ${RUNS} run(s) · players ${PLAYERS.join(", ")} · fps ${FPS}`, "",
    "✓ pass · ✗ fail · NI not implemented (a failure) · – not driven · one mark per run, in order", "",
    `| test | ${PLAYERS.map(n => `${n} players`).join(" | ")} |`, `|---|${PLAYERS.map(() => "---").join("|")}|`];
  for (const t of ONLY) {
    const cells = PLAYERS.map(n => Array.from({ length: RUNS }, (_, i) => mark(results.find(r => r.test === t && r.players === n && r.run === i + 1))).join(" "));
    if (t === "games") {
      lines.push(`| games (all) | ${cells.join(" | ")} |`);
      for (const g of GAMES_ONLY ?? GAMES) lines.push(`| ↳ ${g} | ${PLAYERS.map(n => Array.from({ length: RUNS }, (_, i) => rowMark(results.find(r => r.test === t && r.players === n && r.run === i + 1), `game:${g}`)).join(" ")).join(" | ")} |`);
    } else lines.push(`| ${t} | ${cells.join(" | ")} |`);
  }
  const fails = results.filter(r => !r.pass);
  lines.push("", `## Failures (${fails.length} of ${results.length})`, "");
  for (const r of fails) {
    lines.push(`- **${r.test}** ${r.players}p run ${r.run} (${Math.round(r.ms / 1000)} s): ${r.cause.replace(/\|/g, "/")}`);
    for (const x of r.rows.filter(x => x.pass === false)) lines.push(`  - ${x.id}: ${x.m}`);
    lines.push(`  - artifacts: \`${r.artifacts}\``);
  }
  const notes = [...new Set(results.flatMap(r => r.notes.map(n => `${r.test}: ${n}`)))];
  if (notes.length) lines.push("", "## Notes", "", ...notes.map(n => `- ${n}`));
  await writeFile(join(OUT, "results.md"), lines.join("\n") + "\n");
  await writeFile(join(OUT, "results.json"), JSON.stringify({ base: offline ? "offline" : base, started, players: PLAYERS, runs: RUNS, tests: ONLY, results }, null, 1));
}

// --merge=<dir>,<dir>: one table from several runs' results.json (shards run side by side)
const MERGE = arg("merge", null);
if (MERGE) {
  const { readFile } = await import("node:fs/promises");
  for (const d of String(MERGE).split(",")) results.push(...JSON.parse(await readFile(join(d, "results.json"), "utf8")).results);
  await writeResults();
  server?.close();
  console.log(`merged ${results.length} results · ${join(OUT, "results.md")}`);
  process.exit(0);
}
// --resume=<results.json>: the cells already in it are kept, not run again (a matrix picked up after a stop)
const RESUME = arg("resume", null);
const prior = RESUME ? JSON.parse(await (await import("node:fs/promises")).readFile(RESUME, "utf8")).results : [];
for (let run = 1; run <= RUNS; run++)
  for (const test of ONLY)
    for (const n of PLAYERS) {
      const done = prior.find(r => r.test === test && r.players === n && r.run === run);
      if (done) { results.push(done); continue; }
      try { await runOne(test, n, run); }
      catch (e) { console.log(`FAIL  ${test} ${n}p run ${run}: harness error ${e.message}`); results.push({ test, players: n, run, pass: false, cause: `harness: ${e.message}`, rows: [], notes: [], checks: 0, failedChecks: [], ms: 0, artifacts: null }); await writeResults(); }
    }

server?.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed · ${join(OUT, "results.md")}`);
process.exit(failed ? 1 : 0);
