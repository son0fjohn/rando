// Rando backend client: Supabase auth (phone OTP), profile, presence.
// Loaded as an ES module by web/index.html.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { world3d, ARCH_NPC_DEFS } from "./world3d.js";
import { lobby } from "./lobby.js";
import { rooms } from "./rooms.js";
import { party } from "./party.js";
import { sfx } from "./fx.js";
import { typeDialog, muteButton } from "./retro.js";
import { mountCharView } from "./charview.js";
import {
  PART_OPTIONS3, DEFAULT_AVATAR3, normalizeAvatar3, avatarThumb3,
  SKIN_RGB, HAIR_RGB, IRIS3_HEX, loadFaceDecals, pieceThumb, STARTER_FITS,
} from "./avatar3.js";
import { drawFace } from "./face3.js";
// avatar v3 humanoid replaces the blob system; keep the old names local so
// the rest of this file reads unchanged
const DEFAULT_AVATAR = DEFAULT_AVATAR3;
const normalizeAvatar = normalizeAvatar3;
const avatarThumb = avatarThumb3;
// thumbs drawn before the face decals finish loading come out faceless and
// nothing re-rendered them — draw now, redraw once decals are in
const setAvatarThumb = (img, avatar) => {
  img.src = avatarThumb(avatar);
  loadFaceDecals().then(() => { img.src = avatarThumb(avatar); });
};

world3d.init(document.querySelector(".frame"));
const bubbleLayer = document.getElementById("bubble-layer");

// ?acct=2 gives this tab its own session storage so two accounts can be
// tested side by side on one machine (dev convenience, no product effect)
const params = new URLSearchParams(location.search);
const acct = params.get("acct");
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: "rando-auth" + (acct ? "-" + acct : "") },
});

// --- auth sheet elements ---
const sheet = document.getElementById("auth-sheet");
const scrim = document.getElementById("auth-scrim");
const stepPhone = document.getElementById("auth-step-phone");
const stepCode = document.getElementById("auth-step-code");
const phoneInput = document.getElementById("auth-phone");
const codeInput = document.getElementById("auth-code");
const sendBtn = document.getElementById("auth-send");
const verifyBtn = document.getElementById("auth-verify");
const errEl = document.getElementById("auth-error");
const statusEl = document.getElementById("auth-status");

let pendingPhone = null;

function setError(msg) {
  errEl.textContent = msg || "";
}

function normalizePhone(raw) {
  return raw.replace(/[\s\-().]/g, "");
}

function showAuth(show) {
  sheet.hidden = !show;
  scrim.hidden = !show;
}

let autoGuestTried = false;
async function refreshStatus() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    // expired/invalidated guest sessions are routine (phone slept, token
    // rotated) — recover silently instead of stranding the player
    if (!autoGuestTried) {
      autoGuestTried = true;
      const { error } = await sb.auth.signInAnonymously();
      if (!error) return; // auth event re-enters refreshStatus signed in
      console.warn("[rando] auto guest sign-in failed:", error.message);
    }
    statusEl.hidden = true;
    showAuth(true);
    presence.onSignedOut();
    return;
  }
  showAuth(false);
  let { data: profile } = await sb
    .from("profiles")
    .select("handle")
    .eq("id", session.user.id)
    .maybeSingle();
  if (!profile) {
    const handle = "rando-" + session.user.id.replace(/-/g, "").slice(0, 6);
    const { data: created } = await sb
      .from("profiles")
      .insert({ id: session.user.id, handle })
      .select("handle")
      .maybeSingle();
    profile = created;
  }
  statusEl.hidden = false;
  statusEl.innerHTML = "";
  statusEl.append("Signed in as " + (profile ? profile.handle : "(no profile)") + " · ");
  const edit = document.createElement("a");
  edit.href = "#";
  edit.textContent = "change name";
  edit.addEventListener("click", e => {
    e.preventDefault();
    nickname.show(profile ? profile.handle : "");
  });
  statusEl.append(edit, " · ");
  const out = document.createElement("a");
  out.href = "#";
  out.textContent = "sign out";
  out.addEventListener("click", async e => {
    e.preventDefault();
    await presence.goClosed().catch(() => {});
    await sb.auth.signOut();
  });
  statusEl.append(out);
  // first run: an auto-generated handle means no nickname was chosen yet
  if (profile && /^rando-[0-9a-f]{6}$/.test(profile.handle) && !nickname.dismissed) {
    nickname.show(profile.handle);
  }
  presence.onSignedIn();
  // demo build: identity for rooms/quests (avatar fills in when it loads)
  // (rooms.init() — the NPC raid lobbies — stays off: raids aren't available)
  rooms.me = { id: session.user.id, handle: profile ? profile.handle : "rando", avatar: rooms.me?.avatar ?? avatar.mine };
  if (!party._inited) {
    party._inited = true;
    // party rooms ask the server-side truth: friends come only from verified
    // meetups; reports go to an insert-only table (migrations/012_reports)
    party.hooks.isFriend = id => friends.list.some(f => f.friend_id === id);
    party.hooks.report = async (id, reason, ctx) => {
      const { error } = await sb.from("reports").insert({ reported: id, reason, context: ctx ?? {} });
      if (error) console.warn("[rando] report failed", error.message);
      return !error;
    };
    // a public party's map beacon sits in the host's ZONE (the same on-device
    // snap presence uses), never at the host's position: parties are often
    // at someone's home
    // coins: the host reports each completed game, every player confirms
    // they played it; the server pays only when both agree (migrations/013)
    party.hooks.coins = {
      reportGame: async ({ session, set, idx, game, results }) => {
        const { places } = await import("./partyset.js");
        const ranking = places(results).map(p => ({ id: p.id, place: p.place }));
        const { data, error } = await sb.rpc("report_game", { p_session: session, p_set: set, p_idx: idx, p_game: game, p_ranking: ranking });
        if (error) throw error;
        return data;
      },
      confirmGame: async ({ session, set, idx }) => {
        const { data, error } = await sb.rpc("confirm_game", { p_session: session, p_set: set, p_idx: idx });
        if (error) throw error;
        return data;
      },
      partyCoins: async ({ session, set }) => {
        const { data, error } = await sb.rpc("my_party_coins", { p_session: session, p_set: set });
        if (error) throw error;
        return data ?? 0;
      },
    };
    party.hooks.beaconZone = async () => {
      const z = presence.myZone ?? await presence.resolveZone();
      return z ? { id: z.id, lat: z.lat, lng: z.lng } : null;
    };
    party.init();
  }
}

// ===================== nickname =====================
const nickScrim = document.getElementById("nick-scrim");
const nickSheet = document.getElementById("nick-sheet");
const nickInput = document.getElementById("nick-input");
const nickSave = document.getElementById("nick-save");
const nickError = document.getElementById("nick-error");

export const nickname = {
  dismissed: false,

  show(current) {
    nickInput.value = /^rando-[0-9a-f]{6}$/.test(current) ? "" : current;
    nickError.textContent = "";
    nickScrim.hidden = false;
    nickSheet.hidden = false;
    nickInput.focus();
  },

  hide() {
    nickScrim.hidden = true;
    nickSheet.hidden = true;
  },

  async save() {
    const name = nickInput.value.trim();
    if (name.length < 2 || name.length > 20) {
      nickError.textContent = "2–20 characters";
      return;
    }
    nickSave.disabled = true;
    const { data: { session } } = await sb.auth.getSession();
    const { error } = await sb.from("profiles")
      .update({ handle: name }).eq("id", session.user.id);
    nickSave.disabled = false;
    if (error) {
      nickError.textContent = /duplicate|unique/i.test(error.message)
        ? "that name's taken — try another"
        : error.message;
      return;
    }
    this.dismissed = true;
    this.hide();
    refreshStatus();
  },
};

nickSave.addEventListener("click", () => nickname.save());
nickInput.addEventListener("keydown", e => { if (e.key === "Enter") nickname.save(); });
document.getElementById("nick-skip").addEventListener("click", e => {
  e.preventDefault();
  nickname.dismissed = true;
  nickname.hide();
});
nickScrim.addEventListener("click", () => { nickname.dismissed = true; nickname.hide(); });

// guest mode (phone verification suspended for the demo): anonymous
// sign-in still creates a real authenticated session, so every RLS
// policy, presence rule, match, and confirm works unchanged
const guestBtn = document.getElementById("auth-guest");
guestBtn.addEventListener("click", async () => {
  setError("");
  guestBtn.disabled = true;
  const { error } = await sb.auth.signInAnonymously();
  guestBtn.disabled = false;
  if (error) setError(error.message);
});

document.getElementById("auth-show-phone").addEventListener("click", e => {
  e.preventDefault();
  document.getElementById("auth-step-phone").hidden = false;
  document.getElementById("auth-step-guest").hidden = true;
  phoneInput.focus();
});

sendBtn.addEventListener("click", async () => {
  setError("");
  const phone = normalizePhone(phoneInput.value);
  if (!/^\+\d{8,15}$/.test(phone)) {
    setError("Enter your number with country code, e.g. +82 10 1234 5678");
    return;
  }
  sendBtn.disabled = true;
  const { error } = await sb.auth.signInWithOtp({ phone });
  sendBtn.disabled = false;
  if (error) {
    setError(error.message);
    return;
  }
  pendingPhone = phone;
  stepPhone.hidden = true;
  stepCode.hidden = false;
  codeInput.focus();
});

