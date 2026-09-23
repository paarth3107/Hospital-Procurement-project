import { api } from "../api.js";
import { showResult } from "../ui.js";
import { modalPrompt, modalConfirm, modalChoose, modalAlert } from "../modal.js";
import { MAPPING_STATE_PRIORITY } from "../constants.js";

// ---- Vendor mapping (staff) ----

export function renderMappingRows(mappings, vendorName, productName) {
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

export async function loadMappings() {
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
export async function renderMappingMatrix() {
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
