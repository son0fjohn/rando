// Rando backend client: Supabase auth (phone OTP), profile, presence.
// Loaded as an ES module by web/index.html.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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

async function refreshStatus() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
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
  const out = document.createElement("a");
  out.href = "#";
  out.textContent = "sign out";
  out.addEventListener("click", async e => {
    e.preventDefault();
    await presence.goClosed().catch(() => {});
    await sb.auth.signOut();
  });
  statusEl.append(out);
  presence.onSignedIn();
}

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
const playersLayer = document.getElementById("players-layer");
const playerSprite = document.getElementById("player");

export const presence = {
  zones: [],
  myZone: null,       // zone row while open, else null
  pollTimer: null,
  heartbeatTimer: null,
  lastFetch: null,

  async onSignedIn() {
    if (!this.zones.length) {
      const { data } = await sb.from("zones").select("*");
      this.zones = data ?? [];
    }
    // restore an existing open session (e.g. page reload while open)
    const { data: { session } } = await sb.auth.getSession();
    const { data: mine } = await sb
      .from("presence").select("zone_id").eq("user_id", session.user.id).maybeSingle();
    this.myZone = mine ? this.zones.find(z => z.id === mine.zone_id) ?? null : null;
    this.renderToggle();
    this.startPolling();
  },

  onSignedOut() {
    clearInterval(this.pollTimer);
    clearInterval(this.heartbeatTimer);
    this.pollTimer = this.heartbeatTimer = null;
    this.myZone = null;
    playersLayer.innerHTML = "";
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
    if (!this.zones.length) {
      const { data } = await sb.from("zones").select("*");
      this.zones = data ?? [];
    }
    const dev = params.get("devzone");
    if (dev) {
      const z = this.zones.find(z => z.id === dev);
      if (!z) throw new Error("unknown devzone: " + dev);
      console.warn("[rando] DEV zone override active:", z.name);
      return z;
    }
    let lat, lng;
    if (params.get("devlat") && params.get("devlng")) {
      lat = Number(params.get("devlat"));
      lng = Number(params.get("devlng"));
      console.warn("[rando] DEV coordinates override active");
    } else {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    }
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
    // same zone_id -> allowed by the trigger; just refreshes updated_at
    await sb.from("presence")
      .upsert({ user_id: session.user.id, zone_id: this.myZone.id });
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

  markerScale(y) {
    const t = Math.min(1, Math.max(0, (y - 40) / 40));
    return 11 + t * 15; // sprite height 11%..26% by depth
  },

  renderWorld(rows) {
    playersLayer.innerHTML = "";
    const byZone = new Map();
    for (const r of rows) {
      if (r.is_self) continue; // own character is the #player sprite
      if (!byZone.has(r.zone_id)) byZone.set(r.zone_id, []);
      byZone.get(r.zone_id).push(r);
    }
    for (const [zoneId, people] of byZone) {
      const zone = this.zones.find(z => z.id === zoneId);
      if (!zone) continue;
      people.forEach((p, i) => {
        // small index-based cluster offsets: same marker, gently fanned out;
        // server-side row shuffle means slots reshuffle every poll
        const dx = (i % 2 ? -1 : 1) * Math.ceil((i + 1) / 2) * 4;
        const el = document.createElement("div");
        el.className = "sprite remote";
        el.style.left = (Number(zone.marker_x) + dx) + "%";
        el.style.top = zone.marker_y + "%";
        el.style.height = this.markerScale(Number(zone.marker_y)) + "%";
        el.style.zIndex = String(Math.round(Number(zone.marker_y)));
        const src = outfitSrc(p.avatar);
        el.innerHTML =
          `<img class="cast" src="${src}" alt="" aria-hidden="true">` +
          '<div class="contact"></div>' +
          `<img class="char" src="${src}" alt="Player nearby">`;
        // natural staging: deterministic mirror + lean per cluster slot so
        // groups read as people hanging out, not a lineup facing the camera
        const lean = [-2.5, 1.5, -1.5, 2.5, 0][i % 5];
        const mirrored = i % 2 === 1;
        const charImg = el.querySelector("img.char");
        charImg.style.transform = (mirrored ? "scaleX(-1) " : "") + `rotate(${lean}deg)`;
        if (mirrored) {
          el.querySelector("img.cast").style.transform =
            "translateX(-50%) skewX(-29deg) scaleY(-0.22) scaleX(-1)";
        }
        playersLayer.appendChild(el);
      });
    }
    // own sprite: at my zone marker while open, hidden while closed
    if (this.myZone) {
      playerSprite.hidden = false;
      playerSprite.style.left = this.myZone.marker_x + "%";
      playerSprite.style.top = this.myZone.marker_y + "%";
      playerSprite.style.height = this.markerScale(Number(this.myZone.marker_y)) + "%";
      if (window.RandoCam) {
        // follow-cam: your avatar keeps its screen spot, the world moves
        window.RandoCam.follow(this.myZone.marker_x, this.myZone.marker_y);
      }
    } else {
      playerSprite.hidden = true;
      if (window.RandoCam) window.RandoCam.clearFollow();
    }
  },

  renderFreshness() {
    if (!this.lastFetch) return;
    zminEl.textContent = String(Math.round((Date.now() - this.lastFetch) / 60000));
  },

  renderToggle() {
    const signedOut = statusEl.hidden;
    openBtn.hidden = signedOut;
    if (signedOut) { playerSprite.hidden = false; return; } // pre-auth: decorative world
    if (this.myZone) {
      openBtn.classList.add("is-open");
      openBtn.title = "You're open · " + this.myZone.name + " — tap to go invisible";
      zoneNameEl.textContent = this.myZone.name;
    } else {
      openBtn.classList.remove("is-open");
      openBtn.title = "Go open";
      zoneNameEl.textContent = "invisible";
      playerSprite.hidden = true;
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
    document.querySelector("#match-card .mc-avatar").src = outfitSrc(this.partner.avatar);
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

  async openPanel() {
    if (!matching.activeMatch || !matching.partner) return;
    const { data: { session } } = await sb.auth.getSession();
    this.myId = session.user.id;
    cName.textContent = matching.partner.handle;
    cAvatar.src = outfitSrc(matching.partner.avatar);
    cBadge.textContent = "MATCHED · SAME ZONE";
    cThread.innerHTML = "";
    this.seen.clear();
    const { data: history } = await sb
      .from("messages")
      .select("*")
      .eq("match_id", matching.activeMatch.id)
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
    this.unsubscribe();
    matching.renderButton();
  },

  subscribe() {
    this.unsubscribe();
    const matchId = matching.activeMatch.id;
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
      .insert({ match_id: matching.activeMatch.id, sender: this.myId, body: text })
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) this.append(data); // optimistic; realtime echo deduped by id
  },
};

cForm.addEventListener("submit", async e => {
  e.preventDefault();
  const text = cInput.value.trim();
  if (!text || !matching.activeMatch) return;
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

  async refresh() {
    if (!matching.activeMatch) return;
    const { data, error } = await sb.rpc("encounter_status", { p_match: matching.activeMatch.id });
    if (error || !data || !data.length) return;
    this.render(data[0]);
  },

  render({ i_confirmed, encounter_complete }) {
    if (encounter_complete) {
      encBtn.hidden = true;
      encState.hidden = false;
      encState.className = "complete";
      encState.textContent = "\u{1F389} Encounter confirmed by both of you";
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
    const { error } = await sb.from("encounter_confirms")
      .insert({ match_id: matching.activeMatch.id, user_id: session.user.id });
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
chat.openPanel = async function () {
  await _openPanel();
  await encounter.refresh();
  encounter.startPolling();
};
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

// ===================== avatar / looks =====================
// profiles.avatar = {"look": "<category>__<key>"} drives how your character
// renders for everyone. Each look is a complete pose-consistent render —
// the source art is baked full characters, so hair/outfit/skin can't be
// mixed until the layered art pass. Others see changes on their next poll.

const LOOKS = [
  { id: "outfits__red-tank",          cat: "Outfit", label: "Red tank" },
  { id: "outfits__varsity-jacket",    cat: "Outfit", label: "Varsity" },
  { id: "outfits__green-hoodie",      cat: "Outfit", label: "Green hoodie" },
  { id: "outfits__navy-shirt-jacket", cat: "Outfit", label: "Navy jacket" },
  { id: "outfits__red-plaid-flannel", cat: "Outfit", label: "Flannel" },
  { id: "hair__asymmetric-spiky",     cat: "Hair",   label: "Spiky" },
  { id: "hair__bob-straight-bangs",   cat: "Hair",   label: "Bob bangs" },
  { id: "hair__bob-side-swept",       cat: "Hair",   label: "Side swept" },
  { id: "hair__long-straight-2",      cat: "Hair",   label: "Long" },
  { id: "skin__medium-tan",           cat: "Skin",   label: "Tan" },
  { id: "extras__headphones",         cat: "Extras", label: "Headphones" },
  { id: "extras__glasses",            cat: "Extras", label: "Glasses" },
];
const LOOK_CATS = ["Outfit", "Hair", "Skin", "Extras"];
const DEFAULT_LOOK = "outfits__red-tank";

export function outfitSrc(avatar) {
  let id = avatar && avatar.look;
  if (!id && avatar && avatar.outfit) id = "outfits__" + avatar.outfit; // legacy shape
  if (!LOOKS.some(l => l.id === id)) id = DEFAULT_LOOK;
  return "lit/looks/" + id + ".png";
}

const outfitBtn = document.getElementById("outfit-btn");
const outfitSheet = document.getElementById("outfit-sheet");
const outfitGrid = document.getElementById("outfit-grid");

export const avatar = {
  mine: { look: DEFAULT_LOOK },
  tab: "Outfit",

  async load() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data } = await sb.from("profiles").select("avatar").eq("id", session.user.id).maybeSingle();
    if (data && data.avatar) {
      const legacy = data.avatar.outfit ? "outfits__" + data.avatar.outfit : null;
      const id = data.avatar.look ?? legacy;
      this.mine = { look: LOOKS.some(l => l.id === id) ? id : DEFAULT_LOOK };
    }
    this.applyOwn();
    outfitBtn.hidden = false;
  },

  applyOwn() {
    const src = outfitSrc(this.mine);
    playerSprite.querySelector("img.char").src = src;
    playerSprite.querySelector("img.cast").src = src;
  },

  async pick(id) {
    this.mine = { look: id };
    this.applyOwn();
    this.renderGrid();
    const { data: { session } } = await sb.auth.getSession();
    await sb.from("profiles").update({ avatar: this.mine }).eq("id", session.user.id);
  },

  renderGrid() {
    // tabs
    const tabsEl = document.getElementById("outfit-tabs");
    tabsEl.innerHTML = "";
    for (const cat of LOOK_CATS) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "look-tab" + (this.tab === cat ? " active" : "");
      t.textContent = cat;
      t.addEventListener("click", () => { this.tab = cat; this.renderGrid(); });
      tabsEl.appendChild(t);
    }
    // grid for the active tab
    outfitGrid.innerHTML = "";
    for (const look of LOOKS.filter(l => l.cat === this.tab)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "outfit-thumb" + (this.mine.look === look.id ? " selected" : "");
      b.title = look.label;
      const img = document.createElement("img");
      img.src = "lit/looks/" + look.id + ".png";
      img.alt = look.label;
      b.appendChild(img);
      b.addEventListener("click", () => this.pick(look.id));
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

  async onSignedIn() {
    const { data: { session } } = await sb.auth.getSession();
    this.myId = session.user.id;
    pubEl.hidden = false;
    pubFeed.innerHTML = "";
    const { data } = await sb
      .from("public_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
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
        p => { this.addLine(p.new); this.bubble(p.new); })
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
    let host;
    if (m.sender === this.myId && !playerSprite.hidden) {
      host = playerSprite;
    } else {
      const zone = presence.zones.find(z => z.id === m.zone_id);
      if (!zone) return;
      host = document.createElement("div");
      host.className = "pub-anchor";
      host.style.left = zone.marker_x + "%";
      host.style.top = zone.marker_y + "%";
      host.style.height = presence.markerScale(Number(zone.marker_y)) + "%";
      document.getElementById("world").appendChild(host);
    }
    const b = document.createElement("div");
    b.className = "bubble public";
    b.textContent = m.body;
    host.appendChild(b);
    setTimeout(() => {
      b.classList.add("out");
      setTimeout(() => {
        b.remove();
        if (host.classList.contains("pub-anchor")) host.remove();
      }, 240);
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
};
const _pOnSignedOut = presence.onSignedOut.bind(presence);
presence.onSignedOut = function () {
  _pOnSignedOut();
  pubchat.onSignedOut();
  outfitBtn.hidden = true;
  outfitSheet.hidden = true;
};

sb.auth.onAuthStateChange(() => { refreshStatus(); });
refreshStatus();
