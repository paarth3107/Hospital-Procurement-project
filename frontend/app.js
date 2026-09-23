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
  if (view === "catalog") loadProducts();
  if (view === "mappings") {
    populateMappingPickers();
    renderMappingMatrix();
    loadMappings();
  }
  if (view === "ratings") populateRatingPicker();
  if (view === "tenders") loadTenders();
  if (view === "approvals") loadApprovals();
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
    showResult(resultEl, `Registered as Vendor #${vendor.id}. Status: ${vendor.status}. Keep this ID — Procurement staff will reference it for catalog mapping and rating. You'll be notified once Procurement Admin reviews this.`, true);
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
    showStaffTabsForRole(state.user.role);
    switchView(DEFAULT_VIEW_BY_ROLE[state.user.role] || "tenders");
  } catch (err) {
    showResult(resultEl, "Login failed: " + err.message, false);
  }
});

// Which nav tabs are useful to each role, driven by what that role can
// actually do server-side (see backend/README.md's role tables) — not just
// "logged in staff sees everything". Kept in one place so a new tab only
// needs one line here, not a scattered set of if/role checks.
const ROLE_TABS = {
  procurement_officer: ["tenders"],
  category_manager: ["catalog", "mappings", "ratings"],
  procurement_admin: ["queue", "catalog", "mappings", "ratings", "tenders", "approvals"],
  approving_authority: ["approvals"],
  system_admin: ["queue", "catalog", "mappings", "ratings", "tenders", "approvals"],
};
const DEFAULT_VIEW_BY_ROLE = {
  procurement_officer: "tenders",
  category_manager: "catalog",
  procurement_admin: "queue",
  approving_authority: "approvals",
  system_admin: "queue",
};
const ALL_STAFF_TAB_VIEWS = ["queue", "catalog", "mappings", "ratings", "tenders", "approvals"];

function showStaffTabsForRole(role) {
  document.getElementById("register-tab").hidden = true;
  document.getElementById("login-tab").hidden = true;
  document.getElementById("logout-btn").hidden = false;
  const allowed = new Set(ROLE_TABS[role] || []);
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = !allowed.has(view);
  }
  // Only Procurement Admin can save manual ratings server-side (see
  // ratings.py's require_role) — everyone else on the Ratings tab gets a
  // read-only lookup instead of a form that would just 403 on submit.
  document.getElementById("rating-update-form").hidden = role !== "procurement_admin";
}

function hideStaffTabs() {
  document.getElementById("register-tab").hidden = false;
  document.getElementById("login-tab").hidden = false;
  document.getElementById("logout-btn").hidden = true;
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
}

document.getElementById("logout-btn").addEventListener("click", () => {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem("token");
  document.getElementById("whoami").textContent = "";
  hideStaffTabs();
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
      tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">No vendors in this status.</td></tr>';
    }
    for (const v of vendors) {
      const tr = document.createElement("tr");
      const decidable = v.status === "pending_verification" || v.status === "info_requested";
      tr.innerHTML = `
        <td>#${v.id}</td>
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

// ---- Product catalog ----
document.getElementById("add-product-btn").addEventListener("click", () => {
  const form = document.getElementById("product-form");
  form.hidden = !form.hidden;
  document.getElementById("add-product-btn").textContent = form.hidden ? "+ Add Item" : "Cancel";
});

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("product-result");
  try {
    const product = await api("/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, `Added catalog entry #${product.id}: ${product.name}`, true);
    form.reset();
    form.hidden = true;
    document.getElementById("add-product-btn").textContent = "+ Add Item";
    loadProducts();
  } catch (err) {
    showResult(resultEl, "Could not add catalog entry: " + err.message, false);
  }
});

