// Rando backend client: Supabase auth (phone OTP), profile, presence.
// Loaded as an ES module by web/index.html.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { world3d, ARCH_NPC_DEFS } from "./world3d.js";
import { lobby } from "./lobby.js";
import {
  PART_OPTIONS3, DEFAULT_AVATAR3, normalizeAvatar3, avatarThumb3,
  SKIN_RGB, HAIR_RGB, IRIS3_HEX, loadFaceDecals,
} from "./avatar3.js";
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
  statusEl.append("you: " + (profile ? profile.handle : "(no profile)") + " · ");
  const edit = document.createElement("a");
  edit.href = "#";
  edit.textContent = "name";
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

const openBtn = document.getElementById("open-toggle");
const zoneNameEl = document.getElementById("zone-name");
const zminEl = document.getElementById("zmin");
const recenterBtn = document.getElementById("recenter");

// on-device coordinate read, shared by zone resolution and encounter
// proximity confirm; ?devlat=&devlng= lets either be tested without GPS
async function readDeviceCoords() {
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
      this.startPolling();
    } catch (e) {
      console.warn("[rando] sign-in restore failed (world stays browsable):", e);
      this.renderToggle();
    }
  },

  onSignedOut() {
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
    this.myZone = null;
    this.renderToggle();
    await this.refreshWorld();
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

  renderToggle() {
    const signedOut = statusEl.hidden;
    openBtn.hidden = signedOut;
    recenterBtn.hidden = signedOut;
    if (signedOut) return;
    if (this.myZone) {
      openBtn.classList.add("is-open");
      openBtn.title = "You're open · " + this.myZone.name + " — tap to go invisible";
      zoneNameEl.textContent = this.myZone.name;
    } else {
      openBtn.classList.remove("is-open");
      openBtn.title = "Go open";
      zoneNameEl.textContent = "invisible";
    }
  },
};

openBtn.addEventListener("click", async () => {
  openBtn.disabled = true;
  try {
    if (presence.myZone) await presence.goClosed();
    else await presence.goOpen();
    matching.renderButton();
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    openBtn.disabled = false;
  }
});

// ===================== matching =====================
// Explicit "match me" tap -> zone-scoped queue -> server-side pairing.
// The waiting side discovers its match by a light poll (chat gets realtime
// in the next phase; positions never do).

const MATCH_POLL_MS = 4000;

const matchBtn = document.getElementById("match-btn");
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
    const canMatch = !!presence.myZone && !statusEl.hidden;
    matchBtn.hidden = !canMatch || !!this.activeMatch;
    if (this.queued) {
      matchBtn.title = "Looking for someone nearby… tap to cancel";
      matchBtn.classList.add("is-waiting");
    } else {
      matchBtn.title = "Match me";
      matchBtn.classList.remove("is-waiting");
    }
    // matched: show the chat icon (unless the panel is already open)
    const pill = document.getElementById("chat-pill");
    const panelOpen = !document.getElementById("chat-panel").hidden;
    pill.hidden = statusEl.hidden || !this.activeMatch || !this.partner || panelOpen;
    if (!pill.hidden) pill.title = "Chat · " + this.partner.handle;
  },
};

matchBtn.addEventListener("click", async () => {
  matchBtn.disabled = true;
  try {
    if (matching.queued) await matching.cancel();
    else await matching.request();
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    matchBtn.disabled = false;
  }
});

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

const npcCard = document.getElementById("npc-card");
const npcPortrait = document.getElementById("npc-portrait");
const npcName = document.getElementById("npc-name");
const npcVenue = document.getElementById("npc-venue");
const npcLine = document.getElementById("npc-line");
const npcYes = document.getElementById("npc-yes");
const npcNo = document.getElementById("npc-no");
npcYes.addEventListener("click", () => archQuests.accept());
npcNo.addEventListener("click", () => { npcCard.hidden = true; archQuests.pending = null; });
world3d.onArchNpcTap = (def, active) => archQuests.onTap(def, active);
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

