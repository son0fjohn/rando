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
const SNAP_MAX_METERS = 3000;        // outside launch area -> not in world

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

  // ON-DEVICE zone snap: coordinates are read locally and only compared
  // against public zone centers; they never leave this function.
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
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000 }));
    let best = null, bestD = Infinity;
    for (const z of this.zones) {
      const d = this.haversine(pos.coords.latitude, pos.coords.longitude, z.lat, z.lng);
      if (d < bestD) { best = z; bestD = d; }
    }
    if (bestD > SNAP_MAX_METERS) throw new Error("You're outside the Itaewon launch area");
    return best;
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
        el.innerHTML =
          '<img class="cast" src="lit/player.png" alt="" aria-hidden="true">' +
          '<div class="contact"></div>' +
          '<img class="char" src="lit/player.png" alt="Player nearby">';
        playersLayer.appendChild(el);
      });
    }
    // own sprite: at my zone marker while open, hidden while closed
    if (this.myZone) {
      playerSprite.hidden = false;
      playerSprite.style.left = this.myZone.marker_x + "%";
      playerSprite.style.top = this.myZone.marker_y + "%";
      playerSprite.style.height = this.markerScale(Number(this.myZone.marker_y)) + "%";
    } else {
      playerSprite.hidden = true;
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
      openBtn.textContent = "You're open · " + this.myZone.name + " — go invisible";
      openBtn.classList.add("is-open");
      zoneNameEl.textContent = this.myZone.name;
    } else {
      openBtn.textContent = "Go open";
      openBtn.classList.remove("is-open");
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
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    openBtn.disabled = false;
  }
});

sb.auth.onAuthStateChange(() => { refreshStatus(); });
refreshStatus();