async function loadProducts() {
  const tbody = document.querySelector("#product-table tbody");
  const resultEl = document.getElementById("product-result");
  try {
    const products = await api("/products");
    tbody.innerHTML = "";
    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">No catalog entries yet.</td></tr>';
    }
    for (const p of products) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.code} <span style="color:#888;">(#${p.id})</span></td>
        <td>${p.name}</td>
        <td>${p.procurement_type}</td>
        <td>${p.category}</td>
        <td>${p.active ? "Yes" : "No"}</td>
        <td class="row-actions">
          <button data-id="${p.id}" data-action="${p.active ? "deactivate" : "activate"}">${p.active ? "Deactivate" : "Activate"}</button>
        </td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    showResult(resultEl, "Could not load catalog: " + err.message, false);
  }
}

document.querySelector("#product-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const resultEl = document.getElementById("product-result");
  try {
    await api(`/products/${btn.dataset.id}/${btn.dataset.action}`, { method: "POST" });
    loadProducts();
  } catch (err) {
    showResult(resultEl, `Could not ${btn.dataset.action} catalog entry: ` + err.message, false);
  }
});

// ---- Vendor mapping ----

document.getElementById("add-mapping-btn").addEventListener("click", () => {
  const form = document.getElementById("mapping-form");
  form.hidden = !form.hidden;
  document.getElementById("add-mapping-btn").textContent = form.hidden ? "+ Request Mapping" : "Cancel";
});

// Populates the Vendor/Catalog Entry <select> pickers so nobody has to
// memorize or type a raw ID. Vendor picker is Active-only, matching CLAUDE.md
// PROJECT OVERRIDE (only Active vendors can ever be mapped).
async function populateMappingPickers() {
  const vendorSelect = document.querySelector('#mapping-form select[name="vendor_id"]');
  const productSelect = document.querySelector('#mapping-form select[name="product_master_id"]');
  try {
    const [vendors, products] = await Promise.all([api("/vendors/lookup?status_filter=active"), api("/products?active=true")]);
    vendorSelect.innerHTML =
      '<option value="">— select a vendor —</option>' +
      vendors.map((v) => `<option value="${v.id}">${v.legal_name} (#${v.id})</option>`).join("");
    productSelect.innerHTML =
      '<option value="">— select a catalog entry —</option>' +
      products.map((p) => `<option value="${p.id}">${p.code} — ${p.name} (#${p.id})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("mapping-result"), "Could not load vendor/catalog pickers: " + err.message, false);
  }
}

document.getElementById("mapping-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("mapping-result");
  try {
    const mapping = await api("/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor_id: Number(data.vendor_id), product_master_id: Number(data.product_master_id) }),
    });
    showResult(resultEl, `Mapping #${mapping.id} requested (state: ${mapping.state}).`, true);
    form.reset();
    form.hidden = true;
    document.getElementById("add-mapping-btn").textContent = "+ Request Mapping";
    renderMappingMatrix();
    loadMappings();
  } catch (err) {
    showResult(resultEl, "Could not request mapping: " + err.message, false);
  }
});

function renderMappingRows(mappings, vendorName, productName) {
  const tbody = document.querySelector("#mapping-table tbody");
  tbody.innerHTML = "";
  if (mappings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#888;">No mappings match.</td></tr>';
    return;
  }
  for (const m of mappings) {
    const tr = document.createElement("tr");
    const pending = m.state === "pending";
    const approved = m.state === "approved";
    tr.innerHTML = `
      <td>${vendorName.get(m.vendor_id) || "—"} <span style="color:#888;">(#${m.vendor_id})</span></td>
      <td>${productName.get(m.product_master_id) || "—"} <span style="color:#888;">(#${m.product_master_id})</span></td>
      <td><span class="status-pill status-${m.state === "approved" ? "active" : m.state === "rejected" || m.state === "suspended" ? "rejected" : "pending_verification"}">${m.state}</span></td>
      <td>${m.version}</td>
      <td class="row-actions">
        ${pending ? `<button class="approve" data-id="${m.id}" data-action="approve">Approve</button>
        <button class="reject" data-id="${m.id}" data-action="reject">Reject</button>` : ""}
        ${approved ? `<button class="reject" data-id="${m.id}" data-action="suspend">Suspend</button>` : ""}
      </td>`;
    tbody.appendChild(tr);
  }
}

