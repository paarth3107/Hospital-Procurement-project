const API_BASE = "/api/v1";

const state = {
  token: sessionStorage.getItem("token") || null,
  actorType: sessionStorage.getItem("actorType") || null, // "staff" | "vendor"
  user: null,
  vendor: null,
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

// ---- In-page modal (replaces native prompt()/confirm()/alert()) ----
// openModal() is the primitive; modalPrompt/modalConfirm/modalAlert/modalChoose
// below mirror the native functions' call shape so every existing call site
// only needed `await` added in front of it.
function openModal({ title, message, type = "confirm", placeholder = "", options = [], danger = false, confirmLabel = "Confirm" }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-overlay");
    const body = document.getElementById("modal-body");
    const confirmBtn = document.getElementById("modal-confirm-btn");
    const cancelBtn = document.getElementById("modal-cancel-btn");

    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-message").textContent = message || "";
    body.innerHTML = "";
    cancelBtn.hidden = type === "alert";
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle("danger", danger);

    let inputEl = null;
    if (type === "text") {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.placeholder = placeholder;
      body.appendChild(inputEl);
    } else if (type === "choice") {
      inputEl = document.createElement("select");
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        inputEl.appendChild(o);
      }
      body.appendChild(inputEl);
    }

    function cleanup(result) {
      overlay.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("mousedown", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onConfirm() {
      if (type === "text") {
        const val = inputEl.value.trim();
        if (!val) {
          inputEl.focus();
          return;
        }
        cleanup(val);
      } else if (type === "choice") {
        cleanup(inputEl.value);
      } else {
        cleanup(true);
      }
    }
    function onCancel() {
      cleanup(type === "text" || type === "choice" ? null : false);
    }
    function onOverlayClick(e) {
      if (e.target === overlay) onCancel();
    }
    function onKeydown(e) {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter" && type !== "choice") onConfirm();
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("mousedown", onOverlayClick);
    document.addEventListener("keydown", onKeydown);

    overlay.hidden = false;
    (inputEl || confirmBtn).focus();
  });
}

const modalPrompt = (message, placeholder = "") => openModal({ title: "Input required", message, type: "text", placeholder });
const modalConfirm = (message, opts = {}) => openModal({ title: opts.title || "Please confirm", message, type: "confirm", confirmLabel: opts.confirmLabel || "Confirm", danger: opts.danger });
const modalAlert = (message, title = "Notice") => openModal({ title, message, type: "alert", confirmLabel: "OK" });
const modalChoose = (message, options, title = "Choose one") => openModal({ title, message, type: "choice", options });

function switchView(view) {
  document.querySelectorAll(".view").forEach((el) => (el.hidden = true));
  document.getElementById("view-" + view).hidden = false;
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  if (view === "dashboard") loadDashboard();
  if (view === "queue") loadVendors();
  if (view === "catalog") loadProducts();
  if (view === "request-mapping") populateVendorMappingRequestPicker();
  if (view === "mappings") {
    renderMappingMatrix();
    loadMappings();
  }
  if (view === "ratings") {
    populateRatingPicker();
    renderRatingDashboard();
  }
  if (view === "vendor-dashboard") loadVendorDashboard();
  if (view === "vendor-documents") renderVendorDocuments();
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
    showResult(resultEl, `Registered as Vendor #${vendor.id}. Next: log in with the GSTIN and password you just set, then upload your required documents (GST Certificate, PAN Card, Certificate of Incorporation) — your registration can't be reviewed until those are in.`, true);
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
    state.actorType = "staff";
    sessionStorage.setItem("token", state.token);
    sessionStorage.setItem("actorType", "staff");
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
  procurement_officer: ["dashboard", "tenders"],
  category_manager: ["dashboard", "queue", "catalog", "mappings", "ratings"],
  procurement_admin: ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals"],
  approving_authority: ["dashboard", "approvals"],
  system_admin: ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals"],
};
const DEFAULT_VIEW_BY_ROLE = {
  procurement_officer: "dashboard",
  category_manager: "dashboard",
  procurement_admin: "dashboard",
  approving_authority: "dashboard",
  system_admin: "dashboard",
};
const ALL_STAFF_TAB_VIEWS = ["dashboard", "queue", "catalog", "mappings", "ratings", "tenders", "approvals"];

// The three unauthenticated (public) tabs and the one vendor-only tab, kept
// alongside the staff tab list so every login/logout path can reset the nav
// to exactly one of three states: logged out, staff, or vendor.
const PUBLIC_TAB_VIEWS = ["register", "request-mapping", "vendor-login", "login"];

function showStaffTabsForRole(role) {
  for (const view of PUBLIC_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
  document.getElementById("vendor-dashboard-tab").hidden = true;
  document.getElementById("vendor-documents-tab").hidden = true;
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

function showVendorDashboardTab() {
  for (const view of PUBLIC_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
  document.getElementById("vendor-dashboard-tab").hidden = false;
  document.getElementById("vendor-documents-tab").hidden = false;
  document.getElementById("logout-btn").hidden = false;
}

function resetToLoggedOutNav() {
  for (const view of PUBLIC_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = false;
  }
  document.getElementById("vendor-dashboard-tab").hidden = true;
  document.getElementById("vendor-documents-tab").hidden = true;
  document.getElementById("logout-btn").hidden = true;
  for (const view of ALL_STAFF_TAB_VIEWS) {
    document.getElementById(`${view}-tab`).hidden = true;
  }
}

document.getElementById("logout-btn").addEventListener("click", () => {
  state.token = null;
  state.actorType = null;
  state.user = null;
  state.vendor = null;
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("actorType");
  document.getElementById("whoami").textContent = "";
  resetToLoggedOutNav();
  switchView("register");
});

// ---- Dashboard ----
async function loadDashboard() {
  const resultEl = document.getElementById("dashboard-result");
  try {
    const stats = await api("/dashboard/stats");
    document.getElementById("stat-open-tenders").textContent = stats.open_tenders_count;
    document.getElementById("stat-pending-approval").textContent = stats.pending_approval_count;
    document.getElementById("stat-vendors-pending").textContent = stats.vendors_pending_count;
    document.getElementById("stat-bids-submitted").textContent = stats.bids_submitted_count;
    document.getElementById("stat-registered-vendors").textContent = stats.registered_vendors_count;

    const openBody = document.querySelector("#dashboard-open-tenders-table tbody");
    openBody.innerHTML = stats.open_tenders.length
      ? ""
      : '<tr><td colspan="4" style="color:#888;">No tenders currently open for bidding.</td></tr>';
    for (const t of stats.open_tenders) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.title}</td><td>${t.department || "—"}</td><td>${t.bids_received}</td><td>${t.bid_due_date ? new Date(t.bid_due_date).toLocaleString() : "—"}</td>`;
      openBody.appendChild(tr);
    }

    const pendingBody = document.querySelector("#dashboard-pending-approval-table tbody");
    pendingBody.innerHTML = stats.pending_approval.length
      ? ""
      : '<tr><td colspan="4" style="color:#888;">Nothing pending your approval.</td></tr>';
    for (const t of stats.pending_approval) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.title}</td><td>${t.round_number}</td><td>${t.required_tier}</td><td class="row-actions"><button data-id="${t.id}">Review →</button></td>`;
      pendingBody.appendChild(tr);
    }

    const recentBody = document.querySelector("#dashboard-recent-published-table tbody");
    recentBody.innerHTML = stats.recently_published.length
      ? ""
      : '<tr><td colspan="2" style="color:#888;">Nothing published yet.</td></tr>';
    for (const t of stats.recently_published) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${t.title}</td><td>${t.published_at ? new Date(t.published_at).toLocaleString() : "—"}</td>`;
      recentBody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}

document.querySelector("#dashboard-pending-approval-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  switchView("approvals");
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
      tr.innerHTML = `
        <td>#${v.id}</td>
        <td>${v.legal_name}</td>
        <td>${v.gstin}</td>
        <td>${v.contact_person}<br><span style="color:#888;">${v.email}</span></td>
        <td><span class="status-pill status-${v.status}">${v.status.replace("_", " ")}</span></td>
        <td class="row-actions"><button data-id="${v.id}">Review</button></td>`;
      tbody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load vendors: " + err.message, false);
  }
}

document.getElementById("status-filter").addEventListener("change", loadVendors);
document.getElementById("refresh-btn").addEventListener("click", loadVendors);

// ---- Vendor document review (Category Manager / Procurement Admin / System Admin) ----
let currentReviewVendorId = null;
// Which document IDs have actually been opened in *this* review session --
// Verify/Reject stay disabled until the reviewer has opened the file at
// least once, otherwise it's too easy to rubber-stamp every document
// without ever looking at it. Resets whenever a different vendor is opened.
let reviewedDocIds = new Set();

document.querySelector("#vendor-table tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  currentReviewVendorId = Number(btn.dataset.id);
  reviewedDocIds = new Set();
  document.getElementById("vendor-review-detail").hidden = false;
  loadVendorReview();
});

document.getElementById("close-vendor-review-btn").addEventListener("click", () => {
  document.getElementById("vendor-review-detail").hidden = true;
  currentReviewVendorId = null;
});

async function downloadVendorDocumentForReview(vendorId, docId) {
  const resultEl = document.getElementById("vendor-review-result");
  try {
    const res = await fetch(API_BASE + `/vendors/${vendorId}/documents/${docId}/download`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not open document");
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
    return true;
  } catch (err) {
    showResult(resultEl, err.message, false);
    return false;
  }
}

async function loadVendorReview() {
  const resultEl = document.getElementById("vendor-review-result");
  const decidable = ["pending_verification", "info_requested"];
  try {
    const [vendor, docs] = await Promise.all([
      api(`/vendors/${currentReviewVendorId}`),
      api(`/vendors/${currentReviewVendorId}/documents`),
    ]);

    document.getElementById("vendor-review-title").textContent = `${vendor.legal_name} — Vendor #${vendor.id}`;
    document.getElementById("vendor-review-info").innerHTML = `
      <p style="font-size:13px; color:#555;">
        GSTIN ${vendor.gstin} — ${vendor.contact_person} (${vendor.email})<br>
        Status: <span class="status-pill status-${vendor.status}">${vendor.status.replace("_", " ")}</span>
        ${vendor.rejection_reason ? `<br>Note on file: ${vendor.rejection_reason}` : ""}
      </p>`;

    const byType = new Map(docs.map((d) => [d.doc_type, d]));
    document.getElementById("vendor-review-documents").innerHTML = VENDOR_DOC_TYPES.map((t) => {
      const doc = byType.get(t.value);
      const reqBadge = t.mandatory ? '<span class="badge badge-required">Required</span>' : '<span class="badge badge-optional">Optional</span>';
      const statusBadge = doc ? `<span class="badge badge-${doc.status}">${doc.status}</span>` : '<span class="badge badge-optional">Not uploaded</span>';
      const meta = doc
        ? `<div class="doc-meta">${doc.original_filename} — ${(doc.size_bytes / 1024).toFixed(0)} KB — <a href="#" class="doc-view-link" data-doc-id="${doc.id}">View</a></div>`
        : "";
      const rejectReason = doc && doc.status === "rejected" && doc.rejection_reason ? `<div class="doc-reject-reason">Reason: ${doc.rejection_reason}</div>` : "";
      const viewed = doc && reviewedDocIds.has(doc.id);
      const disabledAttr = doc && !viewed ? "disabled" : "";
      const viewedHint = doc && !viewed ? '<span class="hint" style="margin-left:8px;">View the document before deciding</span>' : "";
      const actions =
        doc && doc.status !== "verified"
          ? `<div class="row-actions review-actions" style="margin-top:8px;">
              <button class="approve" data-doc-id="${doc.id}" data-action="verify-doc" ${disabledAttr}>Verify</button>
              <button class="reject" data-doc-id="${doc.id}" data-action="reject-doc" ${disabledAttr}>Reject</button>
              ${viewedHint}
            </div>`
          : doc
          ? `<div class="row-actions review-actions" style="margin-top:8px;"><button class="reject" data-doc-id="${doc.id}" data-action="reject-doc" ${disabledAttr}>Reject</button>${viewedHint}</div>`
          : "";
      return `
        <div class="doc-card">
          <div class="doc-card-head"><span class="doc-title">${t.label}</span><span>${reqBadge} ${statusBadge}</span></div>
          ${meta}
          ${rejectReason}
          ${actions}
        </div>`;
    }).join("");

    const mandatoryRejected = VENDOR_DOC_TYPES.filter((t) => t.mandatory).some((t) => byType.get(t.value)?.status === "rejected");
    const banner = document.getElementById("vendor-review-mandatory-banner");
    banner.hidden = !mandatoryRejected;
    if (mandatoryRejected) {
      banner.innerHTML = "A mandatory document has been rejected. Either reject this registration outright, or request the documents again with a note explaining what's needed.";
    }
    document.getElementById("vendor-review-approve-btn").hidden = mandatoryRejected || !decidable.includes(vendor.status);
    document.getElementById("vendor-review-reject-btn").hidden = !decidable.includes(vendor.status);
    document.getElementById("vendor-review-request-info-btn").hidden = !decidable.includes(vendor.status);

    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load vendor review: " + err.message, false);
  }
}

document.getElementById("vendor-review-documents").addEventListener("click", async (e) => {
  const viewLink = e.target.closest(".doc-view-link");
  if (viewLink) {
    e.preventDefault();
    const opened = await downloadVendorDocumentForReview(currentReviewVendorId, viewLink.dataset.docId);
    if (opened) {
      reviewedDocIds.add(Number(viewLink.dataset.docId));
      loadVendorReview();
    }
    return;
  }
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const resultEl = document.getElementById("vendor-review-result");
  const { docId, action } = btn.dataset;
  try {
    if (action === "reject-doc") {
      const reason = await modalPrompt("Reason for rejecting this document (required):");
      if (!reason) return;
      await api(`/vendors/${currentReviewVendorId}/documents/${docId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } else if (action === "verify-doc") {
      await api(`/vendors/${currentReviewVendorId}/documents/${docId}/verify`, { method: "POST" });
    }
    loadVendorReview();
  } catch (err) {
    showResult(resultEl, "Could not update document: " + err.message, false);
  }
});

document.getElementById("vendor-review-approve-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-review-result");
  const ok = await modalConfirm("Approve this vendor? They'll become Active and can start requesting catalog mappings.", { confirmLabel: "Approve" });
  if (!ok) return;
  try {
    await api(`/vendors/${currentReviewVendorId}/approve`, { method: "POST" });
    showResult(resultEl, "Vendor approved.", true);
    loadVendorReview();
    loadVendors();
  } catch (err) {
    showResult(resultEl, "Could not approve: " + err.message, false);
  }
});

document.getElementById("vendor-review-reject-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-review-result");
  const reason = await modalPrompt("Reason for rejecting this registration (required):");
  if (!reason) return;
  try {
    await api(`/vendors/${currentReviewVendorId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    showResult(resultEl, "Registration rejected.", true);
    loadVendorReview();
    loadVendors();
  } catch (err) {
    showResult(resultEl, "Could not reject: " + err.message, false);
  }
});

document.getElementById("vendor-review-request-info-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-review-result");
  const note = await modalPrompt("Note to the vendor explaining what's needed (required):");
  if (!note) return;
  try {
    await api(`/vendors/${currentReviewVendorId}/request-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    showResult(resultEl, "Documents requested again.", true);
    loadVendorReview();
    loadVendors();
  } catch (err) {
    showResult(resultEl, "Could not request info: " + err.message, false);
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

// ---- Vendor-facing: request a mapping (public, no login -- same as
// registration, mirrors the fact that POST /mappings has never required
// staff auth: it's the vendor's own request, on their own behalf). Staff no
// longer create these on a vendor's behalf from the matrix screen -- that
// screen now maps+approves directly, since staff already have the authority
// to do that without a review step. ----
async function populateVendorMappingRequestPicker() {
  const productSelect = document.querySelector('#vendor-mapping-request-form select[name="product_master_id"]');
  try {
    const products = await api("/products?active=true");
    productSelect.innerHTML =
      '<option value="">— select a catalog entry —</option>' +
      products.map((p) => `<option value="${p.id}">${p.code} — ${p.name}</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("vendor-mapping-request-result"), "Could not load the catalog: " + err.message, false);
  }
}

document.getElementById("vendor-mapping-request-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("vendor-mapping-request-result");
  try {
    const mapping = await api("/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor_id: Number(data.vendor_id), product_master_id: Number(data.product_master_id) }),
    });
    showResult(resultEl, `Mapping requested (state: ${mapping.state}). A Category Manager will review it.`, true);
    form.reset();
  } catch (err) {
    showResult(resultEl, "Could not request mapping: " + err.message, false);
  }
});

// ---- Vendor login + dashboard ----
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
async function routeVendorAfterAuth() {
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
    } else {
      prompt.hidden = true;
      switchView("vendor-dashboard");
    }
  } catch (err) {
    switchView("vendor-dashboard");
  }
}

