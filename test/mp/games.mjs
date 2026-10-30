// Playing the party games with real phones. Each phone acts for its own
// player only, the way its buttons would: the same input message the game's
// own button sends (window.__rando.input, i.e. HostGame.input -> the host),
// decided from what that phone itself has (its synced copy of the state, its
// own hand, the prompt only the performer's phone holds). The host's copy is
// read to check that turns rotate, inputs land, scores move and the game ends
// the same on every phone.
import { sleep, Fail } from "./lib.mjs";

// the order the user asked for: Side Quest first, then the others
export const GAMES = ["sidequest", "mask_off", "ritual", "secretdiary", "artgallery", "manhunt"];
export const TITLES = { sidequest: "Side Quest", mask_off: "Mask Off", ritual: "Humiliation Ritual", secretdiary: "Secret Diary", artgallery: "Art Gallery", manhunt: "Manhunt" };

const st = ph => ph.r(R => R.gameState()).catch(() => null);
const send = (ph, type, payload = {}) => ph.r((R, a) => R.input(a.type, a.payload), { type, payload }).catch(() => false);

// the host opens Game votes and starts a game from it (the real sheet)
export async function startGame(H, id) {
  await H.tap("#pt-vote");
  if (!(await H.until((R, id) => !!document.querySelector(`#pt-picker [data-game="${id}"] .pv-t > b`), id, 15000))) throw new Fail(`host: "${id}" isn't in Game votes`);
  await H.page.evaluate(id => document.querySelector(`#pt-picker [data-game="${id}"] .pv-t > b`).click(), id);
}

// one tick: what each phone does now, from its own copy of the state
async function actAll(game, phones, host, ctx) {
  ctx.host = host;
  const hs = await st(host);
  if (!hs) return null;
  await Promise.all(phones.filter(p => !p.dropped && !p.closed).map(async ph => {
    const s = ph === host ? hs : await st(ph);
    if (!s || !ph.id) return;
    const me = ph.id, isHost = ph === host;
    const done = (ctx.did[ph.name] ??= new Set());
    const once = (k, f) => { if (done.has(k)) return; done.add(k); return f(); };
    // how to play: everyone has heard it
    if (s.phase === "howto") return once(`howto`, () => send(ph, "howto-ok"));
    await DRIVERS[game](ph, s, { me, isHost, once, ctx, hs });
  }));
  return hs;
}