function clearMappingFilter() {
  document.getElementById("mapping-filter-note").hidden = true;
  loadMappings();
}

async function loadMappings() {
  const filter = document.getElementById("mapping-state-filter").value;
  const qs = filter ? `?state=${filter}` : "";
  const resultEl = document.getElementById("mapping-result");
  try {
    const [mappings, vendors, products] = await Promise.all([
      api("/mappings" + qs),
      api("/vendors/lookup"),
      api("/products"),
    ]);
    const vendorName = new Map(vendors.map((v) => [v.id, v.legal_name]));
    const productName = new Map(products.map((p) => [p.id, `${p.code} — ${p.name}`]));
    renderMappingRows(mappings, vendorName, productName);
  } catch (err) {
    showResult(resultEl, "Could not load mappings: " + err.message, false);
  }
}

document.getElementById("mapping-state-filter").addEventListener("change", loadMappings);
document.getElementById("mapping-refresh-btn").addEventListener("click", loadMappings);

document.querySelector("#mapping-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { id, action } = btn.dataset;
  const resultEl = document.getElementById("mapping-result");
  try {
    if (action === "reject" || action === "suspend") {
      const reason = prompt(`Reason for ${action} (required):`);
      if (!reason || !reason.trim()) return;
      await api(`/mappings/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } else {
      await api(`/mappings/${id}/${action}`, { method: "POST" });
    }
    renderMappingMatrix();
    loadMappings();
  } catch (err) {
    showResult(resultEl, `Could not ${action} mapping ${id}: ` + err.message, false);
  }
});

// Vendor–Product Eligibility Matrix (wireframe: VendorMappingMatrix). Our
// data model maps a vendor to one catalog entry at a time, not a whole
// category, so each cell aggregates every mapping between that vendor and
// any catalog entry in that category, showing the most decisive state
// (an approved mapping outranks a merely-pending one, etc). Clicking a cell
// filters the detail table below to exactly those mapping rows.
const MAPPING_STATE_PRIORITY = ["approved", "pending", "suspended", "rejected"];

async function renderMappingMatrix() {
  const container = document.getElementById("mapping-matrix");
  try {
    const [vendors, products, mappings] = await Promise.all([api("/vendors/lookup"), api("/products"), api("/mappings")]);

    const categories = [];
    const categoryType = new Map();
    const productsInCategory = new Map();
    for (const p of products) {
      if (!categoryType.has(p.category)) {
        categories.push(p.category);
        categoryType.set(p.category, p.procurement_type);
        productsInCategory.set(p.category, []);
      }
      productsInCategory.get(p.category).push(p.id);
    }

    if (vendors.length === 0 || categories.length === 0) {
      container.innerHTML = '<div style="padding:16px; color:#888; font-size:13px;">Add vendors and catalog entries first to see the eligibility matrix.</div>';
      return;
    }

    // vendor_id -> product_master_id -> mapping, for cell aggregation below.
    const mappingsByVendorProduct = new Map();
    for (const m of mappings) {
      if (!mappingsByVendorProduct.has(m.vendor_id)) mappingsByVendorProduct.set(m.vendor_id, new Map());
      mappingsByVendorProduct.get(m.vendor_id).set(m.product_master_id, m);
    }

    const vendorScores = await Promise.all(
      vendors.map((v) =>
        api(`/ratings/${v.id}`)
          .then((r) => (r.is_provisional ? null : r.overall_score))
          .catch(() => null)
      )
    );

    const gridCols = `2.2fr repeat(${categories.length}, 1fr)`;
    let html = `<div class="matrix-row matrix-head" style="grid-template-columns: ${gridCols};">
      <div class="matrix-vendor">VENDOR</div>
      ${categories
        .map((c) => `<div class="matrix-col-head">${c}<span class="type">${categoryType.get(c)}</span></div>`)
        .join("")}
    </div>`;

    vendors.forEach((v, i) => {
      const score = vendorScores[i];
      html += `<div class="matrix-row" style="grid-template-columns: ${gridCols};">
        <div class="matrix-vendor"><div class="name">${v.legal_name}</div><div class="score">${
          v.status !== "active" ? v.status.replace("_", " ") : score !== null ? `score ${score.toFixed(1)}` : "unrated"
        }</div></div>
        ${categories
          .map((c) => {
            const ids = productsInCategory.get(c);
            const vendorMap = mappingsByVendorProduct.get(v.id);
            let state = null;
            if (vendorMap) {
              for (const pid of ids) {
                const m = vendorMap.get(pid);
                if (!m) continue;
                if (state === null || MAPPING_STATE_PRIORITY.indexOf(m.state) < MAPPING_STATE_PRIORITY.indexOf(state)) {
                  state = m.state;
                }
              }
            }
            const label = state ? state.toUpperCase() : "—";
            return `<div class="matrix-cell cell-${state || "none"}" data-vendor-id="${v.id}" data-category="${c}">${label}</div>`;
          })
          .join("")}
      </div>`;
    });

    html += `<div class="matrix-legend">
      <span><b style="color:#2f5f2f;">APPROVED</b> — active, eligible mapping</span>
      <span><b style="color:#8a5215;">PENDING</b> — requested, review open</span>
      <span><b style="color:#666;">SUSPENDED</b> — was approved, temporarily paused</span>
      <span><b style="color:#8a3f3f;">REJECTED</b></span>
      <span>— not mapped (click to map &amp; approve directly)</span>
    </div>`;

    container.innerHTML = html;

    const vendorById = new Map(vendors.map((v) => [v.id, v]));
    const productById = new Map(products.map((p) => [p.id, p]));

    container.querySelectorAll(".matrix-cell:not(.cell-none)").forEach((cell) => {
      cell.addEventListener("click", () => {
        const vendorId = Number(cell.dataset.vendorId);
        const category = cell.dataset.category;
        const ids = new Set(productsInCategory.get(category));
        const filtered = mappings.filter((m) => m.vendor_id === vendorId && ids.has(m.product_master_id));
        const vendorNameMap = new Map(vendors.map((vv) => [vv.id, vv.legal_name]));
        const productNameMap = new Map(products.map((p) => [p.id, `${p.code} — ${p.name}`]));
        renderMappingRows(filtered, vendorNameMap, productNameMap);
        const note = document.getElementById("mapping-filter-note");
        note.hidden = false;
        const vendorLabel = vendorNameMap.get(vendorId) || `#${vendorId}`;
        note.innerHTML = `<span>Showing mappings for <b>${vendorLabel}</b> — <b>${category}</b></span>`;
        const clearBtn = document.createElement("button");
        clearBtn.textContent = "Clear filter";
        clearBtn.addEventListener("click", clearMappingFilter);
        note.appendChild(clearBtn);
      });
    });

    // Empty cells: this screen is only reachable by Category Manager /
    // Procurement Admin / System Admin (the same roles that already approve
    // mappings), so a click here creates AND approves in one step instead of
    // going through the Pending-review queue -- that queue is for when a
    // vendor requests eligibility themselves, not for staff mapping vendors
    // directly on their own authority.
    container.querySelectorAll(".matrix-cell.cell-none").forEach((cell) => {
      cell.addEventListener("click", () => directMapVendorToCategory(cell, vendorById, productById));
    });
  } catch (err) {
    container.innerHTML = `<div class="result err">Could not load eligibility matrix: ${err.message}</div>`;
  }
}

