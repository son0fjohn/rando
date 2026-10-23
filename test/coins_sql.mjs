// The coin and shop rules, run for real: supabase/migrations/013_coins_shop.sql
// (+ 014_mask_off.sql), and Humiliation Ritual's server-side prompt draw
// (015_ritual_prompts.sql)
// in an embedded Postgres (PGlite, WASM — no server), with a tiny stand-in
// for Supabase's auth schema (auth.users, auth.uid() from a setting).
//   node test/coins_sql.mjs
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ROOT = new URL("..", import.meta.url).pathname;
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else fails++; console.log(`${c ? "  ✓" : "  ✗"} ${m}`); };
const head = t => console.log(`\n${t}`);

await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.profiles (id uuid primary key references auth.users (id), handle text, avatar jsonb not null default '{}'::jsonb);
`);
await db.exec(await readFile(`${ROOT}supabase/migrations/013_coins_shop.sql`, "utf8"));
await db.exec(await readFile(`${ROOT}supabase/migrations/014_mask_off.sql`, "utf8"));
await db.exec(await readFile(`${ROOT}supabase/migrations/015_ritual_prompts.sql`, "utf8"));

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
for (let i = 1; i <= 9; i++) { await db.query("insert into auth.users values ($1)", [U(i)]); await db.query("insert into profiles (id, handle) values ($1, $2)", [U(i), `p${i}`]); }
const as = async (n, sql, args = []) => { await db.exec(`set test.uid = '${n ? U(n) : ""}'`); return (await db.query(sql, args)).rows; };
const one = async (n, sql, args) => Object.values((await as(n, sql, args))[0])[0];
const coins = async n => (await one(n, "select my_wallet() w")).coins;
const ranking = order => JSON.stringify(order.map((n, i) => ({ id: U(n), place: i + 1 })));
const report = (host, s, set, idx, order, game = "secretdiary") => one(host, "select report_game($1, $2, $3, $4, $5::jsonb)", [s, set, idx, game, ranking(order)]);
const confirm = (n, s, set, idx) => one(n, "select confirm_game($1, $2, $3)", [s, set, idx]);
const err = async p => { try { await p; return null; } catch (e) { return e.message; } };

head("A set of 3 games, 5 players: coins by place, host reward at the end");
const S = "session-aaaa-1111";
const P5 = [1, 2, 3, 4, 5];
ok(await report(1, S, 1, 1, P5) === 0, "the host reports game 1 (nobody has confirmed yet: 0 paid)");
ok(await confirm(1, S, 1, 1) === 30 && await confirm(2, S, 1, 1) === 20 && await confirm(3, S, 1, 1) === 12 && await confirm(4, S, 1, 1) === 5, "each player confirming is paid by place: 30 / 20 / 12 / 5");
ok(await confirm(4, S, 1, 1) === 0 && await coins(4) === 5, "confirming twice pays once");
ok(await confirm(5, S, 1, 2) === 0, "confirming before the host's report pays nothing yet");
ok(await report(1, S, 1, 2, [5, 4, 3, 2, 1]) === 30, "…and is paid when the report lands (player 5 came 1st)");
for (const n of [1, 2, 3, 4]) await confirm(n, S, 1, 2);
ok(await err(report(1, S, 1, 2, P5)) === null && await report(1, S, 1, 2, P5) === 0, "reporting a game twice changes nothing");
ok((await err(report(1, "session-bbbb-2222", 1, 3, P5)))?.includes("order"), "games go in order: no game 3 without game 2");
ok(await confirm(5, S, 1, 1) === 5, "a late confirmation (within 30 minutes) still pays");
await report(1, S, 1, 3, P5);
for (const n of [2, 3]) await confirm(n, S, 1, 3);
ok(await one(1, "select my_party_coins($1, 1)", [S]) === 30 + 5, "no host reward while fewer than 4 players have all 3 games in");
for (const n of [4, 5]) await confirm(n, S, 1, 3);
ok(await one(1, "select my_party_coins($1, 1)", [S]) === 30 + 5 + 50, "4 players in all 3 games: the host gets +50 (even before confirming game 3)");
ok(await confirm(1, S, 1, 3) === 30 && await coins(1) === 30 + 5 + 50 + 30, "the host's own game-3 confirmation pays their place, and the reward isn't paid twice");

head("Anti-farming");
const S2 = "session-cccc-3333";
for (const idx of [1, 2, 3]) { await report(6, S2, 1, idx, [6, 7, 8]); for (const n of [6, 7, 8]) await confirm(n, S2, 1, idx); }
ok(!(await as(6, "select * from coin_ledger where user_id = $1 and reason = 'host'", [U(6)])).length, "no host reward with fewer than 4 players in all 3 games");
const S3 = "session-dddd-4444";
await report(1, S3, 1, 1, [1, 2, 3, 9]);
ok(await confirm(9, S3, 1, 1) === 5, "someone in the report who confirms is paid");
ok(await err(report(2, "session-eeee-5555", 1, 1, [3, 4, 5])) !== null, "the host must be one of the players");
ok(await err(report(2, "session-eeee-5555", 1, 1, [2, 3], "poker")) !== null, "only known games");
ok(await err(report(2, "session-eeee-5555", 1, 1, [2, 3], "mission")) !== null, "the retired game no longer pays");
ok(await err(report(2, "session-ffff-6666", 1, 1, [2, 3], "mask_off")) === null, "Mask Off reports like any other game");
// the daily cap: 300 per player per day
for (let k = 0; k < 14; k++) {
  const s = `session-cap-${String(k).padStart(4, "0")}`;
  await report(9, s, 1, 1, [9, 2]); await confirm(9, s, 1, 1);
}
ok(await coins(9) === 300, `the daily cap holds: player 9 stops at 300 (got ${await coins(9)})`);
// host rewards: at most 3 a day
for (let k = 0; k < 5; k++) {
  const s = `session-host-${k}0000`;
  for (const idx of [1, 2, 3]) { await report(3, s, 1, idx, [4, 5, 6, 3]); for (const n of [3, 4, 5, 6]) await confirm(n, s, 1, idx); }
}
ok(Number(await one(3, "select count(*) from coin_ledger where user_id = $1 and reason = 'host'", [U(3)])) <= 3, "at most 3 host rewards a day");

head("The shop");
const before = await coins(7);
ok((await one(7, "select buy_item('top-hoodie-maroon')")).ok === false && await coins(7) === before, `can't buy what you can't afford (has ${before}, needs 150; nothing taken)`);
const r = await one(1, "select buy_item('shoes-clog-pink')");
ok(r.ok && r.coins === 115 - 90 && r.owned.includes("shoes-clog-pink"), `buying takes the price and unlocks the item (now ${r.coins}, owns ${r.owned})`);
const r2 = await one(1, "select buy_item('shoes-clog-pink')");
ok(r2.ok && r2.coins === 25, "buying it again doesn't charge again");
ok((await err(as(2, "update profiles set avatar = '{\"shoes\": \"clog-pink\"}' where id = $1", [U(2)])))?.includes("locked"), "you can't put on a shop item you don't own");
ok(await err(as(1, "update profiles set avatar = '{\"shoes\": \"clog-pink\"}' where id = $1", [U(1)])) === null, "…and can once you own it");
ok(await err(as(2, "update profiles set avatar = '{\"shoes\": \"loafer-black\"}' where id = $1", [U(2)])) === null, "free items stay free");

head("Humiliation Ritual: the prompt is drawn on the server, for the caller only");
const POOL = JSON.parse(await readFile(`${ROOT}web/data/ritual_prompts.json`, "utf8")).prompts;
const rows = await as(0, "select id, level, text from ritual_prompts order by id");
ok(rows.length === POOL.length && POOL.every(p => rows.some(r => r.id === p.id && r.level === p.level && r.text === p.text)),
  `the server's prompts match web/data/ritual_prompts.json (${rows.length})`);
