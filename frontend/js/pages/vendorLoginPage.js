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

// Every vendor lands on the dashboard; its status notice says what to do
// next (verification pending -> categories -> tenders). Exported so main.js's
// session-restore reuses the same entry point.
export async function routeVendorAfterAuth() {
  switchView("vendor-dashboard");
}