async function directMapVendorToCategory(cell, vendorById, productById) {
  const vendorId = Number(cell.dataset.vendorId);
  const category = cell.dataset.category;
  const vendor = vendorById.get(vendorId);
  const resultEl = document.getElementById("mapping-result");

  if (!vendor || vendor.status !== "active") {
    alert(`${vendor ? vendor.legal_name : "This vendor"} isn't Active yet -- only an Active, approved vendor can be mapped (CLAUDE.md PROJECT OVERRIDE).`);
    return;
  }

  const candidates = [...productById.values()].filter((p) => p.category === category).map((p) => p.id);
  let productId;
  if (candidates.length === 1) {
    productId = candidates[0];
  } else {
    const options = candidates.map((id, i) => `${i + 1}. ${productById.get(id).code} — ${productById.get(id).name}`).join("\n");
    const choice = prompt(`Multiple catalog entries in "${category}" -- which one?\n${options}`);
    const idx = Number(choice) - 1;
    if (!choice || idx < 0 || idx >= candidates.length) return;
    productId = candidates[idx];
  }
  const product = productById.get(productId);

  if (!confirm(`Map ${vendor.legal_name} to "${product.name}" and approve immediately?`)) return;

  try {
    const mapping = await api("/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor_id: vendorId, product_master_id: productId }),
    });
    await api(`/mappings/${mapping.id}/approve`, { method: "POST" });
    showResult(resultEl, `Mapped ${vendor.legal_name} to ${product.name} and approved.`, true);
    renderMappingMatrix();
    loadMappings();
  } catch (err) {
    showResult(resultEl, "Could not create mapping: " + err.message, false);
  }
}

