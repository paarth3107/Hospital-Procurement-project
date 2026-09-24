import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { MAPPING_STATE_PRIORITY } from "../constants.js";

// ---- Post-approval Categories tab (replaces the old registration-time
// Category Declaration -- selecting a category here creates real
// VendorMapping requests via the vendor's own logged-in identity, instead
// of a label on the vendor's profile). Its own tab, not buried in the
// dashboard, so it's a real destination the vendor is routed to right
// after approval (see vendorLoginPage.js's routeVendorAfterAuth) and can
// freely revisit later. ----
// Once a category has at least one Approved mapping, it's locked -- the
// vendor can no longer touch it themselves (only a Category Manager can
// suspend/reinstate it, from the staff side). Aggregation mirrors the
// staff matrix's own logic (MAPPING_STATE_PRIORITY), just scoped to this
// vendor's own mappings instead of all vendors.
export async function renderVendorCategoryPicker() {
  const container = document.getElementById("vendor-category-picker");
  const resultEl = document.getElementById("vendor-category-picker-result");

  if (state.vendor.status !== "active") {
    container.innerHTML = '<span class="hint">Categories can be requested once your registration is Active -- finish document verification first.</span>';
    return;
  }

  try {
    const [products, mappings] = await Promise.all([api("/products?active=true"), api("/vendor-portal/mappings")]);
    const categories = [...new Set(products.map((p) => p.category))].sort();
    if (categories.length === 0) {
        container.innerHTML = '<span class="hint">No catalog categories exist yet.</span>';
      return;
    }

    const productsByCategory = new Map();
    for (const p of products) {
      if (!productsByCategory.has(p.category)) productsByCategory.set(p.category, []);
      productsByCategory.get(p.category).push(p.id);
    }
    const mappingByProduct = new Map(mappings.map((m) => [m.product_master_id, m]));

    const approved = [];
    const other = [];
    for (const category of categories) {
      let state_ = null;
      for (const pid of productsByCategory.get(category)) {
        const m = mappingByProduct.get(pid);
        if (!m) continue;
        if (state_ === null || MAPPING_STATE_PRIORITY.indexOf(m.state) < MAPPING_STATE_PRIORITY.indexOf(state_)) {
          state_ = m.state;
        }
      }
      if (state_ === "approved") approved.push(category);
      else other.push({ category, state: state_ });
    }

    let html = "";
    if (approved.length > 0) {
      html += `<div class="category-section"><h3>Approved Categories</h3>
        <p class="hint">Already approved -- these can't be changed here. Contact a Category Manager if something needs to change.</p>
        <div class="checkbox-group">${approved.map((c) => `<span class="badge badge-approved">${c}</span>`).join("")}</div></div>`;
    }
    html += `<div class="category-section"><h3>${approved.length > 0 ? "Other Categories" : "Select Categories"}</h3>`;
    html += `<div class="checkbox-group">${other
      .map(
        (o) =>
          `<label><input type="checkbox" value="${o.category}"> ${o.category}${
            o.state ? ` <span class="badge badge-${o.state}">${o.state}</span>` : ""
          }</label>`
      )
      .join("")}</div>`;
    if (other.length > 0) html += '<div class="toolbar"><button id="vendor-category-submit-btn">Request Selected Categories</button></div>';
    html += "</div>";
    container.innerHTML = html;
    const btn = document.getElementById("vendor-category-submit-btn");
    if (btn) btn.addEventListener("click", submitCategoryRequests);
    container.dataset.productsJson = JSON.stringify(products);
  } catch (err) {
    showResult(resultEl, "Could not load categories: " + err.message, false);
  }
}

async function submitCategoryRequests() {
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
}
