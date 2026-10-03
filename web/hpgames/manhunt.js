// Manhunt (4 for testing, 5+ properly) — house party game 5.
//
// Hunters chase runners around a fixed outdoor play area. Runners know where
// the bombs are and have to defuse all of them; hunters don't know the sites
// and have to tag everyone before the clock runs out.
//
// LOCATION PRIVACY — the point of the design, not a nicety:
//   * Every phone reads its OWN GPS and never sends a coordinate anywhere.
//   * It converts its position into a COARSE GRID CELL on-device (CELL_M,
//     default 80 m) and sends only the two cell integers.
//   * The host aggregates cells into one anonymous radar snapshot, refreshed
//     once a minute. The snapshot carries cells, never player identity.
//   * Per-player cells are held in a host-side Map that is NOT part of the
//     game state, so they are not in the broadcast snapshot. Honest caveat:
//     an `input` message carrying a cell is itself a channel broadcast, so a
//     determined member could read cells off the wire. Coordinates, which is
//     what actually matters, never leave the device at all.
//   * Nothing is written to a database, ever. Cells live in memory and are
//     wiped when the game ends (see the trash registration below).
//
// Screen Wake Lock keeps the screen on while you're playing outdoors.
import { HostGame, ui } from "./../gamekit.js";
import { sfx, buzz } from "./../fx.js";
import { MANHUNT } from "./../hpconfig.js";
import { presence } from "./../backend.js";
import { Rounds, syncGone, active, esc, shuffle, showResults, hostSkip, bindHostSkip, trash, avatarHtml } from "./../hpkit.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ASSET = "games/manhunt/";
const LOBBY_MS = 12000, END_MS = 30000;
const GRID = 9;                  // radar is GRID x GRID cells, centred on the hunter
// dev: ?mhsim=1 fakes GPS by walking a point around the boundary, so the whole
// game can be driven at a desk with no location permission
const SIM = params.get("mhsim") === "1";

// metres-per-degree at a latitude, good enough for an 800 m play area
const mPerDegLat = () => 111320;
const mPerDegLng = lat => 111320 * Math.cos(lat * Math.PI / 180);

// on-device: position -> coarse cell, relative to the boundary centre
function toCell(lat, lng) {
  const c = MANHUNT.BOUNDARY;
  const dx = (lng - c.lng) * mPerDegLng(c.lat);
  const dy = (lat - c.lat) * mPerDegLat();
  return { cx: Math.floor(dx / MANHUNT.CELL_M), cy: Math.floor(dy / MANHUNT.CELL_M) };
}
const cellKey = c => `${c.cx},${c.cy}`;