// ---- Vendor rating ----
let currentRatingVendorId = null;

// Every vendor (any status) shows up here — a rating can still be looked up
// for a vendor that's since been suspended, unlike the Mapping picker which
// is deliberately Active-only.
async function populateRatingPicker() {
  const select = document.querySelector('#rating-lookup-form select[name="vendor_id"]');
  try {
    const vendors = await api("/vendors/lookup");
    select.innerHTML =
      '<option value="">— select a vendor —</option>' +
      vendors.map((v) => `<option value="${v.id}">${v.legal_name} (#${v.id})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("rating-result"), "Could not load vendor picker: " + err.message, false);
  }
}

document.getElementById("rating-lookup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const vendorId = Number(new FormData(e.target).get("vendor_id"));
  currentRatingVendorId = vendorId;
  await loadRating();
});

async function loadRating() {
  const resultEl = document.getElementById("rating-result");
  const card = document.getElementById("rating-card");
  try {
    const rating = await api(`/ratings/${currentRatingVendorId}`);
    const fmt = (v) => (v === null || v === undefined ? "— not entered —" : v);
    document.querySelector("#rating-summary tbody").innerHTML = `
      <tr><th>Overall Score</th><td>${rating.overall_score.toFixed(1)} ${rating.is_provisional ? '<span class="status-pill status-pending_verification">Provisional</span>' : ""}</td></tr>
      <tr><th>Price Competitiveness (system)</th><td>${rating.price_competitiveness}</td></tr>
      <tr><th>On-time Delivery %</th><td>${fmt(rating.on_time_pct)}</td></tr>
      <tr><th>Quality Acceptance Rate %</th><td>${fmt(rating.quality_pct)}</td></tr>
      <tr><th>Compliance Currency %</th><td>${fmt(rating.compliance_pct)}</td></tr>
      <tr><th>Responsiveness %</th><td>${fmt(rating.responsiveness)}</td></tr>
      <tr><th>Last Manual Update</th><td>${rating.last_manual_update_at || "never"}</td></tr>
    `;
    const history = await api(`/ratings/${currentRatingVendorId}/history`);
    const historyBody = document.querySelector("#rating-history-table tbody");
    historyBody.innerHTML = history.length
      ? ""
      : '<tr><td colspan="5" style="color:#888;">No manual entries yet.</td></tr>';
    for (const h of history.slice().reverse()) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${h.field}</td><td>${h.old_value ?? "—"}</td><td>${h.new_value}</td><td>${h.comment || ""}</td><td>${h.entered_at}</td>`;
      historyBody.appendChild(tr);
    }
    card.hidden = false;
    resultEl.textContent = "";
  } catch (err) {
    card.hidden = true;
    showResult(resultEl, "Could not load rating: " + err.message, false);
  }
}