verifyBtn.addEventListener("click", async () => {
  setError("");
  const token = codeInput.value.trim();
  if (!/^\d{4,8}$/.test(token)) {
    setError("Enter the code from the text message");
    return;
  }
  verifyBtn.disabled = true;
  const { error } = await sb.auth.verifyOtp({ phone: pendingPhone, token, type: "sms" });
  verifyBtn.disabled = false;
  if (error) {
    setError(error.message);
    return;
  }
  stepCode.hidden = true;
  stepPhone.hidden = false;
  codeInput.value = "";
});

// ===================== presence & world =====================
// Spec model: on-device zone snap (raw GPS never transmitted), one
// presence row per open user, ~15-min world refresh, no history.

const POLL_MS = 15 * 60 * 1000;      // world re-fetch cadence (slow by design)
const HEARTBEAT_MS = 20 * 60 * 1000; // keeps presence row from going stale
const SNAP_MAX_METERS = 3000;        // fixed-zone radius; beyond it -> auto zone
const CELL_DEG = 0.02;               // ~2.2km coarse grid for auto zones

const zoneNameEl = document.getElementById("zone-name");
const zminEl = document.getElementById("zmin");
const navbar = document.getElementById("navbar");
const exploreBtn = document.getElementById("nav-explore");
const backBtn = document.getElementById("nav-backtome");

// on-device coordinate read, shared by zone resolution, encounter
// proximity confirm and house-party joins; ?devlat=&devlng= lets any of
// them be tested without GPS
export async function readDeviceCoords() {
  if (params.get("devlat") && params.get("devlng")) {
    console.warn("[rando] DEV coordinates override active");
    return { lat: Number(params.get("devlat")), lng: Number(params.get("devlng")) };
  }
  const pos = await new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

export const presence = {
  zones: [],
  myZone: null,       // zone row while open, else null
  pollTimer: null,
  heartbeatTimer: null,
  lastFetch: null,

  async loadZones() {
    // errors were silently swallowed before, leaving a permanent empty
    // zones list that broke everything downstream — surface and retry once
    for (let attempt = 0; attempt < 2 && !this.zones.length; attempt++) {
      const { data, error } = await sb.from("zones").select("*");
      if (error) {
        console.warn("[rando] zones fetch failed:", error.message);
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      this.zones = data ?? [];
      world3d.registerZones(this.zones);
    }
  },

  async onSignedIn() {
    try {
      await this.loadZones();
      // restore an existing open session (e.g. page reload while open).
      // session may be null again by now (expired guest token on resume):
      // bail to the signed-out state instead of throwing mid-boot.
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { this.onSignedOut(); return; }
      const { data: mine } = await sb
        .from("presence").select("zone_id").eq("user_id", session.user.id).maybeSingle();
      this.myZone = mine ? this.zones.find(z => z.id === mine.zone_id) ?? null : null;
      this.renderToggle();
      if (!this.myZone) explore.enter();
      this.startPolling();
    } catch (e) {
      console.warn("[rando] sign-in restore failed (world stays browsable):", e);
      this.renderToggle();
      if (!this.myZone) explore.enter();
    }
  },

  onSignedOut() {
    explore.leave();
    clearInterval(this.pollTimer);
    clearInterval(this.heartbeatTimer);
    this.pollTimer = this.heartbeatTimer = null;
    this.myZone = null;
    world3d.setRemotes([]);
    world3d.setPlayer(null);
    this.removeYouTag();
    this.renderToggle();
  },

  haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = d => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  // ON-DEVICE zone snap: coordinates are read locally. Within 3km of a
  // fixed launch zone you snap to it; anywhere else your position is
  // rounded to a ~2.2km grid CELL on-device and only that coarse cell is
  // sent (ensure_auto_zone rejects anything finer than the grid).
  async resolveZone() {
    await this.loadZones();
    if (!this.zones.length) {
      throw new Error("zones unavailable — check connection and retry");
    }
    const dev = params.get("devzone");
    if (dev) {
      const z = this.zones.find(z => z.id === dev);
      if (!z) throw new Error("unknown devzone: " + dev);
      console.warn("[rando] DEV zone override active:", z.name);
      return z;
    }
    const { lat, lng } = await readDeviceCoords();
    let best = null, bestD = Infinity;
    for (const z of this.zones.filter(z => z.kind !== "auto")) {
      const d = this.haversine(lat, lng, z.lat, z.lng);
      if (d < bestD) { best = z; bestD = d; }
    }
    if (best && bestD <= SNAP_MAX_METERS) return best;
    // outside the launch area: coarse grid cell, computed on-device
    const cellLat = Number((Math.round(lat / CELL_DEG) * CELL_DEG).toFixed(6));
    const cellLng = Number((Math.round(lng / CELL_DEG) * CELL_DEG).toFixed(6));
    const { data: zone, error } = await sb.rpc("ensure_auto_zone",
      { p_cell_lat: cellLat, p_cell_lng: cellLng });
    if (error) throw error;
    if (!this.zones.some(z => z.id === zone.id)) this.zones.push(zone);
    return zone;
  },

  async goOpen() {
    const { data: { session } } = await sb.auth.getSession();
    const zone = await this.resolveZone();
    const { error } = await sb.from("presence")
      .upsert({ user_id: session.user.id, zone_id: zone.id });
    if (error) throw error;
    this.myZone = zone;
    explore.leave();
    this.renderToggle();
    this.startPolling();
    await this.refreshWorld();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  },

  // going closed is instant and unconditional (never rate-limited)
  async goClosed() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    await sb.from("presence").delete().eq("user_id", session.user.id);
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const last = this.myZone;
    this.myZone = null;
    this.renderToggle();
    await this.refreshWorld();
    explore.enter(last);
  },

  async heartbeat() {
    if (!this.myZone) return;
    const { data: { session } } = await sb.auth.getSession();
    // live location on the slow cadence: re-resolve the zone each beat
    // (the DB trigger still enforces the 15-min zone-change limit)
    let zone = this.myZone;
    try { zone = await this.resolveZone(); } catch { /* keep current */ }
    const { error } = await sb.from("presence")
      .upsert({ user_id: session.user.id, zone_id: zone.id });
    if (error) {
      // zone change rejected (too soon) — heartbeat the current zone
      await sb.from("presence")
        .upsert({ user_id: session.user.id, zone_id: this.myZone.id });
    } else if (zone.id !== this.myZone.id) {
      this.myZone = zone;
      this.renderToggle();
      await this.refreshWorld();
    }
  },

  startPolling() {
    if (this.pollTimer) return;
    this.refreshWorld();
    this.pollTimer = setInterval(() => this.refreshWorld(), POLL_MS);
    setInterval(() => this.renderFreshness(), 30000);
  },

  async refreshWorld() {
    const { data, error } = await sb.rpc("get_world");
    if (error) return;
    // fetch any zones we haven't seen (auto zones from other areas)
    const missing = [...new Set((data ?? []).map(r => r.zone_id))]
      .filter(id => !this.zones.some(z => z.id === id));
    if (missing.length) {
      const { data: newZones } = await sb.from("zones").select("*").in("id", missing);
      (newZones ?? []).forEach(z => this.zones.push(z));
    }
    this.lastFetch = Date.now();
    this.renderWorld(data ?? []);
    this.renderFreshness();
  },

  youTag: null,

  ensureYouTag() {
    if (this.youTag && this.youTag.isConnected) return;
    this.youTag = document.createElement("div");
    this.youTag.className = "bubble-anchor";
    const t = document.createElement("div");
    t.className = "tag";
    t.textContent = "YOU";
    this.youTag.appendChild(t);
    bubbleLayer.appendChild(this.youTag);
    world3d.anchorAtPlayer(this.youTag, 17.5);
  },

  removeYouTag() {
    if (this.youTag) { this.youTag.remove(); this.youTag = null; }
  },

  renderWorld(rows) {
    const byZone = new Map();
    const remotes = [];
    for (const r of rows) {
      if (r.is_self) continue; // own character is the followed billboard
      const zone = this.zones.find(z => z.id === r.zone_id);
      if (!zone) continue;
      const slot = byZone.get(r.zone_id) ?? 0;
      byZone.set(r.zone_id, slot + 1);
      remotes.push({ avatar: normalizeAvatar(r.avatar), lat: zone.lat, lng: zone.lng, slot,
                     userId: r.user_id, handle: r.handle });
    }
    world3d.setRemotes(remotes);
    // presence framing — zone-coarse count only (safety model: no precise
    // distance, no tracking; just "someone's around, go say hi")
    const whoEl = document.getElementById("who-near");
    if (whoEl) {
      const n = remotes.length;
      whoEl.textContent = n === 0 ? "quiet right now" :
        n === 1 ? "1 person around — say hi" : `${n} people around — say hi`;
      whoEl.style.color = n ? "#7db8ff" : "";
    }
    // own character: at my zone's real position while open, absent while
    // closed; the 3D camera follows it (avatar keeps its screen spot)
    if (this.myZone) {
      world3d.setPlayer({
        avatar: avatar.mine,
        lat: this.myZone.lat,
        lng: this.myZone.lng,
      });
      this.ensureYouTag();
    } else {
      world3d.setPlayer(null);
      this.removeYouTag();
    }
  },

  renderFreshness() {
    if (!this.lastFetch) return;
    zminEl.textContent = String(Math.round((Date.now() - this.lastFetch) / 60000));
  },

  // the bar's left button: hidden (exploring) or visible on the map
  renderToggle() {
    const signedOut = statusEl.hidden;
    navbar.hidden = signedOut;
    if (signedOut) return;
    const open = !!this.myZone;
    exploreBtn.classList.toggle("seen", open);
    exploreBtn.classList.toggle("on", !open);           // the active tab while you're exploring
    exploreBtn.setAttribute("aria-pressed", String(!open));
    exploreBtn.title = open ? `You're visible · ${this.myZone.name} — tap to hide and explore` : "You're hidden and exploring — tap to be visible";
    zoneNameEl.textContent = open ? this.myZone.name : "hidden · exploring";
  },
};

// ===================== explore (invisible) =====================
// While you're hidden nobody sees you, and the map is yours to pan around —
// within ~1.5 km of where you really are. That spot is read ON this phone
// (only if location is already allowed; never prompts on its own) and never
// leaves it; without it, your last zone or the station is home.
const EXPLORE_M = 1500;
const explore = {
  marker: null,
  async enter(lastZone = null) {
    let home = lastZone ? { lat: lastZone.lat, lng: lastZone.lng } : null;
    try {
      const devOk = params.get("devlat") && params.get("devlng");
      const st = devOk ? null : await navigator.permissions?.query({ name: "geolocation" });
      if (devOk || st?.state === "granted") home = await readDeviceCoords();
    } catch { /* no permission: keep the fallback */ }
    if (presence.myZone) return;              // went visible meanwhile
    home ??= { lat: 37.5346, lng: 126.9946 };
    world3d.setExplore(home.lat, home.lng, EXPLORE_M);
    world3d.recenter();
    if (!this.marker) {
      this.marker = document.createElement("div");
      this.marker.className = "bubble-anchor";
      this.marker.innerHTML = `<div class="tag ghost">you · hidden</div>`;
      bubbleLayer.appendChild(this.marker);
      world3d.anchor(this.marker, () => world3d.homePos ? world3d.homePos.clone().setY(world3d.homePos.y + 4) : null);
    }
  },
  leave() {
    world3d.setExplore(null);
    this.marker?.remove(); this.marker = null;
    backBtn.hidden = true;
  },
};

exploreBtn.addEventListener("click", async () => {
  if (nav.swallow()) return;
  exploreBtn.disabled = true;
  sfx.confirm();
  try {
    if (presence.myZone) await presence.goClosed();
    else await presence.goOpen();
    matching.renderButton();
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    exploreBtn.disabled = false;
  }
});
// "back to me" shows once you've panned away from home
world3d.tickHooks.push(() => {
  const away = !presence.myZone && world3d.homePos && world3d.observing && world3d.awayFromHome() > 40;
  if (backBtn.hidden === !away) return;
  backBtn.hidden = !away;
});
backBtn.addEventListener("click", () => { sfx.back(); world3d.recenter(); backBtn.hidden = true; });

// ===================== matching =====================
// Explicit "match me" tap -> zone-scoped queue -> server-side pairing.
// The waiting side discovers its match by a light poll (chat gets realtime
// in the next phase; positions never do).

const MATCH_POLL_MS = 4000;

const matchCard = document.getElementById("match-card");
const mcHandle = document.getElementById("mc-handle");
const mcDismiss = document.getElementById("mc-dismiss");

export const matching = {
  queued: false,
  activeMatch: null,
  partner: null, // profile of the matched user (visible via mutual reveal)
  pollTimer: null,

  async onSignedIn() {
    await this.loadActive();
    this.renderButton();
  },

  onSignedOut() {
    this.stopPolling();
    this.queued = false;
    this.activeMatch = null;
    this.partner = null;
    matchCard.hidden = true;
    this.renderButton();
  },

  async loadActive() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data: m } = await sb
      .from("matches")
      .select("*")
      .eq("status", "active")
      .or(`user_a.eq.${session.user.id},user_b.eq.${session.user.id}`)
      .maybeSingle();
    this.activeMatch = m ?? null;
    if (m) {
      const partnerId = m.user_a === session.user.id ? m.user_b : m.user_a;
      const { data: p } = await sb
        .from("profiles").select("id, handle, avatar").eq("id", partnerId).maybeSingle();
      this.partner = p ?? null;
    }
  },

  async request() {
    const { data, error } = await sb.rpc("request_match");
    if (error) throw error;
    if (data && data.id) {
      // paired immediately with someone already waiting
      this.queued = false;
      await this.loadActive();
      this.showCard();
    } else {
      this.queued = true;
      this.startPolling();
    }
    this.renderButton();
  },

  async cancel() {
    const { data: { session } } = await sb.auth.getSession();
    await sb.from("match_queue").delete().eq("user_id", session.user.id);
    this.queued = false;
    this.stopPolling();
    this.renderButton();
  },

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      await this.loadActive();
      if (this.activeMatch) {
        this.queued = false;
        this.stopPolling();
        this.showCard();
        this.renderButton();
      }
    }, MATCH_POLL_MS);
  },

  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  showCard() {
    if (!this.partner) return;
    mcHandle.textContent = this.partner.handle;
    setAvatarThumb(document.querySelector("#match-card .mc-avatar"), this.partner.avatar);
    matchCard.hidden = false;
  },

  renderButton() {
    // matched: show the chat icon (unless the panel is already open)
    const pill = document.getElementById("chat-pill");
    const panelOpen = !document.getElementById("chat-panel").hidden;
    pill.hidden = statusEl.hidden || !this.activeMatch || !this.partner || panelOpen;
    if (!pill.hidden) pill.title = "Chat · " + this.partner.handle;
  },
};