// v3 categories: every slot mixes independently on the humanoid base
const TABS = [
  { key: "skin", label: "Skin" },
  { key: "hair", label: "Hair" },
  { key: "hairColor", label: "Hair color" },
  { key: "face", label: "Face" },
  { key: "iris", label: "Iris" },
  { key: "top", label: "Top" },
  { key: "bottom", label: "Bottom" },
  { key: "shoes", label: "Shoes" },
];
const rgbCss = a => `rgb(${a[0]},${a[1]},${a[2]})`;
// option tile art: category -> value -> image url (prep-generated crops)
const OPTION_ICON = {
  hair: v => `avatar3/icons/hair_${v}.jpg`,
  face: v => null, // face options render the decal itself on a skin tile
  top: v => `avatar3/icons/top_${v}.jpg`,
  bottom: v => `avatar3/icons/bottom_${v}.jpg`,
  shoes: v => `avatar3/icons/shoe_${v}.jpg`,
};

const outfitBtn = document.getElementById("outfit-btn");
const outfitSheet = document.getElementById("outfit-sheet");
const outfitGrid = document.getElementById("outfit-grid");

export const avatar = {
  mine: { ...DEFAULT_AVATAR },
  tab: "body",

  async load() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data } = await sb.from("profiles").select("avatar").eq("id", session.user.id).maybeSingle();
    this.mine = normalizeAvatar(data && data.avatar);
    this.applyOwn();
    outfitBtn.hidden = false;
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

  async pick(key, value) {
    this.mine = { ...this.mine, [key]: value };
    this.applyOwn();
    this.renderGrid();
    const { data: { session } } = await sb.auth.getSession();
    await sb.from("profiles").update({ avatar: this.mine }).eq("id", session.user.id);
  },

  renderGrid() {
    if (!TABS.some(t => t.key === this.tab)) this.tab = "skin";

    const tabsEl = document.getElementById("outfit-tabs");
    tabsEl.innerHTML = "";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "look-tab" + (this.tab === t.key ? " active" : "");
      b.textContent = t.label;
      b.addEventListener("click", () => { this.tab = t.key; this.renderGrid(); });
      tabsEl.appendChild(b);
    }

    outfitGrid.innerHTML = "";
    const swatch = this.tab === "skin" ? v => rgbCss(SKIN_RGB[v])
      : this.tab === "hairColor" ? v => rgbCss(HAIR_RGB[v])
      : this.tab === "iris" ? v => IRIS3_HEX[v] : null;
    for (const value of PART_OPTIONS3[this.tab]) {
      const b = document.createElement("button");
      b.type = "button";
      const sel = this.mine[this.tab] === value;
      if (swatch) {
        b.className = "swatch" + (sel ? " selected" : "");
        b.style.background = swatch(value);
        b.title = value;
      } else if (this.tab === "face") {
        b.className = "opt-tile face-tile" + (sel ? " selected" : "");
        const img = document.createElement("img");
        img.src = `avatar3/faces/${value}_${this.mine.iris}.png`;
        img.alt = value;
        b.appendChild(img);
      } else if (value === "none") {
        b.className = "part-chip" + (sel ? " selected" : "");
        b.textContent = "none";
      } else {
        b.className = "opt-tile" + (sel ? " selected" : "");
        const img = document.createElement("img");
        img.src = OPTION_ICON[this.tab](value);
        img.alt = value;
        b.appendChild(img);
      }
      b.addEventListener("click", () => this.pick(this.tab, value));
      outfitGrid.appendChild(b);
    }
  },
};

outfitBtn.addEventListener("click", () => {
  avatar.renderGrid();
  outfitSheet.hidden = !outfitSheet.hidden;
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") outfitSheet.hidden = true;
});

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
  outfitBtn.hidden = true;
  outfitSheet.hidden = true;
  friends.onSignedOut();
};

// ===================== ambience & camera chrome =====================
recenterBtn.addEventListener("click", () => world3d.recenter());

// looping grey NPC bubbles keep the plaza feeling alive
const AMBIENCE = [
  { id: "npc-dreads",  text: "anyone up for a quick game?",            at: 600,   hold: 3200 },
  { id: "npc-buzzcut", text: "who's got next on the board?",           at: 4400,  hold: 3200 },
  { id: "npc-silver",  text: "sketching by the crossing, come say hi", at: 15800, hold: 3200 },
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
