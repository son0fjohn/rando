// Test hooks for the multiplayer suite (test/mp/): window.__rando, a small
// read-mostly window onto the app's own state, so tests can find players on
// a canvas map, tap NPCs and read party / game state reliably.
//
// Loaded by index.html ONLY when the page carries the test flag (?e2e=1, or
// window.__RANDO_E2E set by the test harness before load) AND the host is
// not production. It checks the host again here, so a stray flag on
// randoirl.vercel.app does nothing. It sends nothing anywhere on its own and
// adds no UI: every action goes through what a player could tap, or the same
// call the app's own button makes.
import { world3d, ARCH_NPC_DEFS, CHAR_H } from "./world3d.js";
import { presence, pubchat, sb } from "./backend.js";
import { party } from "./party.js";
import { rooms } from "./rooms.js";

const PROD_HOSTS = ["randoirl.vercel.app"];

if (!PROD_HOSTS.includes(location.hostname) && !window.__rando) {
  const $ = s => document.querySelector(s);
  const vis = el => !!el && !el.hidden && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  // a 3D point -> the page's pixels (null off screen / behind the camera)
  const toScreen = v => {
    const r = world3d.renderer?.domElement?.getBoundingClientRect();
    if (!r || !world3d.camera) return null;
    const p = v.clone().project(world3d.camera);
    if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
    return { x: Math.round(r.left + (p.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - p.y) / 2 * r.height) };
  };
  const lookAt = (lat, lng, dist = 120) => {
    const g = world3d.geo(lat, lng);
    world3d.observing = true; world3d.target.set(g.x, g.y, g.z);
    world3d.camGoal = { ...world3d.cam, dist, elev: 0.8 }; world3d.applyCamera?.(); world3d.needsRender = true;
  };

  window.__rando = {
    version: 1,
    // who this phone is
    me: () => ({ id: rooms.me?.id ?? null, handle: rooms.me?.handle ?? null }),
    signedIn: () => !document.getElementById("auth-status")?.hidden && !!rooms.me?.id,
    // which screen is up: the start screen / setup card, the map, the party room, a game
    screen() {
      const onb = $(".onb-screen:not(.out)")?.dataset.screen ?? null;
      const panel = document.getElementById("party-panel");
      return {
        onboarding: onb, setup: !!$(".st-panel [data-setup]"),
        map: vis(document.getElementById("navbar")) && !onb && (!panel || panel.hidden) && !!document.getElementById("game-layer")?.hidden,
        lobby: !!panel && !panel.hidden && !!$("#pt-floor"),
        game: !document.getElementById("game-layer")?.hidden,
        sheets: [...document.querySelectorAll(".onb-sheet:not(.out)")].map(e => e.dataset.sheet),
      };
    },

    // ---- the map: who's visible where (zone-level positions only: that is all the app has)
    world: {
      visible: () => (presence.myZone ? { zone: presence.myZone.id, name: presence.myZone.name, lat: presence.myZone.lat, lng: presence.myZone.lng } : null),
      remotes: () => (world3d._lastRemotes ?? []).map(r => ({ userId: r.userId, handle: r.handle, lat: r.lat, lng: r.lng, slot: r.slot })),
      zones: () => presence.zones.map(z => ({ id: z.id, name: z.name, lat: z.lat, lng: z.lng, kind: z.kind })),
      refresh: () => presence.refreshWorld(),
      // the bar's left button, as a player taps it (visible <-> hidden)
      toggle: () => { const b = document.getElementById("nav-explore"); b?.click(); return !!b; },
      // a remote character on screen (for a real tap: opens their DM)
      charScreen(userId) {
        const rec = world3d.remoteRecs?.find(x => x.meta?.userId === userId);
        if (!rec) return null;
        const p = rec.api.group.position.clone(); p.y += CHAR_H / 2;
        return toScreen(p);
      },
      lookAt,
    },

    // ---- the three mascot NPCs: where they are on screen, and a tap on one
    npcs() {
      return ARCH_NPC_DEFS.map(d => {
        const rec = world3d.archRecs?.[d.id];
        const p = rec ? rec.api.group.position.clone() : null;
        if (p) p.y += CHAR_H / 2;
        return { id: d.id, name: d.name, lat: d.lat, lng: d.lng, loaded: !!rec, active: !!rec?.api?.active, screen: p ? toScreen(p) : null };
      });
    },
    // bring an NPC on screen; returns its screen point for the test to tap (a real pointer tap)
    focusNpc(id) { const d = ARCH_NPC_DEFS.find(n => n.id === id); if (!d) return false; lookAt(d.lat, d.lng, 90); return true; },
    npcDialog: () => { const el = document.getElementById("npc-dlg"); return vis(el) ? el.textContent.trim() : null; },

    // ---- world chat: the feed's lines, and a send through the real form
    chat: {
      lines: () => [...document.querySelectorAll("#pubchat-feed .pub-line, [data-chat-line]")].map(l => ({ who: l.querySelector("b")?.textContent ?? null, text: l.textContent.replace(l.querySelector("b")?.textContent ?? "", "").trim(), sys: l.classList.contains("sys") })),
      async send(text) {
        const open = document.getElementById("pubchat-open"), form = document.getElementById("pubchat-form"), input = document.getElementById("pubchat-input");
        if (!form || !input) return false;
        if (form.hidden) open?.click();
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
        return true;
      },
      subscribed: () => !!pubchat.channel,
    },

    // ---- the party: who's in, the lobby's room, the set
    party() {
      const c = party.current;
      if (!c) return null;
      return {
        code: c.meta.code, name: c.meta.name, isHost: c.room.isHost, hostId: c.room.hostId, me: party.me?.id,
        members: c.room.members.map(m => ({ id: m.id, handle: m.handle })),
        inRoom: [...document.querySelectorAll("#pt-floor .lr-av")].map(e => e.dataset.id),
        launched: !!c.launched, playing: c.playingId ?? null, setupWait: !!c.setupWait,
        set: { no: c.set?.no, done: !!c.set?.done, games: (c.set?.games ?? []).map(g => ({ game: g.game ?? g.id, completed: !!(g.completed ?? g.results?.completed) })) },
        podium: !!document.getElementById("pp-again") || !!$(".pp-wrap"),
      };
    },
    // the host's controls on screen right now (what a host could tap)
    hostControls() {
      const ids = ["hp-end", "hp-skip", "hp-back", "hp-pause", "hp-resume", "pp-again", "pp-end", "pt-vote"];
      const out = ids.filter(id => vis(document.getElementById(id)));
      for (const el of document.querySelectorAll("[data-testid^='host-']")) if (vis(el)) out.push(el.dataset.testid);
      return out;
    },

    // ---- the game this phone is in: its synced state, and an input as the game's own buttons send it
    game() {
      const g = window.__game;
      if (!g?.s) return null;
      const s = g.s;
      return {
        hosting: !!g.hosting, phase: s.phase, left: s.left, ti: s.ti ?? null, turns: s.turns ?? null,
        paused: !!(s.paused ?? s.pause), turn: clone(s.turn ?? null),
        scores: Object.fromEntries(Object.values(s.players ?? {}).map(p => [p.id, p.score ?? 0])),
        players: Object.values(s.players ?? {}).map(p => ({ id: p.id, handle: p.handle, bot: !!p.isBot, gone: !!p.gone, score: p.score ?? 0 })),
        errors: (g.errs ?? []).map(e => `${e.where}: ${String(e.msg).split("\n")[0]}`),
      };
    },
    gameState: () => clone(window.__game?.s ?? null),
    input(type, payload = {}) { const g = window.__game; if (!g?.running) return false; g.input(type, payload); return true; },
    knownPrompt: () => window.__game?.knownPrompt?.() ?? null,

    // ---- notes on the map: the markers in view (no one's position but the notes'), and cleanup
    notes: {
      async mod() { return (await import("./notes.js")).notes; },
      async markers() { return (await this.mod()).markers; },
      async refresh() { return (await this.mod()).refresh(); },
      async step() { return (await this.mod()).step; },
      // the note's pin on screen (for a real tap)
      pin(id) { const el = document.querySelector(`.note-pin[data-id="${CSS.escape(String(id))}"]`); if (!vis(el)) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
      card: () => { const el = $(".note-card, .nc-card, [data-note-card]"); return vis(el) ? el.textContent.trim() : null; },
      // the author removing their own notes (remove_my_note: author-only, server-side)
      async removeMine() {
        const mine = (await this.markers()).filter(m => m.mine);
        for (const m of mine) await sb.rpc("remove_my_note", { p_id: m.id });
        return mine.length;
      },
    },
    lookAt,
    // the map stops / starts drawing (software GL: a test machine running many phones
    // keeps only the one it is looking at drawing; the app's state runs on either way)
    draw(on) { world3d.setPaused(!on); return !world3d.paused; },
  };
  window.dispatchEvent(new Event("rando:e2e"));
}