mcDismiss.addEventListener("click", () => { matchCard.hidden = true; });

// ===================== real-time chat =====================
// Real persisted messages between the two match participants, delivered
// live over Supabase Realtime (which enforces the same RLS as reads).

const cScrim = document.getElementById("chat-scrim");
const cPanel = document.getElementById("chat-panel");
const cThread = document.getElementById("chat-thread");
const cName = document.getElementById("chat-name");
const cAvatar = document.getElementById("chat-avatar");
const cBadge = document.getElementById("chat-npc-badge");
const cForm = document.getElementById("chat-form");
const cInput = document.getElementById("chat-input");
const chatPill = document.getElementById("chat-pill");
const mcChat = document.getElementById("mc-chat");

export const chat = {
  channel: null,
  seen: new Set(),
  myId: null,
  current: null, // { id, partner, badge } — the open thread (match or DM)

  // tap-to-chat: any visible character opens a private thread, ungated
  // (product decision 2026-07-24). ensure_dm reuses an existing thread.
  async openDm(meta) {
    const { data: mid, error } = await sb.rpc("ensure_dm", { p_other: meta.userId });
    if (error) { console.warn("[rando] dm open failed:", error.message); return; }
    await this.openPanel({
      id: mid,
      partner: { id: meta.userId, handle: meta.handle, avatar: meta.avatar },
      badge: "TAPPED IN THE WORLD · PRIVATE",
    });
  },

  async openPanel(target) {
    if (!target) {
      if (!matching.activeMatch || !matching.partner) return;
      target = {
        id: matching.activeMatch.id,
        partner: matching.partner,
        badge: "MATCHED · SAME ZONE",
      };
    }
    this.current = target;
    const { data: { session } } = await sb.auth.getSession();
    this.myId = session.user.id;
    cName.textContent = target.partner.handle;
    setAvatarThumb(cAvatar, target.partner.avatar);
    cBadge.textContent = target.badge;
    cThread.innerHTML = "";
    this.seen.clear();
    const { data: history } = await sb
      .from("messages")
      .select("*")
      .eq("match_id", target.id)
      .order("created_at");
    (history ?? []).forEach(m => this.append(m));
    this.subscribe();
    cScrim.hidden = false;
    cPanel.hidden = false;
    matchCard.hidden = true;
    chatPill.hidden = true;
    cInput.focus();
  },

  closePanel() {
    cScrim.hidden = true;
    cPanel.hidden = true;
    this.current = null;
    this.unsubscribe();
    matching.renderButton();
  },

  subscribe() {
    this.unsubscribe();
    const matchId = this.current.id;
    this.channel = sb
      .channel("match-" + matchId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "match_id=eq." + matchId },
        payload => this.append(payload.new))
      .subscribe();
  },

  unsubscribe() {
    if (this.channel) {
      sb.removeChannel(this.channel);
      this.channel = null;
    }
  },

  append(m) {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    const el = document.createElement("div");
    el.className = "msg " + (m.sender === this.myId ? "me" : "them");
    el.textContent = m.body;
    cThread.appendChild(el);
    cThread.scrollTop = cThread.scrollHeight;
  },

  async send(text) {
    const { data, error } = await sb
      .from("messages")
      .insert({ match_id: this.current.id, sender: this.myId, body: text })
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) this.append(data); // optimistic; realtime echo deduped by id
  },
};

cForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = cInput.value.trim();
  if (!text || !chat.current) return;
  cInput.value = "";
  try {
    await chat.send(text);
  } catch (err) {
    alert(err.message || String(err));
  }
});

// ===================== mutual tap-confirm =====================
// Both participants must independently confirm; blind-until-both is
// enforced by RLS (you can only read your own confirm row), so this UI
// can only ever show: not-confirmed / you-confirmed / both-confirmed.

const ENC_POLL_MS = 5000;
const encBtn = document.getElementById("enc-confirm");
const encState = document.getElementById("enc-state");

export const encounter = {
  timer: null,
  syncedMatch: null, // last matchId already synced to friends.load()

  async refresh() {
    if (!chat.current) return;
    const { data, error } = await sb.rpc("encounter_status", { p_match: chat.current.id });
    if (error || !data || !data.length) return;
    this.render(data[0]);
  },

  render({ i_confirmed, encounter_complete, encounter_verified }) {
    if (encounter_complete) {
      encBtn.hidden = true;
      encState.hidden = false;
      if (encounter_verified) {
        encState.className = "complete";
        encState.textContent = "\u{1F389} Encounter confirmed — you're now friends!";
        // proximity-verified encounters auto-friend server-side; pick up
        // the new friend without waiting for the next sign-in
        if (this.syncedMatch !== matching.activeMatch.id) {
          this.syncedMatch = matching.activeMatch.id;
          friends.load();
        }
      } else {
        encState.className = "";
        encState.textContent = "Confirmed by both of you, but you didn't seem to be close enough together.";
      }
      this.stopPolling();
    } else if (i_confirmed) {
      encBtn.hidden = true;
      encState.hidden = false;
      encState.className = "";
      encState.textContent = "You've confirmed this encounter ✓";
    } else {
      encBtn.hidden = false;
      encState.hidden = true;
    }
  },

  async confirm() {
    const { data: { session } } = await sb.auth.getSession();
    // proximity is checked server-side once both sides have confirmed;
    // this reading is used for that one comparison and then scrubbed
    const { lat, lng } = await readDeviceCoords();
    const { error } = await sb.from("encounter_confirms")
      .insert({ match_id: matching.activeMatch.id, user_id: session.user.id, lat, lng });
    // duplicate confirm (PK conflict) is fine — state is already ours
    if (error && !/duplicate|23505/.test(error.message + (error.code ?? ""))) throw error;
    await this.refresh();
    // ensure we're polling for completion even if the panel-open sequence
    // was still in flight when the user tapped confirm
    if (!this.timer) this.startPolling();
  },

  startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => this.refresh(), ENC_POLL_MS);
  },

  stopPolling() {
    clearInterval(this.timer);
    this.timer = null;
  },
};

encBtn.addEventListener("click", async () => {
  encBtn.disabled = true;
  try {
    await encounter.confirm();
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    encBtn.disabled = false;
  }
});

// tie encounter state to the chat panel lifecycle
const _openPanel = chat.openPanel.bind(chat);
chat.openPanel = async function (target) {
  await _openPanel(target);
  if (!this.current) return; // nothing opened (no match, bad target)
  await encounter.refresh();
  encounter.startPolling();
};

// world tap → private chat (any visible character, ungated)
world3d.onCharTap = meta => { chat.openDm(meta); };

// ===================== archetype NPC quests =====================
// The three mascots stand at their locked real venues. In-range detection
// reuses the meetup-confirm pattern: coordinates are read ON-DEVICE
// (readDeviceCoords honors ?devlat/?devlng) and only a boolean reaches the
// world. Tap in range -> in-character quest offer -> yes -> 2D pixel lobby.
// ?devnpc=1 forces every NPC in range for desk testing.
const archQuests = {
  // DEMO MODE: false = everyone is "in range" everywhere, so the quest flow
  // can be tried without standing at the venue. Flip to true to restore the
  // launch behavior (on-device GPS gate, idles only while physically near).
  GATE_BY_GPS: false,
  RANGE_M: 150,          // urban GPS is sloppy; venue-scale, not doorstep
  CHECK_MS: 90 * 1000,
  near: {},              // id -> bool
  timer: null,
  pending: null,         // def shown in the card

  LINES: {
    chill: {
      venue: "Ikovox · coffee",
      line: "oh — you found my spot.\nthe beans here hit different when it rains.\nwanna come pick today's playlist with me?",
      far: "Nabi is curled up at Ikovox.\nSwing by the cafe to wake them up.",
      yes: "let's chill",
    },
    chaos: {
      venue: "Grand Ole Opry · bar",
      line: "YOO you actually CAME?!\nthe wall ate my setlist AGAIN and the show is TONIGHT.\nhelp me find it?? it's gonna get LOUD in here.",
      far: "Nalli is bouncing off the walls at the Grand Ole Opry.\nGet over there before something breaks.",
      yes: "LET'S GO",
    },
    sporty: {
      venue: "Namsan 산스장 · exercise park",
      line: "nice pace getting up the hill!\nI'm mid-set — spot me for one round\nand I'll show you my secret trail after.",
      far: "Dali is doing pull-ups at the Namsan 산스장.\nHike up and join a set.",
      yes: "I'm in",
    },
  },

  async start() {
    if (!this.GATE_BY_GPS) {
      for (const def of ARCH_NPC_DEFS) this.setNear(def.id, true);
      return;
    }
    // never trigger the geolocation permission prompt just by loading the
    // page — passive checks run only once permission is already granted
    // (going open asks for it), or under the dev overrides
    const devOk = params.get("devnpc") === "1" ||
      (params.get("devlat") && params.get("devlng"));
    let granted = false;
    try {
      const st = await navigator.permissions.query({ name: "geolocation" });
      granted = st.state === "granted";
      st.addEventListener?.("change", () => {
        if (st.state === "granted" && !this.timer) this.start();
      });
    } catch { /* permissions API unavailable -> stay passive */ }
    if (!devOk && !granted) return;
    this.check();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.check(), this.CHECK_MS);
  },

  async check() {
    if (params.get("devnpc") === "1") {
      for (const def of ARCH_NPC_DEFS) this.setNear(def.id, true);
      return;
    }
    let coords;
    try { coords = await readDeviceCoords(); }
    catch { return; } // no GPS permission -> everyone stays out of range
    for (const def of ARCH_NPC_DEFS) {
      const d = presence.haversine(coords.lat, coords.lng, def.lat, def.lng);
      this.setNear(def.id, d <= this.RANGE_M);
    }
  },

  setNear(id, val) {
    if (this.near[id] === val) return;
    this.near[id] = val;
    world3d.setArchNpcActive(id, val);
  },

  onTap(def, active) {
    const L = this.LINES[def.arch];
    if (!L) return;
    this.pending = active ? def : null;
    npcPortrait.src = `npcs/${def.arch}_portrait.jpg`;
    npcName.textContent = def.name;
    npcVenue.textContent = L.venue;
    npcLine.textContent = active ? L.line : L.far;
    npcYes.hidden = !active;
    npcYes.textContent = L.yes;
    npcNo.textContent = active ? "not now" : "ok";
    npcCard.hidden = false;
  },

  accept() {
    const def = this.pending;
    npcCard.hidden = true;
    if (!def) return;
    // 3D world -> the archetype's 2D pixel lobby, as the player's own
    // customized avatar (runtime pixel sprite)
    lobby.enter(def.arch, avatar.mine, def.name);
  },
};

// ===================== lobby-scoped chat =====================
// Inside a quest lobby, chat switches to that lobby instance's channel: a
// Supabase Realtime BROADCAST channel (`lobby-<arch>`), ephemeral by
// design — only players currently inside receive it, nothing is stored.
// World chat is untouched: zone pubchat, DMs, and friend threads keep
// their state and are reachable again the moment you exit (per the locked
// presence rule — chat persists across app states, only map presence
// doesn't).
const lobbyChat = {
  ch: null,
  handle: null,
  feed: document.getElementById("lobby-chat-feed"),
  form: document.getElementById("lobby-chat-form"),
  input: document.getElementById("lobby-chat-input"),

  async join(arch) {
    this.leave();
    this.feed.innerHTML = "";
    this.sys("only people in this lobby can see this chat");
    if (!this.handle) {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data } = await sb.from("profiles")
          .select("handle").eq("id", session.user.id).maybeSingle();
        this.handle = data?.handle ?? null;
      }
    }
    this.ch = sb.channel(`lobby-${arch}`, { config: { broadcast: { self: true } } });
    this.ch.on("broadcast", { event: "msg" }, ({ payload }) => this.render(payload));
    this.ch.subscribe();
  },

  leave() {
    if (this.ch) { sb.removeChannel(this.ch); this.ch = null; }
  },

  send(text) {
    if (!this.ch || !text.trim()) return;
    this.ch.send({ type: "broadcast", event: "msg",
      payload: { from: this.handle ?? "someone", text: text.trim().slice(0, 160) } });
  },

  render({ from, text }) {
    const div = document.createElement("div");
    div.className = "lc-msg";
    const b = document.createElement("b");
    b.textContent = from;
    div.appendChild(b);
    div.appendChild(document.createTextNode(text));
    this.feed.appendChild(div);
    while (this.feed.children.length > 40) this.feed.firstChild.remove();
    this.feed.scrollTop = this.feed.scrollHeight;
  },

  sys(text) {
    const div = document.createElement("div");
    div.className = "lc-sys";
    div.textContent = text;
    this.feed.appendChild(div);
  },
};
lobbyChat.form.addEventListener("submit", e => {
  e.preventDefault();
  lobbyChat.send(lobbyChat.input.value);
  lobbyChat.input.value = "";
});
lobby.onEnter = arch => lobbyChat.join(arch);
lobby.onExit = () => lobbyChat.leave();

