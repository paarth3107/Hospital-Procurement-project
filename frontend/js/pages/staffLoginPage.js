import { API_BASE, api } from "../api.js";
import { state } from "../state.js";
import { showResult, setWhoami } from "../ui.js";
import { switchView, showStaffTabsForRole, DEFAULT_VIEW_BY_ROLE } from "../nav.js";

// ---- Staff login ----
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("login-result");
  try {
    const body = new URLSearchParams({ username: data.email, password: data.password });
    const res = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || "Login failed");

    state.token = json.access_token;
    state.actorType = "staff";
    sessionStorage.setItem("token", state.token);
    sessionStorage.setItem("actorType", "staff");
    state.user = await api("/auth/me");

    showResult(resultEl, `Logged in as ${state.user.full_name} (${state.user.role})`, true);
    setWhoami(state.user.full_name, state.user.role.replace(/_/g, " "));
    showStaffTabsForRole(state.user.role);
    switchView(DEFAULT_VIEW_BY_ROLE[state.user.role] || "tenders");
  } catch (err) {
    showResult(resultEl, "Login failed: " + err.message, false);
  }
});