// ---- Vendor documents ----
// Fixed checklist matching backend/app/models/vendor.py's VendorDocType +
// MANDATORY_DOC_TYPES exactly -- same reasoning as Category Declaration's
// move to a known set instead of free text.
const VENDOR_DOC_TYPES = [
  { value: "gst_certificate", label: "GST Certificate", mandatory: true },
  { value: "pan_card", label: "PAN Card", mandatory: true },
  { value: "incorporation_certificate", label: "Certificate of Incorporation", mandatory: true },
  { value: "bank_proof", label: "Cancelled Cheque / Bank Proof", mandatory: false },
];

async function renderVendorDocuments() {
  const container = document.getElementById("vendor-documents-list");
  const resultEl = document.getElementById("vendor-documents-result");
  try {
    const docs = await api("/vendor-portal/documents");
    const byType = new Map(docs.map((d) => [d.doc_type, d]));

    container.innerHTML = VENDOR_DOC_TYPES.map((t) => {
      const doc = byType.get(t.value);
      const reqBadge = t.mandatory ? '<span class="badge badge-required">Required</span>' : '<span class="badge badge-optional">Optional</span>';
      const statusBadge = doc ? `<span class="badge badge-${doc.status}">${doc.status}</span>` : "";
      const meta = doc
        ? `<div class="doc-meta">${doc.original_filename} — ${(doc.size_bytes / 1024).toFixed(0)} KB — uploaded ${new Date(doc.uploaded_at).toLocaleString()} — <a href="#" class="doc-view-link" data-doc-id="${doc.id}">View</a></div>`
        : "";
      const rejectReason =
        doc && doc.status === "rejected" && doc.rejection_reason
          ? `<div class="doc-reject-reason">Reason: ${doc.rejection_reason}</div>`
          : "";
      return `
        <div class="doc-card">
          <div class="doc-card-head">
            <span class="doc-title">${t.label}</span>
            <span>${reqBadge} ${statusBadge}</span>
          </div>
          ${meta}
          ${rejectReason}
          <div class="dropzone" data-doc-type="${t.value}">
            ${doc ? "Drop a new file here to replace, or click to browse" : "Drop a file here, or click to browse"} (PDF, JPG, or PNG)
            <input type="file" accept=".pdf,.jpg,.jpeg,.png">
          </div>
        </div>`;
    }).join("");

    wireVendorDocumentDropzones();
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load documents: " + err.message, false);
  }
}