const npcCard = document.getElementById("npc-card");
const npcPortrait = document.getElementById("npc-portrait");
const npcName = document.getElementById("npc-name");
const npcVenue = document.getElementById("npc-venue");
const npcLine = document.getElementById("npc-line");
const npcYes = document.getElementById("npc-yes");
const npcNo = document.getElementById("npc-no");
npcYes.addEventListener("click", () => archQuests.accept());
npcNo.addEventListener("click", () => { npcCard.hidden = true; archQuests.pending = null; });
// tapping an NPC: they say hi in a DS-style dialog box. Raids are off, so
// that's all that happens.
const npcDlgHost = document.getElementById("npc-dlg");
let npcDlg = null;
world3d.onArchNpcTap = def => {
  npcDlg?.close();
  sfx.cursor();
  npcDlg = typeDialog(npcDlgHost, { name: def.name, text: "Wassup! Raids aren't available right now.", blip: () => sfx.blip(), onClose: () => { npcDlg = null; } });
};
archQuests.start();
const _closePanel = chat.closePanel.bind(chat);
chat.closePanel = function () {
  _closePanel();
  encounter.stopPolling();
};

mcChat.addEventListener("click", () => chat.openPanel());
chatPill.addEventListener("click", () => chat.openPanel());
cScrim.addEventListener("click", () => chat.closePanel());
document.getElementById("chat-close").addEventListener("click", () => chat.closePanel());
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !cPanel.hidden) chat.closePanel();
});

// ===================== friends =====================
// Permanent, from a verified encounter (see the friends migration): no
// client-facing "add friend" action exists — friendship is a pure
// server-side side effect of a proximity-confirmed encounter. This module
// only lists and displays what the server has already decided.

const friendsBtn = document.getElementById("friends-btn");
const friendsPanel = document.getElementById("friends-panel");
const friendsList = document.getElementById("friends-list");

export const friends = {
  list: [],

  async onSignedIn() { await this.load(); },

  onSignedOut() {
    this.list = [];
    friendsBtn.hidden = true;
    friendsPanel.hidden = true;
    friendChat.closePanel();
  },

  async load() {
    const { data, error } = await sb.rpc("list_friends");
    if (error) return;
    this.list = data ?? [];
    friendsBtn.hidden = false;
    this.renderList();
  },

  renderList() {
    friendsList.innerHTML = "";
    if (!this.list.length) {
      const empty = document.createElement("p");
      empty.className = "os-note";
      empty.textContent = "No friends yet — meet up and confirm an encounter to connect.";
      friendsList.appendChild(empty);
      return;
    }
    for (const f of this.list) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "friend-row";
      const img = document.createElement("img");
      img.className = "friend-avatar";
      setAvatarThumb(img, f.avatar);
      const name = document.createElement("span");
      name.textContent = f.handle;
      row.append(img, name);
      row.addEventListener("click", () => friendChat.openPanel(f));
      friendsList.appendChild(row);
    }
  },
};

friendsBtn.addEventListener("click", () => {
  friendsPanel.hidden = !friendsPanel.hidden;
});

// ===================== friend chat (persistent DM) =====================
// Structurally parallel to `chat` above (same open/close/subscribe/append/
// send shape) but reads/writes friend_messages keyed by friendship_id
// instead of messages keyed by match_id, and has no "active" gate or
// encounter-bar — a friendship, once formed, doesn't expire.

const fcScrim = document.getElementById("friend-chat-scrim");
const fcPanel = document.getElementById("friend-chat-panel");
const fcThread = document.getElementById("friend-chat-thread");
const fcName = document.getElementById("friend-chat-name");
const fcAvatar = document.getElementById("friend-chat-avatar");
const fcForm = document.getElementById("friend-chat-form");
const fcInput = document.getElementById("friend-chat-input");

export const friendChat = {
  channel: null,
  seen: new Set(),
  myId: null,
  friendshipId: null,

  async openPanel(friend) {
    const { data: { session } } = await sb.auth.getSession();
    this.myId = session.user.id;
    this.friendshipId = friend.friendship_id;
    fcName.textContent = friend.handle;
    setAvatarThumb(fcAvatar, friend.avatar);
    fcThread.innerHTML = "";
    this.seen.clear();
    const { data: history } = await sb
      .from("friend_messages")
      .select("*")
      .eq("friendship_id", this.friendshipId)
      .order("created_at");
    (history ?? []).forEach(m => this.append(m));
    this.subscribe();
    fcScrim.hidden = false;
    fcPanel.hidden = false;
    friendsPanel.hidden = true;
    fcInput.focus();
  },

  closePanel() {
    fcScrim.hidden = true;
    fcPanel.hidden = true;
    this.unsubscribe();
  },

  subscribe() {
    this.unsubscribe();
    const friendshipId = this.friendshipId;
    this.channel = sb
      .channel("friend-" + friendshipId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "friend_messages", filter: "friendship_id=eq." + friendshipId },
        payload => this.append(payload.new))
      .subscribe();
  },

  unsubscribe() {
    if (this.channel) {
      sb.removeChannel(this.channel);
      this.channel = null;
    }
  },

  append(m) {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    const el = document.createElement("div");
    el.className = "msg " + (m.sender === this.myId ? "me" : "them");
    el.textContent = m.body;
    fcThread.appendChild(el);
    fcThread.scrollTop = fcThread.scrollHeight;
  },

  async send(text) {
    const { data, error } = await sb
      .from("friend_messages")
      .insert({ friendship_id: this.friendshipId, sender: this.myId, body: text })
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) this.append(data); // optimistic; realtime echo deduped by id
  },
};

fcForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = fcInput.value.trim();
  if (!text || !friendChat.friendshipId) return;
  fcInput.value = "";
  try {
    await friendChat.send(text);
  } catch (err) {
    alert(err.message || String(err));
  }
});

document.getElementById("friend-chat-close").addEventListener("click", () => friendChat.closePanel());
fcScrim.addEventListener("click", () => friendChat.closePanel());
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !fcPanel.hidden) friendChat.closePanel();
});

// keep the match button in sync with presence/auth state
const _onSignedIn = presence.onSignedIn.bind(presence);
presence.onSignedIn = async function () {
  await _onSignedIn();
  await matching.onSignedIn();
};
const _onSignedOut = presence.onSignedOut.bind(presence);
presence.onSignedOut = function () {
  _onSignedOut();
  matching.onSignedOut();
};
const _goClosed = presence.goClosed.bind(presence);
presence.goClosed = async function () {
  await _goClosed();
  matching.queued = false; // server trigger already dropped the queue row
  matching.stopPolling();
  matching.renderButton();
};

// ===================== avatar / customization =====================
// profiles.avatar = { color, accent, ears, arms, wings, eyes, accessory }
// — parametric slots + tints on the modular 3D character. Any historical
// avatar shape normalizes to a valid config. Others see changes on their
// next world poll.

// Style tabs: icons with a label; each holds rows of tiles (a slot each).
// Tintable slots get a swatch row under their tiles. Head / Face / Neck are
// the accessory slots: no items yet (see docs), so they say so.
const ICON = {
  hair: '<path d="M5 13c0-5 3-8 7-8s7 3 7 8v3h-2v-3c0-2-1-3-2-4-2 2-5 3-8 3v4H5z"/>',
  eyes: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  top: '<path d="M8 4l-5 3 2 4 2-1v10h10V10l2 1 2-4-5-3c-1 2-2 3-4 3S9 6 8 4z"/>',
  bottom: '<path d="M6 3h12l1 18h-5l-2-11-2 11H5z"/>',
  shoes: '<path d="M3 15c3 0 5-2 6-6l3 2c2 1 4 2 7 2 2 0 3 1 3 3v2H3z"/>',
  head: '<path d="M4 15a8 8 0 0 1 16 0z"/><path d="M2 15h20v3H2z"/>',
  facewear: '<path d="M4 8h16v5a8 5 0 0 1-16 0z"/><path d="M8 11h8"/>',
  neck: '<path d="M6 4c0 6 2 10 6 10s6-4 6-10"/><circle cx="12" cy="17" r="2.5"/>',
  shop: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
};
const TABS = [
  { key: "hair", label: "Hair", rows: [["hair", "tiles"], ["hairColor", "swatch"]] },
  { key: "eyes", label: "Eyes", rows: [["face", "eyes"], ["iris", "swatch"], ["skin", "swatch"]] },
  { key: "top", label: "Top", rows: [["fits", "fits"], ["top", "tiles"]] },
  { key: "bottom", label: "Bottom", rows: [["bottom", "tiles"]] },
  { key: "shoes", label: "Shoes", rows: [["shoes", "tiles"]] },
  { key: "head", label: "Head", soon: "Beanies, caps, headphones and goggles are on the way." },
  { key: "facewear", label: "Face", soon: "Face masks are on the way." },
  { key: "neck", label: "Neck", soon: "Chains and backpacks are on the way." },
  { key: "shop", label: "Shop" },
];
const ROW_LABEL = { fits: "Starter fits", hair: "Style", hairColor: "Color", face: "Eyes", iris: "Iris", skin: "Skin", top: "Tops", bottom: "Bottoms", shoes: "Sneakers & shoes" };
const SLOTS = ["skin", "hair", "hairColor", "face", "iris", "top", "bottom", "shoes"];
const rgbCss = a => `rgb(${a[0]},${a[1]},${a[2]})`;
// fallback tile art while the 3D thumbnail renders (prep-generated crops)
const OPTION_ICON = {
  hair: v => `avatar3/icons/hair_${v}.jpg`,
  top: v => `avatar3/icons/top_${v}.jpg`,
  bottom: v => `avatar3/icons/bottom_${v}.jpg`,
  shoes: v => `avatar3/icons/shoe_${v}.jpg`,
};
// rarity is a display tier from the shop price (free items are common)
const rarityOf = it => !it ? "common" : it.price < 100 ? "rare" : it.price < 150 ? "epic" : "legendary";
const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };
const faceTile = (cfg, value) => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = rgbCss(SKIN_RGB[cfg.skin] ?? [226, 189, 173]);
  g.beginPath(); g.arc(64, 70, 56, 0, Math.PI * 2); g.fill();
  g.translate(-16, -40); drawFace(g, 160, { style: value, iris: cfg.iris, expr: "neutral", brow: HAIR_RGB[cfg.hairColor] });
  return cv;
};