const DRIVERS = {
  async sidequest(ph, s, { me, isHost, once }) {
    const t = s.turn;
    if (s.phase === "setup" && isHost) return once("go", async () => { await sleep(400); (await ph.tap("#sq-go")) || send(ph, "sq-go"); });
    if (s.phase === "do" && t && t.who !== me && t.votes?.[me] === undefined) return once(`rate-${s.ti}`, () => send(ph, "rate", { v: 1 + ((s.ti + ph.name.length) % 5) }));
  },
  async mask_off(ph, s, { me, isHost, once }) {
    const t = s.turn;
    if (s.phase === "setup" && isHost) return once("go", async () => { await send(ph, "mo-rounds", { n: 1 }); await sleep(400); (await ph.tap("#mo-go")) || send(ph, "mo-go"); });
    if (s.phase === "choose" && t?.asker === me && !t.card) return once(`ask-${s.ti}`, async () => {
      const ids = Object.values(s.players).filter(p => !p.gone && p.id !== me && p.id !== s.lastWho).map(p => p.id);
      const who = ids[(s.ti * 7) % Math.max(1, ids.length)];
      const card = s.hands?.[me]?.[0];
      if (who && card) await send(ph, "ask", { who, id: card });
    });
    if (s.phase === "talk" && t?.who === me && !t.status) return once(`answer-${s.ti}`, () => send(ph, s.ti % 3 === 2 ? "pass" : "answer"));
    if (s.phase === "talk" && t?.who === me && t.status === "answering") return once(`done-${s.ti}`, async () => { await sleep(800); await send(ph, "done"); });
    if (s.phase === "talk" && t?.who !== me && t?.asker !== me && t?.status === "answering") return once(`same-${s.ti}`, () => send(ph, "same"));
  },
  async ritual(ph, s, { me, once, ctx }) {
    const r = s.turn;
    if (s.phase !== "act" || !r || r.won) return;
    if (r.performer === me) {
      // the performer's phone knows its prompt: it tells the runner, which has someone guess it, then taps the right guess
      const known = await ph.r(R => R.knownPrompt()).catch(() => null);
      if (known) ctx.prompt[s.ti] = known;
      const g = known && (r.guesses ?? []).find(g => String(g.text).trim().toLowerCase() === known.trim().toLowerCase());
      if (g) return once(`pick-${s.ti}`, () => send(ph, "pick", { gid: g.gid }));
      return;
    }
    // a bot performing (2 players + a bot): only the host's phone dealt its prompt
    if (!ctx.prompt[s.ti] && s.players?.[r.performer]?.isBot && ctx.host) {
      const k = await ctx.host.r(R => R.knownPrompt()).catch(() => null);
      if (k) ctx.prompt[s.ti] = k;
    }
    const known = ctx.prompt[s.ti];
    if (!known) return once(`noise-${s.ti}`, () => send(ph, "guess", { text: "a confused penguin" }));
    // the first guesser in join order guesses it right
    const first = ctx.order.find(p => p.id !== r.performer && !p.dropped && s.players[p.id] && !s.players[p.id].gone);
    if (first === ph) return once(`guess-${s.ti}`, () => send(ph, "guess", { text: known }));
  },
  async secretdiary(ph, s, { me, isHost, once }) {
    if (s.phase === "deal" && isHost) return once("send", async () => { await sleep(500); await send(ph, "send"); });
    if (s.phase === "answer" && s.players?.[me] && !s.players[me].done) return once(`ans-${s.batch?.map(c => c.id).join(",")}`, async () => {
      for (const [k, c] of (s.batch ?? []).entries()) await send(ph, "ans", c.type === "written" ? { k, text: `mp test answer ${k}` } : { k, yn: (k + ph.name.length) % 2 ? "yes" : "no" });
      await sleep(300);
      await send(ph, "submit");
    });
    if (s.phase === "reveal" && s.players?.[me] && !s.players[me].locked) return once(`lock-${s.qi}`, async () => {
      const q = s.qs?.[s.qi], c = s.batch?.[s.qi];
      const other = (q?.cands ?? []).find(x => x !== me);
      if (c?.type === "written" && q?.entries?.length && other) await send(ph, "guess", { eid: q.entries[0].eid, who: other });
      if (c?.type === "yesno" && other) await send(ph, "pick", { who: other, on: true });
      await sleep(200);
      await send(ph, "lock");
    });
  },
  async artgallery(ph, s, { me, once, ctx }) {
    const p = s.players?.[me];
    if (s.phase === "photos" && p && (p.photos?.length ?? 0) < 3) return once("photos", async () => {
      // three photos, picked at once from the phone's library (the real file input)
      await ph.page.setInputFiles("#ag-file", ctx.photoFiles.slice(0, 3)).catch(async e => { ctx.log?.(`${ph.name}: no file input (${e.message.split("\n")[0]}), sending ids`); for (let i = 0; i < 3; i++) await send(ph, "photo", { pid: `${me}-mp-${i}` }); });
    });
    if (s.phase === "title" && p) for (const pid of p.assigned ?? []) if (!p.titles?.[pid]) await once(`title-${pid}`, () => send(ph, "title", { pid, text: `mp title ${ph.name}` }));
    if (s.phase === "gallery" && s.sub === "reveal") {
      const f = s.frames?.[s.fi];
      if (f && !f.titles?.some(x => x.by === me) && f.votes?.[me] === undefined) return once(`vote-${s.fi}`, () => send(ph, "vote", { idx: (s.fi + ph.name.length) % Math.max(1, f.titles?.length ?? 1) }));
    }
  },
  // Manhunt on the streets: the host's phone draws a zone round itself at setup;
  // no head start, the shortest round (the host's ?mhfast=30: a minute lasts 2 s);
  // everyone in the zone the whole time (their GPS doesn't move), so the runners survive
  async manhunt(ph, s, { isHost, once }) {
    if (s.phase === "setup" && isHost && s.setup?.zone) return once(`go-${Math.floor(Date.now() / 15000)}`, async () => {   // (again if it said no: S.err)
      await send(ph, "mh-set", { k: "head", v: 0 });
      await send(ph, "mh-set", { k: "round", v: 10 });
      await sleep(600);
      await send(ph, "mh-go");
    });
    if (s.phase === "rules" && !s.players?.[ph.id]?.ready) return once("ready", () => send(ph, "mh-ready"));
  },
};

// who the game's "subject" is this turn (the one picked / performing / asking)
const subject = (game, s) => ({ sidequest: s.turn?.who, mask_off: s.turn?.asker, ritual: s.turn?.performer })[game] ?? null;