document.getElementById("rating-update-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {};
  for (const field of ["on_time_pct", "quality_pct", "compliance_pct", "responsiveness"]) {
    if (data[field] !== "") payload[field] = Number(data[field]);
  }
  if (data.comment) payload.comment = data.comment;
  const resultEl = document.getElementById("rating-result");
  try {
    await api(`/ratings/${currentRatingVendorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, "Manual ratings saved.", true);
    form.reset();
    loadRating();
  } catch (err) {
    showResult(resultEl, "Could not save ratings: " + err.message, false);
  }
});

// ---- Tenders ----
let currentTenderId = null;

document.getElementById("add-tender-btn").addEventListener("click", () => {
  const form = document.getElementById("tender-form");
  form.hidden = !form.hidden;
  document.getElementById("add-tender-btn").textContent = form.hidden ? "+ New Tender" : "Cancel";
});

document.getElementById("tender-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    facility_id: Number(data.facility_id),
    title: data.title,
    description: data.description || null,
    tender_type: data.tender_type,
    department: data.department || null,
    min_rating_threshold: data.min_rating_threshold ? Number(data.min_rating_threshold) : 0,
    max_invites: data.max_invites ? Number(data.max_invites) : null,
    bid_due_date: data.bid_due_date ? new Date(data.bid_due_date).toISOString() : null,
  };
  const resultEl = document.getElementById("tender-result");
  try {
    const tender = await api("/tenders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, `Created draft tender #${tender.id}: ${tender.title}`, true);
    form.reset();
    form.hidden = true;
    document.getElementById("add-tender-btn").textContent = "+ New Tender";
    loadTenders();
  } catch (err) {
    showResult(resultEl, "Could not create tender: " + err.message, false);
  }
});

async function loadTenders() {
  const tbody = document.querySelector("#tender-table tbody");
  const resultEl = document.getElementById("tender-result");
  try {
    const tenders = await api("/tenders");
    tbody.innerHTML = "";
    if (tenders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">No tenders yet.</td></tr>';
    }
    for (const t of tenders) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.id}</td>
        <td>${t.title}</td>
        <td>${t.tender_type}</td>
        <td><span class="status-pill status-${t.status === "published" ? "active" : t.status === "withdrawn" ? "rejected" : "pending_verification"}">${t.status}</span></td>
        <td>${t.round_number}</td>
        <td class="row-actions"><button data-id="${t.id}" data-action="select">Manage</button></td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    showResult(resultEl, "Could not load tenders: " + err.message, false);
  }
}

document.querySelector("#tender-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='select']");
  if (!btn) return;
  currentTenderId = Number(btn.dataset.id);
  document.getElementById("tender-detail").hidden = false;
  document.getElementById("tender-detail-title").textContent = `Tender #${currentTenderId}`;
  loadLineItems();
  loadRounds();
  document.getElementById("eligibility-preview").innerHTML = "";
});

document.getElementById("line-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    product_master_id: Number(data.product_master_id),
    procurement_type: data.procurement_type,
    qty: Number(data.qty),
    estimated_price: data.estimated_price ? Number(data.estimated_price) : null,
  };
  const resultEl = document.getElementById("tender-result");
  try {
    await api(`/tenders/${currentTenderId}/line-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    loadLineItems();
  } catch (err) {
    showResult(resultEl, "Could not add line item: " + err.message, false);
  }
});

async function loadLineItems() {
  const tbody = document.querySelector("#line-item-table tbody");
  const items = await api(`/tenders/${currentTenderId}/line-items`);
  tbody.innerHTML = items.length
    ? ""
    : '<tr><td colspan="4" style="color:#888;">No line items yet.</td></tr>';
  for (const li of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${li.product_master_id}</td><td>${li.procurement_type}</td><td>${li.qty}</td><td>${li.estimated_price ?? "—"}</td>`;
    tbody.appendChild(tr);
  }
}

