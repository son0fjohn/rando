// Rando backend client: Supabase auth (phone OTP) + profile.
// Loaded as an ES module by web/index.html.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  // light E.164 cleanup: strip spaces, dashes, parens
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
    return;
  }
  showAuth(false);
  // ensure a profile row exists even if signup predated the DB trigger
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
    await sb.auth.signOut();
  });
  statusEl.append(out);
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

sb.auth.onAuthStateChange(() => { refreshStatus(); });
refreshStatus();