function wireVendorDocumentDropzones() {
  document.querySelectorAll("#vendor-documents-list .dropzone").forEach((zone) => {
    const input = zone.querySelector("input[type=file]");
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files[0]) uploadVendorDocument(zone.dataset.docType, input.files[0]);
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const file = e.dataTransfer.files[0];
      if (file) uploadVendorDocument(zone.dataset.docType, file);
    });
  });

  document.querySelectorAll("#vendor-documents-list .doc-view-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      downloadVendorDocument(link.dataset.docId);
    });
  });
}

async function uploadVendorDocument(docType, file) {
  const resultEl = document.getElementById("vendor-documents-result");
  const formData = new FormData();
  formData.append("doc_type", docType);
  formData.append("file", file);
  try {
    // Deliberately not going through api()'s JSON Content-Type -- leaving
    // headers unset here lets fetch set the correct multipart boundary itself.
    await api("/vendor-portal/documents", { method: "POST", body: formData });
    showResult(resultEl, `Uploaded ${file.name}.`, true);
    renderVendorDocuments();
  } catch (err) {
    showResult(resultEl, "Could not upload: " + err.message, false);
  }
}

async function downloadVendorDocument(docId) {
  const resultEl = document.getElementById("vendor-documents-result");
  try {
    const res = await fetch(API_BASE + `/vendor-portal/documents/${docId}/download`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not open document");
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  } catch (err) {
    showResult(resultEl, err.message, false);
  }
}

// ---- Post-approval category picker (replaces the old registration-time
// Category Declaration -- selecting a category here creates real
// VendorMapping requests via the vendor's own logged-in identity, instead
// of a label on the vendor's profile). Only shown once Active, per the
// agreed onboarding order: documents verified -> approved -> THEN pick
// categories -> THEN the dashboard is fully useful. ----
async function renderVendorCategoryPicker() {
  const section = document.getElementById("vendor-category-picker-section");
  if (state.vendor.status !== "active") {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const container = document.getElementById("vendor-category-picker");
  const resultEl = document.getElementById("vendor-category-picker-result");
  try {
    const products = await api("/products?active=true");
    const categories = [...new Set(products.map((p) => p.category))].sort();
    container.innerHTML = categories.length
      ? categories.map((c) => `<label><input type="checkbox" value="${c}"> ${c}</label>`).join("")
      : '<span class="hint">No catalog categories exist yet.</span>';
    container.dataset.productsJson = JSON.stringify(products);
  } catch (err) {
    showResult(resultEl, "Could not load categories: " + err.message, false);
  }
}

document.getElementById("vendor-category-submit-btn").addEventListener("click", async () => {
  const resultEl = document.getElementById("vendor-category-picker-result");
  const container = document.getElementById("vendor-category-picker");
  const checked = [...container.querySelectorAll("input:checked")].map((el) => el.value);
  if (checked.length === 0) {
    showResult(resultEl, "Select at least one category first.", false);
    return;
  }
  const products = JSON.parse(container.dataset.productsJson || "[]");
  const targets = products.filter((p) => checked.includes(p.category));
  let created = 0;
  let alreadyExists = 0;
  let failed = 0;
  for (const p of targets) {
    try {
      await api("/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: state.vendor.id, product_master_id: p.id }),
      });
      created++;
    } catch (err) {
      if (/already exists/i.test(err.message)) alreadyExists++;
      else failed++;
    }
  }
  const parts = [`${created} new mapping request(s) sent`];
  if (alreadyExists) parts.push(`${alreadyExists} already requested`);
  if (failed) parts.push(`${failed} failed`);
  showResult(resultEl, parts.join(", ") + ".", failed === 0);
  container.querySelectorAll("input:checked").forEach((el) => (el.checked = false));
});

async function loadVendorDashboard() {
  const profileEl = document.getElementById("vendor-profile-card");
  const resultEl = document.getElementById("vendor-dashboard-result");
  try {
    const vendor = await api("/vendor-auth/me");
    state.vendor = vendor;
    profileEl.innerHTML = `
      <p><b>${vendor.legal_name}</b> (#${vendor.id}) —
        <span class="status-pill status-${vendor.status}">${vendor.status.replace("_", " ")}</span>
        ${vendor.rejection_reason ? `<br><span style="color:#a33;">Reason: ${vendor.rejection_reason}</span>` : ""}
      </p>`;

    await renderVendorCategoryPicker();

    const [openTenders, bids] = await Promise.all([api("/vendor-portal/tenders"), api("/vendor-portal/bids")]);

    const openBody = document.querySelector("#vendor-open-tenders-table tbody");
    openBody.innerHTML = "";
    let rowCount = 0;
    for (const t of openTenders) {
      for (const li of t.line_items) {
        rowCount++;
        const tr = document.createElement("tr");
        const dueStr = t.bid_due_date ? new Date(t.bid_due_date).toLocaleString() : "—";
        let actionCell;
        if (li.already_bid) {
          actionCell = `<span class="status-pill status-active">Bid ${li.bid_status}</span>`;
        } else if (t.can_bid) {
          actionCell = `<button class="approve" data-line-item-id="${li.line_item_id}" data-title="${t.title}" data-product="${li.product_name}">Submit Bid</button>`;
        } else {
          actionCell = `<span style="color:#888;">Deadline passed</span>`;
        }
        tr.innerHTML = `
          <td>${t.title}</td>
          <td>${t.tender_type}</td>
          <td>${li.product_name}</td>
          <td>${li.qty}</td>
          <td>${dueStr}</td>
          <td class="row-actions">${actionCell}</td>`;
        openBody.appendChild(tr);
      }
    }
    if (rowCount === 0) {
      openBody.innerHTML = '<tr><td colspan="6" style="color:#888;">No open tenders you\'re currently invited to.</td></tr>';
    }

    const bidsBody = document.querySelector("#vendor-bids-table tbody");
    bidsBody.innerHTML = bids.length ? "" : '<tr><td colspan="6" style="color:#888;">No bids submitted yet.</td></tr>';
    for (const b of bids) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${b.tender_title}</td>
        <td>${b.product_name}</td>
        <td>${b.qty}</td>
        <td>${b.unit_price}</td>
        <td><span class="status-pill status-active">${b.status}</span></td>
        <td>${new Date(b.submitted_at).toLocaleString()}</td>`;
      bidsBody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}

document.querySelector("#vendor-open-tenders-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-line-item-id]");
  if (!btn) return;
  const resultEl = document.getElementById("vendor-dashboard-result");
  const priceStr = await modalPrompt(`Your unit price for "${btn.dataset.product}" (${btn.dataset.title}):`);
  if (!priceStr) return;
  const unitPrice = Number(priceStr);
  if (!(unitPrice > 0)) {
    showResult(resultEl, "Price must be a positive number.", false);
    return;
  }
  try {
    await api("/vendor-portal/bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tender_line_item_id: Number(btn.dataset.lineItemId), unit_price: unitPrice }),
    });
    showResult(resultEl, "Bid submitted.", true);
    loadVendorDashboard();
  } catch (err) {
    showResult(resultEl, "Could not submit bid: " + err.message, false);
  }
});

// ---- Vendor mapping (staff) ----

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
    const suspended = m.state === "suspended";
    tr.innerHTML = `
      <td>${vendorName.get(m.vendor_id) || "—"} <span style="color:#888;">(#${m.vendor_id})</span></td>
      <td>${productName.get(m.product_master_id) || "—"} <span style="color:#888;">(#${m.product_master_id})</span></td>
      <td><span class="status-pill status-${m.state === "approved" ? "active" : m.state === "rejected" || m.state === "suspended" ? "rejected" : "pending_verification"}">${m.state}</span></td>
      <td class="row-actions">
        ${pending ? `<button class="approve" data-id="${m.id}" data-action="approve">Approve</button>
        <button class="reject" data-id="${m.id}" data-action="reject">Reject</button>` : ""}
        ${approved ? `<button class="reject" data-id="${m.id}" data-action="suspend">Suspend</button>` : ""}
        ${suspended ? `<button class="approve" data-id="${m.id}" data-action="reinstate">Reinstate</button>` : ""}
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
      const reason = await modalPrompt(`Reason for ${action} (required):`);
      if (!reason) return;
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
      <span><b style="color:#2f5f2f;">APPROVED</b> — click to suspend</span>
      <span><b style="color:#8a5215;">PENDING</b> — requested, review open</span>
      <span><b style="color:#666;">SUSPENDED</b> — click to reinstate</span>
      <span><b style="color:#8a3f3f;">REJECTED</b></span>
      <span>— not mapped, click to map &amp; approve directly</span>
    </div>`;

    container.innerHTML = html;

    const vendorById = new Map(vendors.map((v) => [v.id, v]));
    const productById = new Map(products.map((p) => [p.id, p]));

    function filterMappingTableToCell(cell) {
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
    }

    // Behavior depends on the cell's current state: this screen is only
    // reachable by Category Manager/Procurement Admin/System Admin (the same
    // roles that already approve/suspend/reinstate mappings), so each cell
    // acts on itself directly instead of detouring through the Pending-
    // review queue (that queue is still where a vendor's own request lands).
    // Empty -> map & approve. Approved -> suspend. Suspended -> reinstate.
    // Pending/Rejected still just filter the detail table below, where the
    // existing approve/reject actions live (rejected is terminal by design).
    container.querySelectorAll(".matrix-cell").forEach((cell) => {
      if (cell.classList.contains("cell-none")) {
        cell.addEventListener("click", () => directMapVendorToCategory(cell, vendorById, productById));
      } else if (cell.classList.contains("cell-approved")) {
        cell.addEventListener("click", () => suspendVendorCategoryMapping(cell, vendorById, productById, mappings, productsInCategory));
      } else if (cell.classList.contains("cell-suspended")) {
        cell.addEventListener("click", () => reinstateVendorCategoryMapping(cell, vendorById, productById, mappings, productsInCategory));
      } else {
        cell.addEventListener("click", () => filterMappingTableToCell(cell));
      }
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
    await modalAlert(`${vendor ? vendor.legal_name : "This vendor"} isn't Active yet — only an Active, approved vendor can be mapped (CLAUDE.md PROJECT OVERRIDE).`);
    return;
  }

  const candidates = [...productById.values()].filter((p) => p.category === category).map((p) => p.id);
  let productId;
  if (candidates.length === 1) {
    productId = candidates[0];
  } else {
    const options = candidates.map((id) => ({ value: String(id), label: `${productById.get(id).code} — ${productById.get(id).name}` }));
    const choice = await modalChoose(`Multiple catalog entries in "${category}" — which one?`, options, "Choose catalog entry");
    if (!choice) return;
    productId = Number(choice);
  }
  const product = productById.get(productId);

  const ok = await modalConfirm(`Map ${vendor.legal_name} to "${product.name}" and approve immediately?`, { confirmLabel: "Map & Approve" });
  if (!ok) return;

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

// Shared by suspend/reinstate: a category cell can aggregate more than one
// mapping, so if several share the target state, ask which one via a modal
// chooser instead of guessing.
async function resolveMappingInCategory(vendorId, category, state, vendor, mappings, productsInCategory, productById, actionLabel) {
  const ids = new Set(productsInCategory.get(category));
  const candidates = mappings.filter((m) => m.vendor_id === vendorId && ids.has(m.product_master_id) && m.state === state);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const options = candidates.map((m) => ({
    value: String(m.id),
    label: productById.get(m.product_master_id)?.name || `#${m.product_master_id}`,
  }));
  const chosenId = await modalChoose(`${vendor.legal_name} has more than one ${state} mapping in "${category}" — which one to ${actionLabel}?`, options, `Choose mapping to ${actionLabel}`);
  return chosenId ? candidates.find((m) => String(m.id) === chosenId) : null;
}

async function suspendVendorCategoryMapping(cell, vendorById, productById, mappings, productsInCategory) {
  const vendorId = Number(cell.dataset.vendorId);
  const category = cell.dataset.category;
  const vendor = vendorById.get(vendorId);
  const resultEl = document.getElementById("mapping-result");

  const mapping = await resolveMappingInCategory(vendorId, category, "approved", vendor, mappings, productsInCategory, productById, "suspend");
  if (!mapping) return;
  const product = productById.get(mapping.product_master_id);
  const reason = await modalPrompt(`Reason for suspending ${vendor.legal_name} — ${product ? product.name : "#" + mapping.product_master_id} (required):`);
  if (!reason) return;

  try {
    await api(`/mappings/${mapping.id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    showResult(resultEl, `Suspended ${vendor.legal_name} — ${product ? product.name : ""}.`, true);
    renderMappingMatrix();
    loadMappings();
  } catch (err) {
    showResult(resultEl, "Could not suspend mapping: " + err.message, false);
  }
}

async function reinstateVendorCategoryMapping(cell, vendorById, productById, mappings, productsInCategory) {
  const vendorId = Number(cell.dataset.vendorId);
  const category = cell.dataset.category;
  const vendor = vendorById.get(vendorId);
  const resultEl = document.getElementById("mapping-result");

  const mapping = await resolveMappingInCategory(vendorId, category, "suspended", vendor, mappings, productsInCategory, productById, "reinstate");
  if (!mapping) return;
  const product = productById.get(mapping.product_master_id);
  const ok = await modalConfirm(`Reinstate ${vendor.legal_name} — ${product ? product.name : "#" + mapping.product_master_id} back to Approved?`, { confirmLabel: "Reinstate" });
  if (!ok) return;

  try {
    await api(`/mappings/${mapping.id}/reinstate`, { method: "POST" });
    showResult(resultEl, `Reinstated ${vendor.legal_name} — ${product ? product.name : ""}.`, true);
    renderMappingMatrix();
    loadMappings();
  } catch (err) {
    showResult(resultEl, "Could not reinstate mapping: " + err.message, false);
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

// Fleet-wide overview: stat cards + a leaderboard sorted by score, so
// there's something to look at before picking one vendor -- same
// list-first idea as the Vendor Mapping matrix, applied here with real
// aggregate numbers instead of a lookup-only form.
async function renderRatingDashboard() {
  const el = document.getElementById("rating-dashboard");
  try {
    const vendors = await api("/vendors/lookup");
    const ratings = await Promise.all(vendors.map((v) => api(`/ratings/${v.id}`).catch(() => null)));
    const rows = vendors.map((v, i) => ({ vendor: v, rating: ratings[i] })).filter((r) => r.rating);

    if (rows.length === 0) {
      el.innerHTML = '<p class="hint">No vendors to rate yet.</p>';
      return;
    }

    const avgScore = rows.reduce((sum, r) => sum + r.rating.overall_score, 0) / rows.length;
    const provisionalCount = rows.filter((r) => r.rating.is_provisional).length;
    const staleCount = rows.filter((r) => r.rating.is_stale).length;
    const top = rows.slice().sort((a, b) => b.rating.overall_score - a.rating.overall_score)[0];

    el.innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="stat-label">Vendors Rated</div><div class="stat-value">${rows.length}</div></div>
        <div class="stat-card"><div class="stat-label">Average Score</div><div class="stat-value">${avgScore.toFixed(1)}</div></div>
        <div class="stat-card"><div class="stat-label">Top Rated</div><div class="stat-value accent" style="font-size:16px;">${top.vendor.legal_name}</div></div>
        <div class="stat-card"><div class="stat-label">Provisional</div><div class="stat-value">${provisionalCount}</div></div>
        <div class="stat-card"><div class="stat-label">Stale — Update Due</div><div class="stat-value">${staleCount}</div></div>
      </div>
      <table id="rating-leaderboard">
        <thead><tr><th>Vendor</th><th>Overall Score</th><th>Status</th></tr></thead>
        <tbody></tbody>
      </table>`;

    const tbody = el.querySelector("#rating-leaderboard tbody");
    for (const { vendor, rating } of rows.slice().sort((a, b) => b.rating.overall_score - a.rating.overall_score)) {
      const badges = [
        rating.is_provisional ? '<span class="badge badge-provisional">Provisional</span>' : "",
        rating.is_stale ? '<span class="badge badge-stale">Stale — Update Due</span>' : "",
      ]
        .filter(Boolean)
        .join(" ");
      const tr = document.createElement("tr");
      tr.dataset.vendorId = vendor.id;
      tr.innerHTML = `<td>${vendor.legal_name} <span style="color:#888;">(#${vendor.id})</span></td><td>${rating.overall_score.toFixed(1)}</td><td>${badges || "—"}</td>`;
      tbody.appendChild(tr);
    }
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-vendor-id]");
      if (!tr) return;
      currentRatingVendorId = Number(tr.dataset.vendorId);
      document.querySelector('#rating-lookup-form select[name="vendor_id"]').value = currentRatingVendorId;
      loadRating();
    });
  } catch (err) {
    el.innerHTML = `<div class="result err">Could not load rating dashboard: ${err.message}</div>`;
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
    const vendors = await api("/vendors/lookup");
    const vendor = vendors.find((v) => v.id === currentRatingVendorId);
    const fmt = (v) => (v === null || v === undefined ? "— not entered —" : `${v}%`);

    document.getElementById("rating-header").innerHTML = `
      <div>
        <div style="font-size:13px; color:#888;">Vendor Rating</div>
        <div style="font-size:20px; font-weight:700; margin-top:2px;">${vendor ? vendor.legal_name : "Vendor #" + currentRatingVendorId}</div>
      </div>
      <div class="score-block">
        <div class="score-label">Overall Weighted Score</div>
        <div class="score-value">${rating.overall_score.toFixed(1)} / 100</div>
        ${rating.is_provisional ? '<span class="badge badge-provisional">Provisional</span>' : ""}
        ${rating.is_stale ? '<span class="badge badge-stale">Stale — Update Due</span>' : ""}
      </div>`;

    document.getElementById("rating-breakdown").innerHTML = `
      <div class="rating-cards-row">
        <div class="rating-card-box">
          <div class="card-title-row"><span>Price Competitiveness — 20% weight</span><span class="badge badge-auto">Auto-calculated</span></div>
          <div class="card-score">${rating.price_competitiveness.toFixed(1)}</div>
          <p class="hint">System-computed from bid history (rolling 12 months). No bid-evaluation history exists yet, so this stays at its provisional default until Phase 5/6 feed it real data.</p>
        </div>
        <div class="rating-card-box">
          <div class="card-title-row"><span>Manually Entered Parameters</span><span class="badge badge-manual">Manual</span></div>
          <div class="rating-param-row"><span>On-time Delivery — 25% weight</span><span>${fmt(rating.on_time_pct)}</span></div>
          <div class="rating-param-row"><span>Quality Acceptance Rate — 25% weight</span><span>${fmt(rating.quality_pct)}</span></div>
          <div class="rating-param-row"><span>Compliance / Documentation — 15% weight</span><span>${fmt(rating.compliance_pct)}</span></div>
          <div class="rating-param-row"><span>Responsiveness — 15% weight</span><span>${fmt(rating.responsiveness)}</span></div>
          <p class="hint">Last manual update: ${rating.last_manual_update_at ? new Date(rating.last_manual_update_at).toLocaleString() : "never"}</p>
        </div>
      </div>`;

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
    renderRatingDashboard();
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
  if (!form.hidden) populateFacilityPicker();
});

async function populateFacilityPicker() {
  const select = document.querySelector('#tender-form select[name="facility_id"]');
  try {
    const facilities = await api("/facilities");
    select.innerHTML =
      '<option value="">— select a facility —</option>' +
      facilities.map((f) => `<option value="${f.id}">${f.name} (${f.legal_entity_code})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("tender-result"), "Could not load facilities: " + err.message, false);
  }
}

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

document.querySelector("#tender-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='select']");
  if (!btn) return;
  currentTenderId = Number(btn.dataset.id);
  document.getElementById("tender-detail").hidden = false;
  document.getElementById("tender-detail-title").textContent = `Tender #${currentTenderId}`;
  populateLineItemProductPicker();
  loadLineItems();
  loadRounds();
  document.getElementById("eligibility-preview").innerHTML = "";
  await refreshTenderStatusNotice();
});

document.getElementById("close-tender-detail-btn").addEventListener("click", () => {
  document.getElementById("tender-detail").hidden = true;
  currentTenderId = null;
});

// Line items (and submission) only make sense while Draft -- rather than
// let staff fill out the whole Add Line Item form and only find out on
// submit that a Published/Pending tender rejects it, tell them upfront and,
// for Published, offer a one-click way back to Draft.
async function refreshTenderStatusNotice() {
  try {
    const tender = await api(`/tenders/${currentTenderId}`);
    renderTenderStatusNotice(tender);
  } catch (err) {
    showResult(document.getElementById("tender-result"), "Could not load tender: " + err.message, false);
  }
}

function renderTenderStatusNotice(tender) {
  const notice = document.getElementById("tender-status-notice");
  const lineItemForm = document.getElementById("line-item-form");
  const submitBtn = document.getElementById("submit-tender-btn");

  if (tender.status === "draft") {
    notice.hidden = true;
    lineItemForm.hidden = false;
    submitBtn.hidden = false;
    return;
  }

  lineItemForm.hidden = true;
  submitBtn.hidden = true;
  notice.hidden = false;
  const statusLabel = tender.status.replace("_", " ");
  if (tender.status === "published") {
    notice.innerHTML = `<span>This tender is <b>Published</b> — line items can't be added or changed while it's live.</span>`;
    const revertBtn = document.createElement("button");
    revertBtn.textContent = "Revert to Draft to Edit";
    revertBtn.addEventListener("click", () => revertTenderToDraft(tender.id));
    notice.appendChild(revertBtn);
  } else {
    notice.innerHTML = `<span>This tender is <b>${statusLabel}</b> — line items can only be added while Draft.</span>`;
  }
}

async function revertTenderToDraft(tenderId) {
  const resultEl = document.getElementById("tender-result");
  const ok = await modalConfirm(
    "Revert this tender to Draft so you can edit its line items? It will need to go through E-Tender Approval again before it's Published.",
    { confirmLabel: "Revert to Draft" }
  );
  if (!ok) return;
  try {
    const tender = await api(`/tenders/${tenderId}/withdraw-to-draft`, { method: "POST" });
    showResult(resultEl, `Tender #${tender.id} reverted to Draft.`, true);
    renderTenderStatusNotice(tender);
    loadTenders();
  } catch (err) {
    showResult(resultEl, "Could not revert to Draft: " + err.message, false);
  }
}

// Catalog entries carry their own procurement_type (item/asset/service),
// which the line-item API requires to match exactly -- picking from this
// list (instead of typing a numeric ID and a separately-guessed type) means
// that can never mismatch, and nobody needs to know the catalog's raw ID.
async function populateLineItemProductPicker() {
  const select = document.querySelector('#line-item-form select[name="product_master_id"]');
  try {
    const products = await api("/products?active=true");
    select.innerHTML =
      '<option value="">— select a catalog entry —</option>' +
      products.map((p) => `<option value="${p.id}" data-type="${p.procurement_type}">${p.code} — ${p.name} (${p.procurement_type})</option>`).join("");
  } catch (err) {
    showResult(document.getElementById("tender-result"), "Could not load the catalog: " + err.message, false);
  }
}

document.getElementById("line-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const select = form.querySelector('select[name="product_master_id"]');
  const procurementType = select.selectedOptions[0]?.dataset.type;
  const payload = {
    product_master_id: Number(data.product_master_id),
    procurement_type: procurementType,
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
  const [items, products] = await Promise.all([api(`/tenders/${currentTenderId}/line-items`), api("/products")]);
  const productLabel = new Map(products.map((p) => [p.id, `${p.code} — ${p.name}`]));
  tbody.innerHTML = items.length
    ? ""
    : '<tr><td colspan="4" style="color:#888;">No line items yet.</td></tr>';
  for (const li of items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${productLabel.get(li.product_master_id) || "—"} <span style="color:#888;">(#${li.product_master_id})</span></td><td>${li.procurement_type}</td><td>${li.qty}</td><td>${li.estimated_price ?? "—"}</td>`;
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
    refreshTenderStatusNotice();
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
      const comments = await modalPrompt("Comments for rejection (required):");
      if (!comments) return;
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
  if (!state.token) return;
  try {
    if (state.actorType === "vendor") {
      state.vendor = await api("/vendor-auth/me");
      document.getElementById("whoami").textContent = `${state.vendor.legal_name} — Vendor #${state.vendor.id}`;
      showVendorDashboardTab();
      await routeVendorAfterAuth();
    } else {
      state.user = await api("/auth/me");
      document.getElementById("whoami").textContent = `${state.user.full_name} — ${state.user.role}`;
      showStaffTabsForRole(state.user.role);
      switchView(DEFAULT_VIEW_BY_ROLE[state.user.role] || "tenders");
    }
  } catch (e) {
    state.token = null;
    state.actorType = null;
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("actorType");
  }
})();
