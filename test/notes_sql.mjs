// Notes on the map, the server rules run for real: supabase/migrations/
// 019_notes.sql (on top of 013's coins and 017/018's events) in an embedded
// Postgres (PGlite, WASM — no server), with a small stand-in for Supabase's
// auth schema (auth.users with created_at / phone_confirmed_at,
// auth.identities, auth.uid() from a setting).
//   node test/notes_sql.mjs
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { snap, distM, NOTE_SPOTS } from "../web/notegeo.js";
import { serverProblem, SLUR_WORDS, SLUR_STEMS } from "../web/notefilter.js";

const ROOT = new URL("..", import.meta.url).pathname;
const db = new PGlite();
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else fails++; console.log(`${c ? "  ✓" : "  ✗"} ${m}`); };
const head = t => console.log(`\n${t}`);

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, created_at timestamptz not null default now() - interval '10 days', phone_confirmed_at timestamptz);
  create table auth.identities (user_id uuid references auth.users (id), provider text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.profiles (id uuid primary key references auth.users (id), handle text, avatar jsonb not null default '{}'::jsonb);
`);
for (const f of ["013_coins_shop", "017_events", "018_account_events", "019_notes", "020_notes_no_verify"]) await db.exec(await readFile(`${ROOT}supabase/migrations/${f}.sql`, "utf8"));

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const N_USERS = 80;
for (let i = 1; i <= N_USERS; i++) await db.query("insert into auth.users (id, phone_confirmed_at) values ($1, now())", [U(i)]);
const sql = async (sqlText, args = []) => (await db.query(sqlText, args)).rows;
const as = async (n, q, args = []) => { await db.exec(`set test.uid = '${n ? U(n) : ""}'`); return (await db.query(q, args)).rows; };
const one = async (n, q, args) => Object.values((await as(n, q, args))[0])[0];
const err = async p => { try { await p; return null; } catch (e) { return e.message; } };

// a spot in Itaewon, away from every known spot (none within 60 m)
const PLAIN = { lat: 37.53605, lng: 126.99120 };
// metres -> a point that far north / east of p
const north = (p, m) => ({ lat: p.lat + m / 110540, lng: p.lng });
const east = (p, m) => ({ lat: p.lat, lng: p.lng + m / (111320 * Math.cos(p.lat * Math.PI / 180)) });
const leave = (n, p, kind = "text", { body = "best tteokbokki on this street", top = null, bottom = null, image = null } = {}) =>
  one(n, "select leave_note($1, $2, $3, $4, $5, $6, $7)", [p.lat, p.lng, kind, body, top, bottom, image]);
const open = (n, id, p) => one(n, "select open_note($1, $2, $3)", [id, p.lat, p.lng]);
const vote = (n, id, p, v) => one(n, "select vote_note($1, $2, $3, $4)", [id, p.lat, p.lng, v]);
const react = (n, id, p, r) => one(n, "select react_note($1, $2, $3, $4)", [id, p.lat, p.lng, r]);
const report = (n, id, p) => one(n, "select report_note($1, $2, $3)", [id, p.lat, p.lng]);
const box = (n, p, d = 0.01) => one(n, "select notes_in_box($1, $2, $3, $4)", [p.lat - d, p.lng - d, p.lat + d, p.lng + d]);
const row = async id => (await sql("select * from notes where id = $1", [id]))[0];
const days = ms => ms / 864e5;
// everything a client ever got back, to look for the author in
const seen = [];
const keep = v => { seen.push(JSON.stringify(v)); return v; };

head("Snapping: the phone and the server agree, to the 20 m grid");
{
  let same = 0, idem = 0, inCell = 0;
  const pts = [];
  for (let k = 0; k < 400; k++) {
    const base = [[37.53, 126.99], [51.04, -114.06], [-33.87, 151.2], [64.1, -21.9], [0.3, -78.5]][k % 5];
    pts.push([base[0] + (Math.random() - 0.5) * 0.05, base[1] + (Math.random() - 0.5) * 0.05]);
  }
  for (const [lat, lng] of pts) {
    const js = snap(lat, lng);
    const [r] = await sql("select note_snap_lat($1) a, note_snap_lng(note_snap_lat($1), $2) b", [lat, lng]);
    if (Math.abs(r.a - js.lat) < 1e-9 && Math.abs(r.b - js.lng) < 1e-9) same++;
    const again = snap(js.lat, js.lng);
    if (again.lat === js.lat && again.lng === js.lng) idem++;
    if (distM({ lat, lng }, js) <= 14.2) inCell++;
  }
  ok(same === pts.length, `SQL note_snap_* and web/notegeo.js snap() give the same cell centre (${same}/${pts.length}, 5 cities, both hemispheres)`);
  ok(idem === pts.length, "snapping a snapped spot changes nothing");
  ok(inCell === pts.length, "a spot is never more than ~14 m (half a 20 m cell's diagonal) from its snapped centre");
  const raw = { lat: 37.5360512, lng: 126.9912388 };
  const n = keep(await leave(1, raw));
  const r = await row(n.id), want = snap(raw.lat, raw.lng);
  ok(r.lat === want.lat && r.lng === want.lng && (r.lat !== raw.lat || r.lng !== raw.lng), `the note is stored at the cell centre (${r.lat}, ${r.lng}), not the position sent (${raw.lat}, ${raw.lng})`);
  const cols = (await sql("select column_name from information_schema.columns where table_name in ('note_votes','note_reacts','note_views','note_reports')")).map(c => c.column_name);
  ok(!cols.some(c => /lat|lng|pos|where|loc/.test(c)), `no table keeps a reader's position (votes / reacts / views / reports columns: ${[...new Set(cols)].join(", ")})`);
  await sql("delete from notes");
}