const styleScreen = document.getElementById("style-screen");
const outfitGrid = document.getElementById("outfit-grid");
const same = (a, b) => SLOTS.every(k => a[k] === b[k]);

export const avatar = {
  mine: { ...DEFAULT_AVATAR },   // what's saved (and what others see)
  draft: null,                   // what you're trying on in the style screen
  tab: "hair",

  async load() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data } = await sb.from("profiles").select("avatar").eq("id", session.user.id).maybeSingle();
    this.mine = normalizeAvatar(data && data.avatar);
    if (rooms.me) rooms.me.avatar = this.mine;
    this.applyOwn();
  },

  applyOwn() {
    if (presence.myZone) {
      world3d.setPlayer({
        avatar: this.mine,
        lat: presence.myZone.lat,
        lng: presence.myZone.lng,
      });
    }
  },

  // unowned shop items in the look you're trying on
  locked(look = this.draft ?? this.mine) {
    return SLOTS.map(k => wallet.itemFor(k, look[k])).filter(it => it && !wallet.owns(it.id));
  },

  // try something on: the stage reacts; nothing is saved until Save
  pick(key, value, { quiet = false } = {}) {
    this.draft = { ...(this.draft ?? this.mine), [key]: value };
    styleView.view?.setAvatar(this.draft);
    if (!quiet) { sfx.cursor(); haptic(); styleView.sparkle(); }
    this.markSelected();
    styleView.paintActions();
  },

  async save() {
    const look = this.draft ?? this.mine;
    if (this.locked(look).length) { styleView.paintActions(); return false; }
    if (same(look, this.mine)) return true;
    const btn = document.getElementById("style-save");
    btn.disabled = true; btn.textContent = "Saving…";
    const { data: { session } } = await sb.auth.getSession();
    const { error } = await sb.from("profiles").update({ avatar: look }).eq("id", session.user.id);
    if (error) {
      // the server only lets you wear shop items you own
      console.warn("[rando] outfit not saved:", error.message);
      btn.textContent = "Couldn't save"; btn.disabled = false; sfx.back();
      return false;
    }
    this.mine = { ...look };
    if (rooms.me) rooms.me.avatar = this.mine;
    this.applyOwn();
    party.current?.room?.updateMe?.({ avatar: this.mine }).catch?.(() => {}); // the party room sees it live
    sfx.win(); haptic(14);
    styleView.paintActions(true);
    return true;
  },

  randomize() {
    const free = (k, v) => { const it = wallet.itemFor(k, v); return !it || wallet.owns(it.id); };
    const pickOf = k => { const vs = PART_OPTIONS3[k].filter(v => free(k, v)); return vs[Math.floor(Math.random() * vs.length)]; };
    const next = { ...(this.draft ?? this.mine) };
    for (const k of SLOTS) next[k] = pickOf(k);
    if (next.shoes === "none") next.shoes = pickOf("shoes"); // sneakers on, mostly
    this.draft = next;
    styleView.view?.setAvatar(next);
    sfx.cursor(); haptic(12); styleView.sparkle(true);
    this.renderGrid();
  },

  // the tile strip for the current tab (rebuilt on tab changes only; picks
  // just move the selection, so the strips keep their scroll positions)
  renderGrid() {
    if (!TABS.some(t => t.key === this.tab)) this.tab = "hair";
    wallet.paint();
    const look = this.draft ?? this.mine;

    const tabsEl = document.getElementById("outfit-tabs");
    tabsEl.innerHTML = "";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.className = "look-tab" + (this.tab === t.key ? " active" : "");
      b.setAttribute("aria-selected", this.tab === t.key);
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t.key]}</svg><span>${t.label}</span>`;
      b.addEventListener("click", () => { if (this.tab === t.key) return; this.tab = t.key; sfx.cursor(); haptic(); this.renderGrid(); });
      tabsEl.appendChild(b);
    }
    tabsEl.querySelector(".active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });

    outfitGrid.innerHTML = "";
    outfitGrid.classList.remove("ss-in"); void outfitGrid.offsetWidth; outfitGrid.classList.add("ss-in");
    const tab = TABS.find(t => t.key === this.tab);
    outfitGrid.classList.toggle("shop", tab.key === "shop");
    if (tab.key === "shop") { wallet.renderShop(outfitGrid); styleView.paintActions(); return; }
    if (tab.soon) {
      outfitGrid.innerHTML = `<div class="ss-soon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[tab.key]}</svg><b>New drops soon</b><span>${tab.soon}</span></div>`;
      styleView.paintActions(); return;
    }
    for (const [slot, kind] of tab.rows) {
      const row = document.createElement("div");
      row.className = `ss-row ss-${kind}`;
      row.innerHTML = `<small>${ROW_LABEL[slot]}</small><div class="ss-strip"></div>`;
      const strip = row.lastChild;
      if (kind === "fits") {
        // a whole fit in one tap: its top, bottom and shoes side by side
        for (const f of STARTER_FITS) {
          const b = document.createElement("button");
          b.type = "button"; b.className = "fit-tile"; b.dataset.fit = f.id;
          b.innerHTML = `<span class="fit-art">${["top", "bottom", "shoes"].map(k => `<img alt="" data-k="${k}" src="${OPTION_ICON[k](f[k])}">`).join("")}</span><b>${f.name}</b>`;
          for (const k of ["top", "bottom", "shoes"]) styleView.ready.then(() => pieceThumb(k, f[k], { size: 96 })).then(url => { const im = b.querySelector(`[data-k="${k}"]`); if (im) im.src = url; }).catch(() => {});
          b.addEventListener("click", () => {
            this.draft = { ...(this.draft ?? this.mine), top: f.top, bottom: f.bottom, shoes: f.shoes };
            styleView.view?.setAvatar(this.draft);
            sfx.cursor(); haptic(); styleView.sparkle(true);
            this.markSelected(); styleView.paintActions();
          });
          strip.appendChild(b);
        }
        outfitGrid.appendChild(row);
        continue;
      }
      for (const value of PART_OPTIONS3[slot]) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.slot = slot; b.dataset.value = value;
        const it = wallet.itemFor(slot, value);
        if (kind === "swatch") {
          b.className = "swatch";
          b.style.setProperty("--sw", slot === "skin" ? rgbCss(SKIN_RGB[value]) : slot === "hairColor" ? rgbCss(HAIR_RGB[value]) : IRIS3_HEX[value]);
          b.setAttribute("aria-label", `${ROW_LABEL[slot]} ${value}`);
        } else if (kind === "eyes") {
          b.className = "opt-tile face-tile";
          b.appendChild(faceTile(look, value));
          b.setAttribute("aria-label", `eyes ${value}`);
        } else if (value === "none") {
          b.className = "opt-tile part-chip";
          b.innerHTML = `<span>none</span>`;
        } else {
          b.className = `opt-tile r-${rarityOf(it)}`;
          const img = document.createElement("img");
          img.alt = value.replace(/-/g, " ");
          img.src = OPTION_ICON[slot]?.(value) ?? "";
          img.onerror = () => { img.style.visibility = "hidden"; };
          b.appendChild(img);
          // 3D thumbnails once the stage's character is up (they queue)
          styleView.ready.then(() => pieceThumb(slot, value, { hairColor: look.hairColor }))
            .then(url => { img.style.visibility = ""; img.src = url; b.classList.add("thumb3d"); })
            .catch(() => {});
        }
        // shop items: a lock and the price until you own them
        if (it && !wallet.owns(it.id)) { b.classList.add("locked"); b.insertAdjacentHTML("beforeend", `<span class="lock-tag"><i class="coin"></i>${it.price}</span>`); }
        b.addEventListener("click", () => this.pick(slot, value));
        strip.appendChild(b);
      }
      outfitGrid.appendChild(row);
    }
    this.markSelected();
    styleView.paintActions();
  },

  markSelected() {
    const look = this.draft ?? this.mine;
    outfitGrid.querySelectorAll("[data-fit]").forEach(b => {
      const f = STARTER_FITS.find(x => x.id === b.dataset.fit);
      b.classList.toggle("selected", !!f && f.top === look.top && f.bottom === look.bottom && f.shoes === look.shoes);
    });
    outfitGrid.querySelectorAll("[data-slot]").forEach(b => {
      const sel = look[b.dataset.slot] === b.dataset.value;
      if (sel && !b.classList.contains("selected")) b.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      b.classList.toggle("selected", sel);
    });
  },
};

