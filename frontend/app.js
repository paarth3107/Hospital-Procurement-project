const API_BASE = "/api/v1";

const state = {
  token: sessionStorage.getItem("token") || null,
  user: null,
};

function apiHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  return headers;
}

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: apiHeaders(options.headers),
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    // no body
  }
  if (!res.ok) {
    const message = (body && body.detail) || res.statusText;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return body;
}

function showResult(el, message, ok) {
  el.textContent = message;
  el.className = "result " + (ok ? "ok" : "err");
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "queue") loadVendors();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---- Vendor registration ----
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("register-result");
  try {
    const vendor = await api("/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, `Registered. Status: ${vendor.status}. You'll be notified once Procurement Admin reviews this.`, true);
    form.reset();
  } catch (err) {
    showResult(resultEl, "Could not register: " + err.message, false);
  }
});

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
    sessionStorage.setItem("token", state.token);
    state.user = await api("/auth/me");

    showResult(resultEl, `Logged in as ${state.user.full_name} (${state.user.role})`, true);
    document.getElementById("whoami").textContent = `${state.user.full_name} — ${state.user.role}`;
    document.getElementById("logout-btn").hidden = false;
    document.getElementById("queue-tab").hidden = false;
    switchView("queue");
  } catch (err) {
    showResult(resultEl, "Login failed: " + err.message, false);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem("token");
  document.getElementById("whoami").textContent = "";
  document.getElementById("logout-btn").hidden = true;
  document.getElementById("queue-tab").hidden = true;
  switchView("login");
});

// ---- Vendor approval queue ----
async function loadVendors() {
  const filter = document.getElementById("status-filter").value;
  const qs = filter ? `?status_filter=${filter}` : "";
  const tbody = document.querySelector("#vendor-table tbody");
  const resultEl = document.getElementById("queue-result");
  try {
    const vendors = await api("/vendors" + qs);
    tbody.innerHTML = "";
    if (vendors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#888;">No vendors in this status.</td></tr>';
    }
    for (const v of vendors) {
      const tr = document.createElement("tr");
      const decidable = v.status === "pending_verification" || v.status === "info_requested";
      tr.innerHTML = `
        <td>${v.legal_name}</td>
        <td>${v.gstin}</td>
        <td>${v.contact_person}<br><span style="color:#888;">${v.email}</span></td>
        <td><span class="status-pill status-${v.status}">${v.status.replace("_", " ")}</span></td>
        <td class="row-actions">
          ${decidable ? `<button class="approve" data-id="${v.id}" data-action="approve">Approve</button>
          <button class="reject" data-id="${v.id}" data-action="reject">Reject</button>
          <button data-id="${v.id}" data-action="request-info">Request Info</button>` : ""}
        </td>`;
      tbody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load vendors: " + err.message, false);
  }
}

document.getElementById("status-filter").addEventListener("change", loadVendors);
document.getElementById("refresh-btn").addEventListener("click", loadVendors);

document.querySelector("#vendor-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const resultEl = document.getElementById("queue-result");

  try {
    if (action === "reject") {
      const reason = prompt("Reason for rejection (required):");
      if (!reason || !reason.trim()) return;
      await api(`/vendors/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } else {
      await api(`/vendors/${id}/${action}`, { method: "POST" });
    }
    showResult(resultEl, `Vendor ${id}: ${action} applied.`, true);
    loadVendors();
  } catch (err) {
    showResult(resultEl, `Could not ${action} vendor ${id}: ` + err.message, false);
  }
});

// ---- Restore session on load ----
(async function init() {
  if (state.token) {
    try {
      state.user = await api("/auth/me");
      document.getElementById("whoami").textContent = `${state.user.full_name} — ${state.user.role}`;
      document.getElementById("logout-btn").hidden = false;
      document.getElementById("queue-tab").hidden = false;
    } catch (e) {
      state.token = null;
      sessionStorage.removeItem("token");
    }
  }
})();