async function loadRounds() {
  const tbody = document.querySelector("#round-table tbody");
  const rounds = await api(`/tenders/${currentTenderId}/approval-rounds`);
  tbody.innerHTML = rounds.length
    ? ""
    : '<tr><td colspan="4" style="color:#888;">Not submitted yet.</td></tr>';
  for (const r of rounds.slice().reverse()) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.round_number}</td><td>${r.decision}</td><td>${r.required_tier}</td><td>${r.comments || ""}</td>`;
    tbody.appendChild(tr);
  }
}

document.getElementById("preview-eligibility-btn").addEventListener("click", async () => {
  const el = document.getElementById("eligibility-preview");
  try {
    const preview = await api(`/tenders/${currentTenderId}/eligibility-preview`);
    el.innerHTML = preview
      .map(
        (p) =>
          `<p><strong>Line item #${p.line_item_id}</strong> (threshold ${p.threshold_applied}): ${
            p.eligible_vendors.length
              ? p.eligible_vendors.map((v) => `${v.legal_name} (score ${v.rating_score})`).join(", ")
              : '<span style="color:#a33;">zero eligible vendors — submission will be blocked</span>'
          }</p>`
      )
      .join("");
  } catch (err) {
    el.textContent = "Could not load eligibility preview: " + err.message;
  }
});

document.getElementById("submit-tender-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("tender-result");
  try {
    await api(`/tenders/${currentTenderId}/submit-for-approval`, { method: "POST" });
    showResult(resultEl, `Tender #${currentTenderId} submitted for E-Tender Approval.`, true);
    loadTenders();
    loadRounds();
  } catch (err) {
    showResult(resultEl, "Could not submit for approval: " + err.message, false);
  }
});

// ---- E-Tender Approval ----
async function loadApprovals() {
  const tbody = document.querySelector("#approval-table tbody");
  const resultEl = document.getElementById("approval-result");
  try {
    const tenders = await api("/tenders?status_filter=pending_approval");
    tbody.innerHTML = "";
    if (tenders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#888;">Nothing pending approval.</td></tr>';
    }
    for (const t of tenders) {
      const rounds = await api(`/tenders/${t.id}/approval-rounds`);
      const current = rounds.find((r) => r.round_number === t.round_number);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${t.id}</td>
        <td>${t.title}</td>
        <td>${t.round_number}</td>
        <td>${current ? current.required_tier : "—"}</td>
        <td class="row-actions">
          <button class="approve" data-id="${t.id}" data-action="approve">Approve &amp; Publish</button>
          <button class="reject" data-id="${t.id}" data-action="reject">Reject</button>
        </td>`;
      tbody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load approval queue: " + err.message, false);
  }
}

document.getElementById("approvals-refresh-btn").addEventListener("click", loadApprovals);

document.querySelector("#approval-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { id, action } = btn.dataset;
  const resultEl = document.getElementById("approval-result");
  try {
    if (action === "reject") {
      const comments = prompt("Comments for rejection (required):");
      if (!comments || !comments.trim()) return;
      await api(`/tenders/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments }),
      });
    } else {
      await api(`/tenders/${id}/approve`, { method: "POST" });
    }
    loadApprovals();
  } catch (err) {
    showResult(resultEl, `Could not ${action} tender ${id}: ` + err.message, false);
  }
});

// ---- Restore session on load ----
(async function init() {
  if (state.token) {
    try {
      state.user = await api("/auth/me");
      document.getElementById("whoami").textContent = `${state.user.full_name} — ${state.user.role}`;
      showStaffTabsForRole(state.user.role);
      switchView(DEFAULT_VIEW_BY_ROLE[state.user.role] || "tenders");
    } catch (e) {
      state.token = null;
      sessionStorage.removeItem("token");
    }
  }
})();