export const MANHUNT_GAME = {
  id: "manhunt", title: "Manhunt",
  blurb: "hunters chase, runners defuse. coarse radar, 15 minutes, one fixed play area.",
  minPlayers: 4, maxPlayers: 12, length: "~15 min",

  start(ctx) {
    ui.show(); ui.theme("sporty");
    const room = ctx.room;

    // ---- host-side only: per-player cell. Never enters the game state. ----
    const cells = new Map();          // playerId -> { cx, cy, at }
    // ---- device-local: my own precise position. Never sent. ----
    let myPos = null, myCell = null, geoWatch = null, wakeLock = null, lastHud = 0, simT = 0;
    let myInZone = null, confirmShown = false;

    trash.add(() => {
      cells.clear();
      myPos = null; myCell = null; myInZone = null;
      stopGeo(); releaseWake();
    });

    // ---------------------------------------------------------------- geo
    function startGeo() {
      if (SIM) {
        // walk a fake point in a slow circle through the play area
        simT = 0;
        geoWatch = setInterval(() => {
          simT += 0.06;
          const c = MANHUNT.BOUNDARY;
          const r = c.radius_m * 0.6;
          const lat = c.lat + (r * Math.sin(simT)) / mPerDegLat();
          const lng = c.lng + (r * Math.cos(simT * 0.7)) / mPerDegLng(c.lat);
          onPos({ lat, lng, acc: 5 });
        }, 1000);
        return;
      }
      if (!navigator.geolocation) return;
      geoWatch = navigator.geolocation.watchPosition(
        p => onPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        e => console.warn("[manhunt] geo", e.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    }
    function stopGeo() {
      if (geoWatch === null) return;
      if (SIM) clearInterval(geoWatch);
      else navigator.geolocation?.clearWatch(geoWatch);
      geoWatch = null;
    }
    // the ONLY thing this ever sends is the cell pair
    function onPos(p) {
      myPos = p;
      const c = toCell(p.lat, p.lng);
      if (!myCell || c.cx !== myCell.cx || c.cy !== myCell.cy) {
        myCell = c;
        game.input("cell", { cx: c.cx, cy: c.cy });
      }
      // zone membership is judged on-device too: we only tell the host WHICH
      // site we're standing in, never where we are
      const site = MANHUNT.SITES.find(s => presence.haversine(p.lat, p.lng, s.lat, s.lng) <= s.radius_m);
      const id = site?.id ?? null;
      if (id !== myInZone) { myInZone = id; game.input("zone", { site: id }); }
      else if (id) game.input("zone", { site: id });        // keep-alive while standing still
    }
    async function requestWake() {
      try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); }
      catch (e) { console.warn("[manhunt] wake lock", e.message); }
    }
    function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }
    // a wake lock is dropped whenever the tab is backgrounded, so re-take it
    // on return. Removed on game end so it doesn't outlive the round.
    const onVis = () => { if (document.visibilityState === "visible" && !wakeLock && game.running) requestWake(); };
    document.addEventListener("visibilitychange", onVis);

    const me = s => s.players?.[ctx.me.id] ?? null;
    const liveRunners = s => active(s).filter(p => p.role === "runner" && !p.tagged);
    const bombsLeft = s => (s.sites ?? []).filter(x => !x.defused).length;

    const rounds = new Rounds([
      // head start: runners move, hunters are held in place
      { name: "headstart", ms: MANHUNT.HEADSTART_MS, next: () => "hunt" },
      { name: "hunt", ms: MANHUNT.GAME_MS, next: s => { decide(s, bombsLeft(s) ? "hunters" : "runners", bombsLeft(s) ? "the clock ran out with a bomb still live" : "every bomb defused"); return "end"; } },
      { name: "end", ms: END_MS, next: () => null },
    ], {
      onPhase: name => {
        ui.resetKey();
        if (name === "headstart") { sfx.open(); buzz([40, 60, 40]); }
        if (name === "hunt") { sfx.ping(); buzz([80, 40, 80]); }
        if (name === "end") sfx.win();
      },
    });

    const game = new HostGame(ctx, {
      hostInit(s) {
        const ids = shuffle(game.rng, ctx.humans.map(h => h.id));
        // ~1 hunter per 4-5 players, at least one
        const nH = Math.max(1, Math.round(ids.length / MANHUNT.HUNTER_RATIO));
        s.players = {};
        ctx.humans.forEach(h => {
          s.players[h.id] = {
            id: h.id, handle: h.handle, isBot: false, gone: false, score: 0,
            role: ids.indexOf(h.id) < nH ? "hunter" : "runner",
            tagged: false, defused: 0,
          };
        });
        s.sites = MANHUNT.SITES.map(x => ({ id: x.id, label: x.label, defused: false, progress: 0, by: null }));
        s.radar = { cells: [], pings: [], at: 0 };
        s.pending = null;         // { by, target, until } — a tag awaiting confirmation
        s.winner = null; s.why = null; s.nH = nH;
        rounds.enter(s, "headstart");
      },
      hostTick(s, dt) {
        syncGone(s, room);

        // ---- radar: republish an aggregated snapshot once a minute ----
        const now = Date.now();
        if (now - (s.radar.at || 0) > MANHUNT.RADAR_MS) {
          const live = new Set(liveRunners(s).map(p => p.id));
          const seen = new Map();
          for (const [id, c] of cells) {
            if (!live.has(id)) continue;
            if (now - c.at > MANHUNT.RADAR_MS * 2) continue;          // stale
            seen.set(cellKey(c), { cx: c.cx, cy: c.cy });             // dedupe: no identity, no count
          }
          s.radar = { cells: [...seen.values()], pings: s.radar.pings.filter(p => now - p.at < MANHUNT.RADAR_MS * 2), at: now };
        }

        // ---- defusing: progress while the runner reports standing in a zone ----
        if (s.phase === "hunt") {
          for (const p of Object.values(s.players)) {
            const site = s.sites.find(x => x.id === p.inZone);
            const ok = site && !site.defused && p.role === "runner" && !p.tagged && !p.gone;
            if (!ok) { if (p.defusingSite) { const st = s.sites.find(x => x.id === p.defusingSite); if (st && !st.defused) st.progress = 0; p.defusingSite = null; } continue; }
            // a zone report older than 6 s means they stopped reporting: stall
            if (now - (p.zoneAt || 0) > 6000) { site.progress = 0; p.defusingSite = null; continue; }
            p.defusingSite = site.id;
            site.progress = Math.min(1, site.progress + (dt * 1000) / MANHUNT.DEFUSE_MS);
            if (site.progress >= 1) {
              site.defused = true; site.by = p.id; p.defused++; p.score += 100;
              // defusing pings the SITE's cell to the hunters — the cost of
              // doing it. Still a cell, still no identity.
              const c = toCell(MANHUNT.SITES.find(x => x.id === site.id).lat, MANHUNT.SITES.find(x => x.id === site.id).lng);
              s.radar.pings = [...(s.radar.pings ?? []), { cx: c.cx, cy: c.cy, at: now }].slice(-6);
              game.emit("defused", { site: site.id, by: p.id });
            }
          }
        }

        // ---- tag confirmations expire ----
        if (s.pending && now > s.pending.until) s.pending = null;

        // ---- win checks ----
        if (s.phase === "hunt") {
          if (!bombsLeft(s)) { decide(s, "runners", "every bomb defused"); rounds.enter(s, "end"); return; }
          if (!liveRunners(s).length) { decide(s, "hunters", "every runner tagged"); rounds.enter(s, "end"); return; }
        }

        rounds.hostStep(s, dt);
        if (s.phase === "end" && s.left <= 0) game.finish();
      },
      hostInput(s, m) {
        if (m.in === "skip" && m.from === room.hostId) { s.left = 0; return; }
        const p = s.players[m.from];
        if (!p) return;
        // a cell NEVER goes into the state — host-side map only
        if (m.in === "cell" && Number.isInteger(m.cx) && Number.isInteger(m.cy))
          cells.set(p.id, { cx: m.cx, cy: m.cy, at: Date.now() });
        if (m.in === "zone") { p.inZone = m.site ?? null; p.zoneAt = Date.now(); }
        // hunter nominates a runner they believe they tagged
        if (m.in === "tag" && s.phase === "hunt" && p.role === "hunter") {
          const t = s.players[m.target];
          if (t && t.role === "runner" && !t.tagged && !s.pending)
            s.pending = { by: p.id, target: t.id, until: Date.now() + MANHUNT.TAG_CONFIRM_MS };
        }
        // the runner answers "were you tagged?" — their call, nobody else's
        if (m.in === "tagack" && s.pending && s.pending.target === p.id) {
          if (m.yes) {
            p.tagged = true; p.role = "hunter";
            const by = s.players[s.pending.by];
            if (by) by.score += 100;
            game.emit("tagged", { who: p.id, by: s.pending.by });
          } else game.emit("denied", { who: p.id });
          s.pending = null;
        }
      },
      render(s) { renderMH(s); },
      onEvent(m) {
        ui.resetKey();
        if (m.ev === "tagged") { sfx.rip(); buzz([120, 60, 120]); ui.toast("a runner was tagged — they're a hunter now", "rip"); }
        if (m.ev === "denied") { sfx.tick(); ui.toast("they say no — keep going"); }
        if (m.ev === "defused") { sfx.chime(); buzz(80); ui.toast("a bomb went down — hunters got a ping", "dodge"); }
      },
    }, { hz: 2 });   // slow tick: this is a 15-minute outdoor game, save the battery

    function decide(s, winner, why) {
      if (s.winner) return;
      s.winner = winner; s.why = why;
      // survivors and defusers get a closing bonus so the scoreboard reads
      for (const p of Object.values(s.players)) {
        if (winner === "runners" && p.role === "runner" && !p.tagged) p.score += 150;
        if (winner === "hunters" && p.role === "hunter") p.score += 100;
      }
    }

    // ---------------------------------------------------------------- render
    function renderMH(s) {
      const now = performance.now(); if (now - lastHud < 200) return; lastHud = now;
      const m = me(s);
      const P = Object.values(s.players || {});
      const amHunter = m?.role === "hunter";
      const left = bombsLeft(s);
      ui.hud(`<div class="hq"><b>MANHUNT</b><span>${amHunter ? "hunter" : "runner"}</span><span class="clk ${s.left < 60000 && s.phase === "hunt" ? "urgent" : ""}">${ui.clock(s.left)}</span><span>${left} bomb${left === 1 ? "" : "s"} live</span></div>`);

      // "were you tagged?" — takes over the screen for the targeted runner
      if (s.pending?.target === ctx.me.id) {
        if (!ui.once(`ack:${s.pending.until}`, () => {})) return;
        const by = s.players[s.pending.by]?.handle ?? "a hunter";
        if (!confirmShown) { confirmShown = true; sfx.rip(); buzz([200, 80, 200]); }
        ui.stage("were you tagged?", `<p class="ab-sub">${esc(by)} says they got you. your call — honour system.</p>
          <div class="mh-tagged">
            <button type="button" class="yes" data-ack="1">yes, they got me</button>
            <button type="button" data-ack="0">no</button>
          </div>`, "confirm");
        $("game-panel").querySelectorAll("[data-ack]").forEach(b => b.onclick = () => {
          game.input("tagack", { yes: b.dataset.ack === "1" });
          confirmShown = false; sfx.pop(); ui.resetKey();
        });
        return;
      }
      confirmShown = false;

      const warn = MANHUNT.PLACEHOLDER_GEO
        ? `<div class="mh-warn"><b>Demo coordinates.</b> The play area and bomb sites in <code>hpconfig.js</code> are placeholders — do not play on them. Drop in vetted public off-road spots first.${SIM ? " Simulated GPS is on (<code>?mhsim=1</code>)." : ""}</div>`
        : "";
      const boundary = () => {
        if (!myPos) return `<p class="ab-sub">waiting for your location…${SIM ? " (simulated)" : ""}</p>`;
        const d = presence.haversine(myPos.lat, myPos.lng, MANHUNT.BOUNDARY.lat, MANHUNT.BOUNDARY.lng);
        const out = d > MANHUNT.BOUNDARY.radius_m;
        return `<p class="ab-sub">${out ? `⚠ you're ${Math.round(d - MANHUNT.BOUNDARY.radius_m)} m OUTSIDE the play area — head back` : `inside the play area · ${Math.round(MANHUNT.BOUNDARY.radius_m - d)} m of room`}</p>`;
      };

      if (s.phase === "headstart") {
        if (!ui.once(`hs:${amHunter ? 1 : 0}`, () => {})) return;
        ui.stage(amHunter ? "hold position" : "run. now.",
          `<div class="mh-role ${amHunter ? "hunter" : "runner"}"><b>${amHunter ? "HUNTER" : "RUNNER"}</b>
            <span>${amHunter ? `${s.nH} hunter${s.nH === 1 ? "" : "s"} · you're released when the clock hits zero` : `defuse all ${s.sites.length} bombs before the 15 minutes are up`}</span></div>
          ${amHunter ? `<p class="ab-sub">you do NOT get to see the bomb sites. watch the radar.</p>` : siteList(s)}
          ${boundary()}${warn}${hostSkip(ctx, "host: start the hunt")}`,
          `head start · ${ui.clock(s.left)}`);
        bindHostSkip(game);

      } else if (s.phase === "hunt") {
        if (amHunter) renderHunter(s);
        else renderRunner(s);

      } else if (s.phase === "end") {
        if (!ui.once("end", () => {})) return;
        const head = s.winner === "runners" ? "runners win" : "hunters win";
        showResults(P, { title: head, sub: s.why ?? "", note: `${s.sites.filter(x => x.defused).length}/${s.sites.length} bombs defused · no location data was stored` },
          `<p class="ab-sub">back to the party in a moment</p>${hostSkip(ctx)}`);
        bindHostSkip(game);
      }
    }

    // runners see the sites; hunters never get this
    function siteList(s) {
      return `<div class="mh-sites">${s.sites.map(x => {
        const inZone = myInZone === x.id;
        const cls = x.defused ? "done" : inZone ? "in" : "";
        const pct = Math.round((x.progress ?? 0) * 100);
        const dist = myPos ? Math.round(presence.haversine(myPos.lat, myPos.lng, MANHUNT.SITES.find(y => y.id === x.id).lat, MANHUNT.SITES.find(y => y.id === x.id).lng)) : null;
        return `<div class="mh-site ${cls}">
          <img class="mh-bomb" src="${ASSET}bomb.png" alt="">
          <span class="mh-site-main"><b>${esc(x.label)}</b>
            <small>${x.defused ? "defused" : inZone ? `defusing — stand still (${pct}%)` : dist === null ? "locating…" : `${dist} m away`}</small>
            ${x.defused ? "" : ui.bar(x.progress ?? 0, "plant")}</span>
        </div>`;
      }).join("")}</div>`;
    }

    function renderRunner(s) {
      const inZone = myInZone;
      const site = s.sites.find(x => x.id === inZone);
      const key = `run:${s.sites.map(x => `${x.defused ? 1 : 0}${Math.round((x.progress ?? 0) * 20)}`).join("")}:${inZone ?? "-"}:${myPos ? 1 : 0}`;
      if (!ui.once(key, () => {})) return;
      ui.stage(site && !site.defused ? "defusing — don't move" : "stay out of sight",
        `<div class="mh-role runner"><b>RUNNER</b><span>${bombsLeft(s)} bomb${bombsLeft(s) === 1 ? "" : "s"} left · defusing pings the hunters</span></div>
        ${siteList(s)}
        <p class="ab-sub">stand in a zone for ${Math.round(MANHUNT.DEFUSE_MS / 1000)} s to defuse it. your exact position never leaves this phone.</p>
        ${roster(s)}${hostSkip(ctx)}`, `running · ${ui.clock(s.left)}`);
      bindHostSkip(game);
    }

    function renderHunter(s) {
      const r = s.radar ?? { cells: [], pings: [] };
      const age = Math.max(0, Math.round((Date.now() - (r.at || Date.now())) / 1000));
      const targets = liveRunners(s);
      const key = `hunt:${r.at}:${targets.map(p => p.id).join(",")}:${s.pending ? 1 : 0}`;
      if (!ui.once(key, () => {})) return;
      ui.stage("radar", radarHtml(r)
        + `<p class="ab-sub">coarse cells only — ${MANHUNT.CELL_M} m each, refreshed every ${Math.round(MANHUNT.RADAR_MS / 1000)} s (last: ${age} s ago). red = a bomb just went down.</p>`
        + (s.pending
          ? `<p class="ab-sub">waiting on ${esc(s.players[s.pending.target]?.handle ?? "a runner")} to confirm…</p>`
          : `<div class="rl-h">tagged someone?</div><div class="mh-roster">${targets.map(p => `<button type="button" class="pt-btn" data-tag="${esc(p.id)}">${avatarHtml(p, { size: 22 })} ${esc(p.handle)}</button>`).join("") || `<div class="pt-empty">no runners left</div>`}</div>`)
        + `${roster(s)}${hostSkip(ctx)}`, `hunting · ${ui.clock(s.left)}`);
      $("game-panel").querySelectorAll("[data-tag]").forEach(b => b.onclick = () => {
        game.input("tag", { target: b.dataset.tag });
        sfx.tick(); ui.resetKey();
      });
      bindHostSkip(game);
    }

    // GRID x GRID cells centred on the viewer's own cell, so the radar is
    // always "around me" without ever showing anyone a coordinate
    function radarHtml(r) {
      const half = (GRID - 1) / 2;
      const c0 = myCell ?? { cx: 0, cy: 0 };
      const hits = new Set((r.cells ?? []).map(cellKey));
      const pings = new Set((r.pings ?? []).map(cellKey));
      let out = "";
      for (let row = 0; row < GRID; row++) {
        for (let col = 0; col < GRID; col++) {
          const cx = c0.cx - half + col, cy = c0.cy + half - row;      // north up
          const k = `${cx},${cy}`;
          const cls = [pings.has(k) ? "site" : hits.has(k) ? "hit" : "", cx === c0.cx && cy === c0.cy ? "me" : ""].filter(Boolean).join(" ");
          out += `<div class="mh-cell ${cls}"></div>`;
        }
      }
      return `<div class="mh-radar" style="background-image:url(${ASSET}radar.jpg)">
        <div class="mh-grid" style="grid-template-columns:repeat(${GRID},1fr);grid-template-rows:repeat(${GRID},1fr)">${out}</div>
        <div class="mh-radar-note">${(r.cells ?? []).length} contact${(r.cells ?? []).length === 1 ? "" : "s"} · ${MANHUNT.CELL_M} m cells · you = yellow</div>
      </div>`;
    }

    function roster(s) {
      return `<div class="mh-roster">${Object.values(s.players).map(p =>
        `<span class="rm ${p.role === "hunter" ? "hunter" : ""} ${p.gone ? "out" : ""}">${esc(p.handle)}${p.tagged ? " ✕" : ""}${p.gone ? " (left)" : ""}</span>`).join("")}</div>`;
    }

    game.start({ phase: "headstart", left: MANHUNT.HEADSTART_MS, players: {}, sites: [], radar: { cells: [], pings: [], at: 0 }, pending: null, winner: null, why: null, nH: 1 });
    startGeo();
    requestWake();
    const o = ctx.onEnd;
    ctx.onEnd = () => {
      game.stop(); stopGeo(); releaseWake(); cells.clear();
      document.removeEventListener("visibilitychange", onVis);
      ui.hide(); o();
    };
  },
};