head("5 notes per player per day");
{
  const res = [];
  for (let k = 0; k < 6; k++) res.push(keep(await leave(2, north(PLAIN, k * 30), "text", { body: `note ${k}` })));
  ok(res.slice(0, 5).every(r => r.ok) && res[4].left === 0, `five go up (left after each: ${res.slice(0, 5).map(r => r.left).join(" ")})`);
  ok(res[5].ok === false && res[5].why === "limit", "the sixth is refused: 'limit'");
  ok(await one(2, "select my_notes_left()") === 0 && await one(3, "select my_notes_left()") === 5, "my_notes_left: 0 for them, 5 for someone else");
  await sql("update notes set created_at = created_at - interval '1 day' where author = $1", [U(2)]);
  ok((keep(await leave(2, PLAIN))).ok, "the next day they can leave notes again");
  await sql("delete from notes");
}

head("Within 80 m to open, vote and react; markers from a box");
let A;
{
  A = keep(await leave(1, PLAIN));
  const near = east(PLAIN, 55), far = east(PLAIN, 130);
  ok(keep(await open(2, A.id, near)).ok === true, "a reader 55 m away opens it");
  const f = keep(await open(3, A.id, far));
  ok(f.ok === false && f.why === "far" && !("body" in f), "130 m away: 'far', and none of the content");
  ok((keep(await vote(3, A.id, far, 1))).why === "far" && (keep(await react(3, A.id, far, 1))).why === "far", "…nor can they vote or react from there");
  ok((keep(await vote(2, A.id, near, 1))).score === 1, "the reader in range can vote");
  const edge = north(PLAIN, 58);
  ok(keep(await open(4, A.id, edge)).ok === true, "58 m north: opens (the check is between the two snapped cells, so the edge is 80 m ± a cell)");
  const m = keep(await box(5, far));
  ok(m.some(x => x.id === A.id) && !("body" in m[0]), "the far player still sees its marker in the box (no content in a marker)");
  ok(keep(await box(5, { lat: 37.6, lng: 127.1 })).length === 0, "a box elsewhere doesn't have it");
  ok((await err(box(5, PLAIN, 0.3)))?.includes("bad box"), "a box can't be the whole city at once (~20 km)");
  ok(keep(await open(1, A.id, { lat: 10, lng: 10 })).ok === true, "the author can open their own note from anywhere");
}

