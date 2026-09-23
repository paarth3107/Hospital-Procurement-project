import { API_BASE, api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { switchView, showVendorDashboardTab } from "../nav.js";
import { VENDOR_DOC_TYPES } from "../constants.js";

// ---- Vendor login ----
document.getElementById("vendor-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("vendor-login-result");
  try {
    const body = new URLSearchParams({ username: data.gstin, password: data.password });
    const res = await fetch(API_BASE + "/vendor-auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || "Login failed");

    state.token = json.access_token;
    state.actorType = "vendor";
    sessionStorage.setItem("token", state.token);
    sessionStorage.setItem("actorType", "vendor");
    state.vendor = await api("/vendor-auth/me");

    showResult(resultEl, `Logged in as ${state.vendor.legal_name}`, true);
    document.getElementById("whoami").textContent = `${state.vendor.legal_name} — Vendor #${state.vendor.id}`;
    showVendorDashboardTab();
    await routeVendorAfterAuth();
  } catch (err) {
    showResult(resultEl, "Login failed: " + err.message, false);
  }
});

// Explicitly sends a vendor to upload documents (instead of the dashboard)
// whenever a mandatory one is still missing/unverified -- the tab always
// stays available either way (e.g. to replace an expiring license later),
// this only decides where login/session-restore lands them by default.
// Exported so main.js's session-restore can reuse the exact same logic.
export async function routeVendorAfterAuth() {
  const prompt = document.getElementById("vendor-documents-prompt");
  try {
    const docs = await api("/vendor-portal/documents");
    const byType = new Map(docs.map((d) => [d.doc_type, d]));
    const missing = VENDOR_DOC_TYPES.filter((t) => t.mandatory && (!byType.get(t.value) || byType.get(t.value).status !== "verified"));

    if (state.vendor.status !== "active" && missing.length > 0) {
      prompt.hidden = false;
      prompt.innerHTML = `<b>Please upload the following required document(s) before your registration can be approved:</b><ul>${missing
        .map((m) => `<li>${m.label}</li>`)
        .join("")}</ul>`;
      switchView("vendor-documents");
      return;
    }
    prompt.hidden = true;

    // First login/session-restore after becoming Active and not yet having
    // visited Categories -- send them there instead of the dashboard, per
    // explicit request ("thrown to categories after documents have been
    // approved"). Tracked client-side only; once visited it's just another
    // tab they can revisit whenever they want to change their selection.
    const seenCategories = localStorage.getItem(`categoriesSeen_${state.vendor.id}`);
    if (state.vendor.status === "active" && !seenCategories) {
      switchView("vendor-categories");
    } else {
      switchView("vendor-dashboard");
    }
  } catch (err) {
    switchView("vendor-dashboard");
  }
}