// play one game to its end; returns what was seen (for the checks)
export async function playGame(game, phones, { log, ctx = {}, maxMs = 12 * 60000, onTick = null } = {}) {
  const live = () => phones.filter(p => !p.dropped && !p.closed);
  const hostOf = async () => { for (const ph of live()) if (await ph.r(R => R.party()?.isHost).catch(() => false)) return ph; return live()[0]; };
  let host = await hostOf();
  await startGame(host, game);
  const C = { did: {}, prompt: {}, order: phones, log, ...ctx };
  const seen = { phases: [], subjects: [], turns: 0, scores: null, errors: [], ended: false, endedEverywhere: false, setupWaitOk: null, syncLag: [], skipped: [] };
  const started = await host.until((R, g) => R.party()?.launched && R.party()?.playing === g, game, 30000);
  if (!started) throw new Fail(`${TITLES[game]} didn't start (${await host.page.evaluate(() => document.getElementById("pv-err")?.textContent || document.getElementById("pt-err")?.textContent || "no error shown").catch(() => "?")})`);
  log(`${TITLES[game]} started`);
  const t0 = Date.now();
  let last = null, lastSubjKey = null;
  while (Date.now() - t0 < maxMs) {
    const hs = await actAll(game, phones, host, C);
    if (hs) {
      const key = `${hs.phase}:${hs.ti ?? ""}`;
      if (key !== last) { last = key; seen.phases.push(key); log(`  ${TITLES[game]}: ${key}${hs.turn ? ` (${JSON.stringify(subject(game, hs) ?? "")})` : ""}`); }
      const subj = subject(game, hs);
      const sk = `${hs.ti}:${subj}`;
      if (subj && sk !== lastSubjKey) { lastSubjKey = sk; seen.subjects.push(subj); }
      if (hs.turn?.skipped) seen.skipped.push(hs.ti);
      seen.scores = Object.fromEntries(Object.values(hs.players ?? {}).map(p => [p.id, p.score ?? 0]));
      seen.last = hs;
      if (onTick) await onTick(hs, host);
    }
    // the game is over on the host: back in the lobby (launched cleared)
    const out = await host.r(R => !R.party()?.launched).catch(() => false);
    if (out) { seen.ended = true; break; }
    // the host left / dropped: whoever is host now
    if (host.dropped || host.closed) host = await hostOf();
    else if (!(await host.r(R => R.party()?.isHost).catch(() => true))) host = await hostOf();
    await sleep(600);
  }
  seen.ms = Date.now() - t0;
  seen.turns = new Set(seen.phases.map(k => k.split(":")[1]).filter(Boolean)).size;
  // every phone left in the party is back in the lobby, with the same set
  const back = await Promise.all(live().map(ph => ph.until(R => { const p = R.party(); return p && !p.launched && R.screen().lobby; }, null, 40000)));
  seen.endedEverywhere = back.every(Boolean);
  seen.notBack = live().filter((_, i) => !back[i]).map(p => p.name);
  seen.sets = await Promise.all(live().map(ph => ph.r(R => R.party()?.set).catch(() => null)));
  seen.errors = (await Promise.all(live().map(ph => ph.r(R => R.game()?.errors ?? []).catch(() => [])))).flat();
  return seen;
}

// the set's podium after 3 games: the host starts a new set
export async function nextSetIfDone(H, log) {
  const p = await H.r(R => R.party());
  if (!p?.set?.done) return false;
  const up = await H.until(() => !!document.getElementById("pp-again"), null, 20000);
  if (!up) throw new Fail("the set is done but the host has no 'new set' on the podium");
  await sleep(1200);
  await H.tap("#pp-again");
  log("podium -> new set");
  await H.until(R => !R.party()?.set?.done, null, 10000);
  await sleep(1000);
  return true;
}

// a few small JPEGs for the Art Gallery (made in a page, written to disk)
export async function makePhotos(ph, dir) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dir, { recursive: true });
  const bufs = await ph.page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const c = Object.assign(document.createElement("canvas"), { width: 480, height: 360 }), g = c.getContext("2d");
      g.fillStyle = ["#1d2b64", "#7a2e5b", "#2e7a4f"][i]; g.fillRect(0, 0, 480, 360);
      g.fillStyle = "#ffd36b"; g.font = "bold 48px sans-serif"; g.fillText(`mp test ${i + 1}`, 60, 190);
      const b = await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));
      out.push(Array.from(new Uint8Array(await b.arrayBuffer())));
    }
    return out;
  });
  const files = [];
  for (const [i, b] of bufs.entries()) { const f = join(dir, `photo${i + 1}.jpg`); await writeFile(f, Buffer.from(b)); files.push(f); }
  return files;
}