head("One vote and one reaction per player per note (changeable, never double)");
{
  const p = east(PLAIN, 20);
  await vote(4, A.id, p, 1); await vote(4, A.id, p, 1);
  let r = await row(A.id);
  ok(Number(r.wup) === 2 && (await sql("select count(*)::int c from note_votes where note = $1", [A.id]))[0].c === 2, "voting up twice counts once (2 voters, 2 up)");
  r = keep(await vote(4, A.id, p, -1));
  ok(r.score === 0 && r.my_vote === -1, "changing the vote moves it (up 1, down 1: score 0)");
  r = keep(await vote(4, A.id, p, 0));
  ok(r.score === 1 && r.my_vote === null, "0 takes it back");
  ok(keep(await vote(1, A.id, PLAIN, 1)).why === "own", "the author can't vote on their own note at all");
  ok(keep(await react(1, A.id, PLAIN, 1)).why === "own", "…nor agree with it");
  await react(5, A.id, p, 1); await react(5, A.id, p, 1); await react(6, A.id, p, -1);
  r = keep(await react(7, A.id, p, 1));
  ok(r.agree === 2 && r.disagree === 1, `agree / disagree: 2 / 1 (one each per player; got ${r.agree} / ${r.disagree})`);
  r = keep(await react(6, A.id, p, 1));
  ok(r.agree === 3 && r.disagree === 0 && r.my_react === 1, "changing a reaction moves it");
  const before = (await row(A.id)).expires_at.getTime();
  await react(8, A.id, p, -1);
  ok((await row(A.id)).expires_at.getTime() === before, "reactions don't change how long it lives");
  const v0 = (await row(A.id)).views;
  await open(2, A.id, p); await open(2, A.id, p);
  await open(9, A.id, p);
  ok((await row(A.id)).views === v0 + 1, `views are unique players: 2 opening again adds nothing, 9 adds one (${v0} -> ${(await row(A.id)).views})`);
  ok(keep(await open(1, A.id, p)).views === v0 + 1, "the author opening it isn't a view");
}