// ===================== coins + shop =====================
// Coins are earned in house parties and spent in the shop. The balance, the
// shop and what you own all live on the server (migrations/013); this only
// shows them and asks the server to buy. Never trusts its own numbers.
export const wallet = {
  coins: 0,
  owned: new Set(),
  items: [],                 // shop_items rows
  async load() {
    const [{ data: w }, { data: items }] = await Promise.all([sb.rpc("my_wallet"), sb.from("shop_items").select("*").order("price")]);
    if (w) { this.coins = w.coins ?? 0; this.owned = new Set(w.owned ?? []); }
    if (items) this.items = items;
    this.paint();
  },
  itemFor(slot, value) { return this.items.find(i => i.slot === slot && i.value === value) ?? null; },
  owns(id) { return this.owned.has(id); },
  paint() {
    const el = document.getElementById("style-coins");
    if (el) el.innerHTML = `<i class="coin"></i><b>${this.coins}</b><span class="ss-plus" aria-hidden="true">+</span>`;
  },
  renderShop(grid) {
    if (!this.items.length) { grid.innerHTML = `<p class="shop-empty">the shop is closed right now</p>`; return; }
    grid.innerHTML = this.items.map(it => {
      const own = this.owns(it.id), wearing = (avatar.draft ?? avatar.mine)[it.slot] === it.value;
      const art = OPTION_ICON[it.slot]?.(it.value);
      if (art) pieceThumb(it.slot, it.value).then(url => { const im = grid.querySelector(`[data-item="${it.id}"] img`); if (im) im.src = url; }).catch(() => {});
      const vis = art ? `<img src="${art}" alt="">` : `<span class="shop-swatch" style="background:${it.slot === "hairColor" ? rgbCss(HAIR_RGB[it.value] ?? [128, 128, 128]) : "#555"}"></span>`;
      return `<div class="shop-item r-${rarityOf(it)} ${own ? "owned" : ""} ${avatar.focus === it.id ? "focus" : ""}" data-item="${it.id}">
          <div class="shop-vis">${vis}</div><b>${escHtml(it.name)}</b>
          ${own ? `<button type="button" class="y-btn small ${wearing ? "dim" : "lime"}" data-wear="${it.id}" ${wearing ? "disabled" : ""}>${wearing ? "wearing" : "owned · wear"}</button>`
                : `<button type="button" class="y-btn small gold" data-buy="${it.id}" ${this.coins < it.price ? "disabled" : ""}><i class="coin"></i>${it.price}</button>`}
        </div>`;
    }).join("") + `<p class="shop-note" id="shop-note">earn coins at house parties · ${this.owned.size} owned</p>`;
    grid.querySelectorAll("[data-buy]").forEach(b => b.onclick = () => this.buy(b.dataset.buy));
    grid.querySelectorAll("[data-wear]").forEach(b => b.onclick = async () => { const it = this.items.find(i => i.id === b.dataset.wear); if (!it) return; avatar.pick(it.slot, it.value); await avatar.save(); this.renderShop(grid); });
    grid.querySelector(".shop-item.focus")?.scrollIntoView({ block: "nearest" });
    avatar.focus = null;
  },
  async buy(id) {
    const it = this.items.find(i => i.id === id); if (!it) return;
    const note = document.getElementById("shop-note");
    const { data, error } = await sb.rpc("buy_item", { p_item: id });
    if (error || !data?.ok) { sfx.back(); if (note) note.textContent = data?.why ?? error?.message ?? "couldn't buy that"; return; }
    this.coins = data.coins ?? this.coins; this.owned = new Set(data.owned ?? [...this.owned, id]);
    sfx.win(); this.paint();
    avatar.pick(it.slot, it.value, { quiet: true });           // put it on straight away
    await avatar.save();
    const grid = document.getElementById("outfit-grid");
    if (avatar.tab === "shop") this.renderShop(grid); else avatar.renderGrid();
    const card = grid.querySelector(`[data-item="${id}"]`);
    if (card) { const { coinBurst } = await import("./partyboard.js"); coinBurst(card, 10); }
  },
};
const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ===================== style screen =====================
// Its own full-screen screen (not on the map), like opening your profile:
// your character on a lit stage in the top ~60% (drag to spin, pinch to
// zoom, double-tap to reset, Idle/Walk preview), the slots under it. You
// try things on freely (shop items too); Save keeps the look. The map
// stops drawing while it's open.
const styleView = {
  view: null,
  ready: Promise.resolve(), // settles when the stage's character is drawing
  open() {
    if (!styleScreen.hidden) return;
    this.ready = new Promise(res => { this._ready = res; setTimeout(res, 2500); });
    avatar.draft = { ...avatar.mine };
    wallet.load().then(() => avatar.renderGrid()).catch(e => console.warn("[rando] wallet", e));
    avatar.renderGrid();
    styleScreen.hidden = false;
    styleScreen.classList.remove("y-in-wipe"); void styleScreen.offsetWidth; styleScreen.classList.add("y-in-wipe");
    world3d.setPaused(true);
    this.view = mountCharView(document.getElementById("style-view"), avatar.draft, { zoom: true, yaw: 0.2, stage: true, onReady: () => this._ready?.() });
    this.setPreview("idle");
    sfx.open();
  },
  // leaving with changes asks first
  requestClose() {
    if (styleScreen.hidden) return;
    if (avatar.draft && !same(avatar.draft, avatar.mine)) { document.getElementById("ss-ask").hidden = false; sfx.cursor(); return; }
    this.close();
  },
  close() {
    if (styleScreen.hidden) return;
    document.getElementById("ss-ask").hidden = true;
    this.view?.dispose(); this.view = null;
    document.getElementById("style-view").querySelectorAll("canvas, .cv-spr").forEach(n => n.remove());
    styleScreen.hidden = true;
    avatar.draft = null;
    world3d.setPaused(false);
    sfx.back();
  },
  setPreview(mode) {
    this.view?.setWalking(mode === "walk");
    document.querySelectorAll("#style-view [data-preview]").forEach(b => b.classList.toggle("on", b.dataset.preview === mode));
  },
  // a burst of gold sparkles over the character (big = randomize)
  sparkle(big = false) {
    const box = document.querySelector("#style-view .ss-sparks");
    if (!box || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const n = big ? 16 : 10;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("i");
      const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * (big ? 110 : 70);
      s.style.setProperty("--dx", `${Math.cos(a) * r}px`);
      s.style.setProperty("--dy", `${Math.sin(a) * r * 0.8 - 20}px`);
      s.style.animationDelay = `${Math.random() * 90}ms`;
      box.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  },
  // Save / Buy state under the tiles
  paintActions(justSaved = false) {
    const btn = document.getElementById("style-save"), buy = document.getElementById("ss-buy");
    if (!btn) return;
    const look = avatar.draft ?? avatar.mine;
    const locked = avatar.locked(look);
    const dirty = !same(look, avatar.mine);
    btn.classList.toggle("ready", dirty && !locked.length);
    btn.disabled = !dirty || locked.length > 0;
    btn.textContent = locked.length ? "Unlock to save" : dirty ? "Save" : justSaved ? "Saved ✓" : "Saved";
    if (locked.length) {
      const it = locked[0];
      buy.hidden = false;
      buy.innerHTML = `<span><b>${escHtml(it.name)}</b> is a shop item</span>
        <button type="button" class="gold" data-ss-buy="${it.id}" ${wallet.coins < it.price ? "disabled" : ""}><i class="coin"></i>${it.price}</button>`;
      buy.querySelector("[data-ss-buy]").onclick = () => wallet.buy(it.id);
    } else { buy.hidden = true; buy.innerHTML = ""; }
  },
};
document.getElementById("nav-style").addEventListener("click", () => { if (!nav.swallow()) styleView.open(); });
document.getElementById("style-close").addEventListener("click", () => styleView.requestClose());
document.getElementById("style-mute").appendChild(muteButton());
document.getElementById("style-coins").addEventListener("click", () => { avatar.tab = "shop"; sfx.cursor(); haptic(); avatar.renderGrid(); });
document.getElementById("style-random").addEventListener("click", e => {
  const d = e.currentTarget; d.classList.remove("roll"); void d.offsetWidth; d.classList.add("roll");
  avatar.randomize();
});
document.getElementById("style-save").addEventListener("click", () => avatar.save());
document.querySelectorAll("#style-view [data-preview]").forEach(b => b.addEventListener("click", () => { styleView.setPreview(b.dataset.preview); sfx.cursor(); haptic(); }));
document.getElementById("ss-ask").addEventListener("click", async e => {
  const k = e.target.closest("[data-ask]")?.dataset.ask;
  if (k === "discard") styleView.close();
  else if (k === "save") { if (await avatar.save()) styleView.close(); else document.getElementById("ss-ask").hidden = true; }
  else if (e.target.id === "ss-ask") document.getElementById("ss-ask").hidden = true;
});
document.addEventListener("keydown", e => { if (e.key === "Escape") styleView.requestClose(); });

// ===================== public chat =====================
// Real world-wide public messages: Twitch/Minecraft-style bottom feed +
// inline input (no takeover panel). Sender identity in the feed is the
// pseudonymous handle; the floating bubble anchors to the sender's ZONE
// cluster, not a specific sprite — presence stays identity-free.

const pubEl = document.getElementById("pubchat");
const pubFeed = document.getElementById("pubchat-feed");
const pubForm = document.getElementById("pubchat-form");
const pubInput = document.getElementById("pubchat-input");
const pubOpenBtn = document.getElementById("pubchat-open");

export const pubchat = {
  channel: null,
  myId: null,

  // the public feed is the ITAEWON square, not a global firehose: only
  // messages stamped with one of the fixed launch zones appear
  itaewonZones() {
    return presence.zones.filter(z => z.kind !== "auto").map(z => z.id);
  },
  inScope(m) {
    const ids = this.itaewonZones();
    return !ids.length || ids.includes(m.zone_id);
  },

  async onSignedIn() {
    const { data: { session } } = await sb.auth.getSession();
    this.myId = session.user.id;
    pubEl.hidden = false;
    pubFeed.innerHTML = "";
    let q = sb.from("public_messages").select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    const ids = this.itaewonZones();
    if (ids.length) q = q.in("zone_id", ids);
    const { data } = await q;
    (data ?? []).reverse().forEach(m => this.addLine(m));
    this.subscribe();
  },

  onSignedOut() {
    if (this.channel) { sb.removeChannel(this.channel); this.channel = null; }
    pubEl.hidden = true;
    pubForm.hidden = true;
    pubOpenBtn.hidden = false;
  },

  subscribe() {
    if (this.channel) sb.removeChannel(this.channel);
    this.channel = sb
      .channel("pubchat")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "public_messages" },
        p => {
          if (!this.inScope(p.new)) return; // Itaewon-only feed
          this.addLine(p.new);
          this.bubble(p.new);
        })
      .subscribe();
  },

  addLine(m, sys = false) {
    const line = document.createElement("div");
    line.className = "pub-line" + (sys ? " sys" : "");
    if (!sys) {
      const b = document.createElement("b");
      b.textContent = m.handle;
      line.appendChild(b);
    }
    line.appendChild(document.createTextNode(sys ? m : m.body));
    pubFeed.appendChild(line);
    while (pubFeed.children.length > 30) pubFeed.firstChild.remove();
  },

  bubble(m) {
    // own message floats over your character; others float over the
    // sender's zone cluster (never a specific person)
    const host = document.createElement("div");
    host.className = "bubble-anchor";
    const b = document.createElement("div");
    b.className = "bubble public";
    b.textContent = m.body;
    host.appendChild(b);
    bubbleLayer.appendChild(host);
    if (m.sender === this.myId && presence.myZone) {
      world3d.anchorAtPlayer(host);
    } else {
      const zone = presence.zones.find(z => z.id === m.zone_id);
      if (!zone) { host.remove(); return; }
      world3d.anchorAtZone(host, zone.lat, zone.lng);
    }
    setTimeout(() => {
      b.classList.add("out");
      setTimeout(() => host.remove(), 240);
    }, 4000);
  },

  async send(text) {
    const { error } = await sb.from("public_messages").insert({ body: text });
    if (error) {
      this.addLine(/open/i.test(error.message)
        ? "go open to talk in public chat"
        : error.message, true);
    }
  },
};