const draw = (n, room, turn, level = "mild") => one(n, "select ritual_draw($1, $2, $3)", [room, turn, level]);
const R = "party-sess-1111";
const d1 = await draw(1, R, "turnkey0001");
ok(d1?.id && POOL.find(p => p.id === d1.id)?.text === d1.text, `the performer gets a prompt (${d1.id})`);
ok((await draw(1, R, "turnkey0001")).id === d1.id, "asking again for the same turn gets the same prompt (a reload)");
const d2 = await draw(2, R, "turnkey0001");
ok(d2.id !== d1.id, "someone else drawing 'for' that turn gets a different prompt of their own, never the performer's");
const seen = new Set([d1.id, d2.id]);
const mild = POOL.filter(p => p.level === "mild").length;
for (let k = 2; k < mild; k++) seen.add((await draw(3, R, `turnkey${String(k).padStart(4, "0")}`)).id);
ok(seen.size === mild, `no prompt comes up twice in a room until all ${mild} mild ones have (${seen.size})`);
ok([...seen].every(id => POOL.find(p => p.id === id).level === "mild"), "a mild party only ever draws mild prompts");
ok(!!(await draw(3, R, "turnkey9999"))?.id, "once the pool is used up, the room starts over");
let spicy = false;
for (let k = 0; k < 40 && !spicy; k++) { const d = await draw(4, `party-sp-${k}`, "turnkey0001", "spicy"); spicy = POOL.find(p => p.id === d.id).level === "spicy"; }
ok(spicy, "a spicy party can draw the spicy prompts");
ok((await err(draw(0, R, "turnkey0001")))?.includes("sign in"), "you have to be signed in");
ok((await err(draw(1, R, "turnkey0001", "extreme")))?.includes("level"), "only known levels");
ok((await err(draw(1, R, "x")))?.includes("bad turn") && (await err(draw(1, "bad room!", "turnkey0001")))?.includes("bad turn"), "turn and room ids are checked");
const priv = await as(0, `select has_table_privilege('authenticated', 'ritual_prompts', 'select') a, has_table_privilege('authenticated', 'ritual_draws', 'select') b,
  has_table_privilege('anon', 'ritual_draws', 'insert') c, has_function_privilege('anon', 'ritual_draw(text, text, text)', 'execute') d,
  has_function_privilege('authenticated', 'ritual_draw(text, text, text)', 'execute') e`);
ok(!priv[0].a && !priv[0].b && !priv[0].c && !priv[0].d && priv[0].e, "clients can't read the prompts or the draws; signed-in players can only call ritual_draw");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