head("Lifespan, the landmark, spots");
{
  const B = keep(await leave(10, north(PLAIN, 300)));
  const at = north(PLAIN, 300);
  let r = await row(B.id);
  ok(Math.abs(days(r.expires_at - r.created_at) - 7) < 0.001, "a new note lives 7 days");
  ok(B.spot === null, "(away from every spot)");
  for (let k = 11; k <= 13; k++) await vote(k, B.id, at, 1);
  r = await row(B.id);
  ok(Math.abs(days(r.expires_at - r.created_at) - 10) < 0.001, `3 upvotes (weight 1 each): +3 days = 10 (${days(r.expires_at - r.created_at).toFixed(2)})`);
  for (let k = 14; k <= 18; k++) await vote(k, B.id, at, -1);
  r = await row(B.id);
  ok(Math.abs(days(r.expires_at - r.created_at) - 5) < 0.001, "then 5 downvotes: net -2, 5 days");
  // 24 net isn't a landmark; 25 is
  for (let k = 14; k <= 18; k++) await vote(k, B.id, at, 0);
  for (let k = 19; k <= 39; k++) await vote(k, B.id, at, 1);
  r = await row(B.id);
  ok(Number(r.wup) - Number(r.wdown) === 24 && !r.landmark, "24 weighted net: not yet a landmark");
  r = keep(await vote(40, B.id, at, 1));
  ok(r.landmark === true && r.score === 25, "25: a permanent landmark");
  await sql("update notes set created_at = now() - interval '400 days' where id = $1", [B.id]);
  await vote(41, B.id, at, -1);
  ok(keep(await open(42, B.id, at)).ok === true && (await row(B.id)).landmark, "a landmark outlives its days (400 days old, still there)");

  const C = keep(await leave(10, north(PLAIN, 600)));
  const atC = north(PLAIN, 600);
  for (let k = 11; k <= 21; k++) await vote(k, C.id, atC, -1);
  r = await row(C.id);
  ok(Math.abs(r.expires_at.getTime() - Date.now()) < 5000, "voted down past now (7 - 11): its end is floored at now…");
  ok(keep(await open(22, C.id, atC)).why === "gone" && !keep(await box(22, atC)).some(x => x.id === C.id), "…and it's gone: no marker, can't open");

  const old = keep(await leave(10, north(PLAIN, 900)));
  await sql("update notes set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [old.id]);
  ok(keep(await open(22, old.id, north(PLAIN, 900))).why === "gone", "an untouched note is gone after its 7 days");

  // a note at a spot: 10 days, and votes count 1.25x toward the landmark
  const opry = NOTE_SPOTS.find(s => s.id === "grainhaus");
  const S = keep(await leave(10, east(opry, 25)));
  r = await row(S.id);
  ok(S.spot === "Grainhaus" && r.spot === "grainhaus", `a note 25 m from Grainhaus belongs to it ("${S.spot}")`);
  ok(Math.abs(days(r.expires_at - r.created_at) - 10) < 0.001, "a spot note starts with 10 days, not 7");
  const atS = east(opry, 25);
  for (let k = 11; k <= 29; k++) await vote(k, S.id, atS, 1);
  ok(!(await row(S.id)).landmark, "19 net at a spot (×1.25 = 23.75): not yet");
  await vote(30, S.id, atS, 1);
  ok((await row(S.id)).landmark, "20 net at a spot (×1.25 = 25): a landmark, where a plain note needs 25");
  const far = keep(await leave(10, north(opry, -80)));
  ok(far.spot === null, "80 m south of it (nothing else near): not a spot note");
}

head("Trust-weighted votes (server-side only)");
{
  const T = keep(await leave(1, north(PLAIN, 1200)));
  const at = north(PLAIN, 1200);
  // 50: under 3 days old; 51: verified, 40 days, 3 games; 52: verified, 40 days, no games;
  // 53: 40 days, not verified; 54: had a note removed (an upheld report); 55: banned
  await sql("update auth.users set created_at = now() - interval '1 day' where id = $1", [U(50)]);
  await sql("update auth.users set created_at = now() - interval '40 days' where id = any($1)", [[U(51), U(52), U(53)]]);
  await sql("update auth.users set phone_confirmed_at = null where id = $1", [U(53)]);
  for (const g of [1, 2, 3]) await sql("insert into game_receipts (session, set_no, game_idx, user_id) values ('session-trust-0001', 1, $1, $2)", [g, U(51)]);
  await sql("insert into notes (author, kind, body, lat, lng, expires_at, status) values ($1, 'text', 'x', 0, 0, now() + interval '7 days', 'removed')", [U(54)]);
  await sql("insert into note_bans (user_id) values ($1)", [U(55)]);
  const w = async n => Number((await sql("select _note_trust($1) w", [U(n)]))[0].w);
  ok(await w(50) === 0.5 && await w(51) === 2 && await w(52) === 1.5 && await w(53) === 1 && await w(54) === 0 && await w(55) === 0,
    `weights: new 0.5 · verified+30d+games 2.0 · verified+30d 1.5 · unverified 1.0 · upheld report 0 · banned 0 `);
  await vote(50, T.id, at, 1); await vote(51, T.id, at, 1); await vote(54, T.id, at, 1); await vote(55, T.id, at, 1);
  let r = await row(T.id);
  ok(Number(r.wup) === 2.5 && Math.abs(days(r.expires_at - r.created_at) - 9.5) < 0.001, `life uses the weighted total: 0.5 + 2 + 0 + 0 = 2.5 up -> 9.5 days (${r.wup})`);
  const c = keep(await open(52, T.id, at));
  ok(c.score === 3 && !("w" in c) && !JSON.stringify(c).includes("trust"), "the visible score is the weighted net rounded (3), with no weights in it");
  ok(!(await sql("select has_table_privilege('authenticated', 'note_votes', 'select') a"))[0].a, "nobody can read the votes (or their weights) from a client");
}

head("Reports hide a note at once, for everyone");
{
  const R = keep(await leave(1, north(PLAIN, 1500)));
  const at = north(PLAIN, 1500);
  ok(keep(await box(2, at)).some(x => x.id === R.id), "on the map");
  ok(keep(await report(2, R.id, at)).ok, "player 2 reports it");
  ok(!keep(await box(3, at)).some(x => x.id === R.id) && keep(await open(3, R.id, at)).why === "gone", "gone for player 3: no marker, can't open");
  ok(!keep(await box(1, at)).some(x => x.id === R.id) && keep(await open(1, R.id, at)).why === "gone", "gone for its author too");
  ok(keep(await vote(4, R.id, at, 1)).why === "gone", "can't be voted on while hidden");
  ok((await err(as(2, "select * from note_reports_queue()")))?.includes("admins"), "only admins see the queue");
  await sql("insert into admins values ($1)", [U(70)]);
  const q = await one(70, "select note_reports_queue()");
  ok(q.some(x => x.id === R.id && x.reports === 1) && !JSON.stringify(q).includes(U(1)), "the admin's queue has it (with no author id)");
  await one(70, "select review_note($1, 'restore')", [R.id]);
  ok(keep(await box(3, at)).some(x => x.id === R.id), "restored by an admin: back");
  await report(5, R.id, at);
  ok(keep(await box(3, at)).some(x => x.id === R.id), "a reviewed-and-kept note isn't hidden again by another report (it still queues)");
  ok(keep(await report(6, R.id, east(at, 400))).why === "far", "reporting needs the 80 m too (no hiding the whole city from home)");
  const cols = (await sql("select column_name from information_schema.columns where table_name = 'note_reports'")).map(c => c.column_name);
  ok(!cols.some(c => /text|body|message|reason/.test(c)), "a report carries no message text");
}

head("Bans: repeat offenders can't post");
{
  const Z = keep(await leave(60, north(PLAIN, 1800)));
  await one(70, "select review_note($1, 'ban')", [Z.id]);
  ok((await row(Z.id)).status === "removed", "the admin's ban removes the note…");
  ok(keep(await leave(60, north(PLAIN, 1900))).why === "banned", "…and leave_note refuses its author: 'banned'");
  ok(Number((await sql("select _note_trust($1) w", [U(60)]))[0].w) === 0, "and their votes weigh nothing");
  await sql("update auth.users set phone_confirmed_at = null where id = $1", [U(61)]);
  ok(keep(await leave(61, north(PLAIN, 1900))).ok, "an unverified account (a guest) can leave notes too (020: no phone needed)");
  ok((await err(as(0, "select leave_note(37.5, 127.0, 'text', 'hi')")))?.includes("sign in"), "signed out: refused");
}

head("Photos and memes: pending until the moderator passes them, seen only by the author meanwhile");
{
  const img = `${U(1)}/11111111-2222-4333-8444-555555555555.jpg`;
  const at = north(PLAIN, 2100);
  const P = keep(await leave(1, at, "photo", { body: null, image: img }));
  ok(P.ok && P.image_state === "pending", "a photo goes up pending");
  ok(!keep(await box(2, at)).some(x => x.id === P.id) && keep(await open(2, P.id, at)).why === "gone", "others: no marker, can't open");
  const mine = keep(await box(1, at)).find(x => x.id === P.id);
  const own = keep(await open(1, P.id, at));
  ok(mine?.state === "pending" && own.upload === img && own.image === null, "its author sees it, marked pending, with their own upload");
  ok((await err(leave(1, at, "photo", { body: null, image: `${U(2)}/11111111-2222-4333-8444-555555555555.jpg` })))?.includes("bad image"), "you can only post your own upload");
  ok(!(await sql("select has_function_privilege('authenticated', 'note_image_verdict(uuid, boolean)', 'execute') a, has_function_privilege('service_role', 'note_image_verdict(uuid, boolean)', 'execute') b"))[0].a, "a player can't pass their own image (the verdict is the service role's only)");
  await sql("select note_image_verdict($1, true)", [P.id]);
  const o = keep(await open(2, P.id, at));
  ok(o.ok && o.image === `${P.id}.jpg` && o.upload === null && o.image_state === null, "passed: everyone gets the public copy, named after the note (not the upload path, which has the author's id in it), and no review state");
  const M = keep(await leave(1, east(at, 100), "meme", { body: null, top: "when the bus", bottom: "doesn't come", image: `${U(1)}/66666666-2222-4333-8444-555555555555.jpg` }));
  await sql("select note_image_verdict($1, false)", [M.id]);
  ok(keep(await open(2, M.id, east(at, 100))).why === "gone" && keep(await box(1, east(at, 100))).find(x => x.id === M.id)?.state === "rejected", "rejected: never shown to others; its author sees 'rejected'");
  await sql("select note_image_verdict($1, true)", [M.id]);
  ok(keep(await open(2, M.id, east(at, 100))).why === "gone", "a verdict is final (only pending images get one)");
  ok((await err(leave(1, at, "meme", { body: "x", image: img }))) !== null && (await err(leave(1, at, "text", { image: img }))) !== null, "the shapes are checked (a meme has captions, not a body; text has no image)");
}

head("The text filter: SQL is the authority for phone numbers, emails and slurs");
{
  const corpus = ["call me 010-1234-5678", "+82 10 1234 5678", "０１０１２３４５６７８", "mail mina@gmail.com", "mina (at) gmail (dot) com", "MINA@Naver.COM",
    "n i g g e r", "f4gg0t lol", "faggots", "짱 깨 꺼져", "틀딱들", "you\u200Bretard", "re\u200Btard", "ｎｉｇｇｅｒ", "retards", "nigggggger", "best tteokbokki on this street!!",
    "spicy raccoon in nigeria", "2026년 10월 28일", "open 11-23, cash only", "room 404", "meet at 7:30", "이번주 금요일 파티", "good coffee @ the corner", "coon"];
  let agree = 0;
  for (const t of corpus) { const s = (await sql("select note_text_problem($1) p", [t]))[0].p; if (s === serverProblem(t)) agree++; else console.log(`    differs: ${JSON.stringify(t)} sql=${s} js=${serverProblem(t)}`); }
  ok(agree === corpus.length, `SQL and web/notefilter.js agree on every sample (${agree}/${corpus.length})`);
  const rows = await sql("select word, stem from note_slurs");
  const want = [...SLUR_WORDS.map(w => `${w}|false`), ...SLUR_STEMS.map(w => `${w}|true`)].sort();
  ok(JSON.stringify(rows.map(r => `${r.word}|${r.stem}`).sort()) === JSON.stringify(want), `the SQL's slur rows match web/notefilter.js (${want.length})`);
  const res = [];
  for (const [t, why] of [["text me 010 9876 5432", "phone"], ["dm mina@gmail.com", "email"], ["go back home ch1nk", "slur"]])
    res.push((keep(await leave(3, north(PLAIN, 2500), "text", { body: t }))).why === why);
  ok(res.every(Boolean), "leave_note refuses them whatever the phone let through (phone / email / slur)");
  ok(keep(await leave(3, north(PLAIN, 2500), "meme", { body: null, top: "call 010-1234-5678", image: `${U(3)}/77777777-2222-4333-8444-555555555555.jpg` })).why === "phone", "meme captions are checked too");
  ok(keep(await leave(3, north(PLAIN, 2500), "text", { body: "x".repeat(201) })).why === "long", "201 characters: too long");
}

head("Coins for upvotes: verified authors, 1 per 5, 10 a day at most");
{
  const coins = async n => Number((await sql("select coalesce((select coins from wallets where user_id = $1), 0) c", [U(n)]))[0].c);
  // author 62 (verified): two notes, 40 voters each (weight 1) -> 8 + 8 steps, but 10 a day
  const at1 = north(PLAIN, 2800), at2 = north(PLAIN, 3100);
  const n1 = keep(await leave(62, at1)), n2 = keep(await leave(62, at2));
  for (let k = 1; k <= 4; k++) await vote(k + 10, n1.id, at1, 1);
  ok(await coins(62) === 0, "4 upvotes: nothing yet");
  await vote(15, n1.id, at1, 1);
  ok(await coins(62) === 1, "the 5th: 1 coin");
  await vote(15, n1.id, at1, 0); await vote(15, n1.id, at1, 1);
  ok(await coins(62) === 1, "taking a vote back and giving it again doesn't pay twice");
  const plain = [...Array(34).keys()].map(k => k + 16).concat([56]);    // 35 more voters of weight 1 (not 50-55: the trust test's)
  for (const k of plain) await vote(k, n1.id, at1, 1);
  ok(await coins(62) === 8, `40 upvotes: 8 coins (${await coins(62)})`);
  for (const k of [11, 12, 13, 14, 15, ...plain]) await vote(k, n2.id, at2, 1);
  ok(await coins(62) === 10, `another 40 on a second note: capped at 10 a day (${await coins(62)})`);
  const led = await sql("select reason, item from coin_ledger where user_id = $1", [U(62)]);
  ok(led.every(l => l.reason === "note"), "paid through the ledger as 'note'");
  // an author who isn't verified any more: no coins
  await sql("update auth.users set phone_confirmed_at = null where id = $1", [U(63)]);
  await sql("insert into notes (author, kind, body, lat, lng, expires_at) values ($1, 'text', 'x', $2, $3, now() + interval '7 days')", [U(63), snap(at1.lat, at1.lng + 0.001).lat, snap(at1.lat, at1.lng + 0.001).lng]);
  const n3 = (await sql("select id from notes where author = $1", [U(63)]))[0].id;
  for (let k = 11; k <= 20; k++) await vote(k, n3, east(at1, 80), 1);
  ok(await coins(63) === 0, "an unverified author earns nothing");
  ok(!(await sql("select has_function_privilege('authenticated', '_note_pay(uuid, uuid, integer)', 'execute') a"))[0].a, "and nobody can call the payout directly");
}

head("The author is never returned to anyone; clients can't touch the tables");
{
  const authorIds = (await sql("select distinct author::text a from notes")).map(r => r.a);
  // (an author's own replies carry their own upload's path, "<their id>/…jpg": theirs only, tested above)
  const others = seen.map(s => s.replace(/"upload": ?"[^"]*"/g, ""));
  ok(others.length > 50 && !others.some(s => authorIds.some(a => s.includes(a))), `no author id in any of the ${seen.length} replies clients got`);
  ok(!seen.some(s => /"author"/.test(s)), "no 'author' field either");
  const priv = await sql(`select bool_or(has_table_privilege('authenticated', t, 'select') or has_table_privilege('authenticated', t, 'insert')
      or has_table_privilege('authenticated', t, 'update') or has_table_privilege('anon', t, 'select')) any
    from unnest(array['notes','note_votes','note_reacts','note_views','note_reports','note_bans','note_spots','note_slurs']) t`);
  ok(!priv[0].any, "no client can read or write any notes table directly");
  ok(!(await sql("select has_function_privilege('anon', 'leave_note(float8, float8, text, text, text, text, text)', 'execute') a"))[0].a, "anon (not signed in) can't call the API");
}

head("Spots: the SQL's rows are web/notegeo.js NOTE_SPOTS, covering the NPC venues and heroes.json");
{
  const rows = await sql("select id, name, lat, lng from note_spots order by id");
  ok(JSON.stringify(rows.map(r => [r.id, r.name, r.lat, r.lng])) === JSON.stringify([...NOTE_SPOTS].sort((a, b) => a.id < b.id ? -1 : 1).map(s => [s.id, s.name, s.lat, s.lng])), `the rows match (${rows.length})`);
  const w3d = await readFile(`${ROOT}web/world3d.js`, "utf8");
  const npcs = [...w3d.slice(w3d.indexOf("ARCH_NPC_DEFS = ["), w3d.indexOf("];", w3d.indexOf("ARCH_NPC_DEFS = ["))).matchAll(/id: "([^"]+)"[\s\S]*?lat: ([\d.-]+),\s*lng: ([\d.-]+)/g)].map(m => ({ id: m[1], lat: +m[2], lng: +m[3] }));
  const heroes = JSON.parse(await readFile(`${ROOT}web/data/heroes.json`, "utf8")).heroes;
  const has = p => NOTE_SPOTS.some(s => s.id === p.id && s.lat === p.lat && s.lng === p.lng);
  ok(npcs.length === 3 && npcs.every(has), `every NPC spot of world3d.js is a spot (${npcs.map(n => n.id).join(", ")})`);
  ok(heroes.every(has), `every place in heroes.json is a spot (${heroes.length})`);
  ok((await as(1, "select note_spot_list() l"))[0].l.length === NOTE_SPOTS.length, "note_spot_list() gives the map its hubs");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