pubOpenBtn.addEventListener("click", () => {
  pubForm.hidden = false;
  pubOpenBtn.hidden = true;
  pubInput.focus();
});
pubForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = pubInput.value.trim();
  if (!text) return;
  pubInput.value = "";
  await pubchat.send(text);
});
pubInput.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    pubForm.hidden = true;
    pubOpenBtn.hidden = false;
  }
});

// the matching wrapper already chains onto presence handlers; add pubchat
const _pOnSignedIn = presence.onSignedIn.bind(presence);
presence.onSignedIn = async function () {
  await _pOnSignedIn();
  await pubchat.onSignedIn();
  await avatar.load();
  await friends.onSignedIn();
};
const _pOnSignedOut = presence.onSignedOut.bind(presence);
presence.onSignedOut = function () {
  _pOnSignedOut();
  pubchat.onSignedOut();
  styleView.close();
  friends.onSignedOut();
};

// ===================== the bottom bar =====================
// center: host a party (opens the party screen, or your party if you're in
// one) · left: explore/visible (above) · right: style (above).
// Pull the bar down to refresh nearby parties and people (the map itself
// pans, so the gesture lives on the bar).
const nav = {
  _swallow: false,
  // a pull that ended on a button isn't a tap on it
  swallow() { const s = this._swallow; this._swallow = false; return s; },
  async refresh() {
    const spin = document.getElementById("nav-refresh");
    if (spin.classList.contains("spinning")) return;
    spin.classList.add("spinning"); sfx.cursor();
    const t0 = Date.now();
    try { await Promise.all([presence.refreshWorld(), party.refreshNearby?.()]); } catch (e) { console.warn("[rando] refresh", e); }
    await new Promise(r => setTimeout(r, Math.max(350, 900 - (Date.now() - t0))));   // long enough to see it spin
    spin.classList.remove("spinning"); spin.style.removeProperty("--pull");
    sfx.ping();
  },
};
// Host: the gold ring fills with a little sparkle burst, then the host flow
// (or, while you're in a party, back to its room) opens
document.getElementById("nav-host").addEventListener("click", e => {
  if (nav.swallow()) return;
  const btn = e.currentTarget, ring = btn.querySelector(".nav-ring");
  if (btn.classList.contains("tap")) return;
  sfx.confirm();
  btn.classList.add("tap");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!calm) for (let i = 0; i < 8; i++) {
    const s = document.createElement("b"); s.className = "nav-spark"; s.style.setProperty("--a", `${i * 45}deg`);
    ring.appendChild(s); setTimeout(() => s.remove(), 600);
  }
  setTimeout(() => { btn.classList.remove("tap"); party.togglePanel(true); }, calm ? 120 : 280);
});
{
  let y0 = null, pulled = 0;
  // the bar sits at the bottom edge, so there's only ~a bar's height to pull
  // through: 40px does it. Once it's clearly a pull (not a tap on a button),
  // capture the pointer so a pull that runs off the screen still ends here.
  let captured = false;
  navbar.addEventListener("pointerdown", e => { y0 = e.clientY; pulled = 0; captured = false; });
  window.addEventListener("pointermove", e => {
    if (y0 === null) return;
    pulled = Math.max(0, e.clientY - y0);
    if (pulled > 10 && !captured) { captured = true; try { navbar.setPointerCapture(e.pointerId); } catch {} }
    if (pulled > 6) document.getElementById("nav-refresh").style.setProperty("--pull", Math.min(1, pulled / 40).toFixed(2));
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    const spin = document.getElementById("nav-refresh");
    if (pulled > 40) { nav._swallow = true; setTimeout(() => { nav._swallow = false; }, 400); nav.refresh(); }
    else if (!spin.classList.contains("spinning")) spin.style.removeProperty("--pull");
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

// ===================== ambience =====================
// looping grey NPC bubbles keep the world feeling alive — voiced by the
// three archetype mascots at their venues (the blob pairs are retired)
const AMBIENCE = [
  { id: "arch-chill",  text: "the beans hit different today… come thru", at: 600,   hold: 3200 },
  { id: "arch-chaos",  text: "SOUNDCHECK!! ok it's fine. it's fine.",    at: 4400,  hold: 3200 },
  { id: "arch-sporty", text: "morning set at the bars, join a round",    at: 15800, hold: 3200 },
];

function npcBubble({ id, text, hold }) {
  const host = document.createElement("div");
  host.className = "bubble-anchor";
  const b = document.createElement("div");
  b.className = "bubble public";
  b.textContent = text;
  host.appendChild(b);
  bubbleLayer.appendChild(host);
  world3d.anchorAtNpc(host, id);
  setTimeout(() => {
    b.classList.add("out");
    setTimeout(() => host.remove(), 240);
  }, hold);
}

function runAmbience() {
  AMBIENCE.forEach(m => setTimeout(() => npcBubble(m), m.at));
}
runAmbience();
setInterval(runAmbience, 19800);

// a failed status refresh (network flake, expired guest session, auth
// rate limit) must never kill the app — fall back to the sign-in sheet
const safeRefresh = () => refreshStatus().catch(e => {
  console.warn("[rando] status refresh failed:", e);
  showAuth(true);
});
sb.auth.onAuthStateChange(() => { safeRefresh(); });
safeRefresh();
