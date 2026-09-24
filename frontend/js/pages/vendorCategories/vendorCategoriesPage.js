import { api } from "../../api.js";
import { state } from "../../state.js";
import { showResult } from "../../ui.js";
import { esc } from "../../kit.js";
import { renderCategoryRequestSection, submitCategoryRequests } from "./categoryRequests.js";
import { renderItemRequestSection, submitItemRequests } from "./itemRequests.js";

// ---- Category declaration pane (in Company profile): chips showing each
// category/item the vendor has requested and its approval state, plus a
// "Request additional category" button that opens the request panel. ----
let requesting = false;

const CHIP = {
  approved: ["#ffe0d9", "#7c1405", "approved"],
  pending: ["rgba(32,30,29,.12)", "#201e1d", "requested"],
  rejected: ["#201e1d", "#f3f2f2", "rejected"],
  suspended: ["#201e1d", "#f3f2f2", "suspended"],
};
const chip = (label, stateKey) => {
  const [bg, fg, word] = CHIP[stateKey];
  return `<span style="font-size:11.5px;padding:4px 10px;background:${bg};color:${fg};font-weight:600">${esc(label)} — ${word}</span>`;
};

export async function renderVendorCategories(container) {
  if (state.vendor.status !== "active") {
    container.innerHTML = `<div class="ep-pane ep-pane-pad"><div class="ep-k">Category declaration</div>
      <div class="hint" style="margin-top:8px">Categories can be requested once your registration is Active — finish document verification first.</div></div>`;
    return;
  }
  try {
    const [categories, products, mappings] = await Promise.all([api("/categories"), api("/products?active=true"), api("/vendor-portal/mappings")]);
    const ctx = {
      categories,
      products,
      mappingByCategory: new Map(mappings.filter((m) => m.category_id != null).map((m) => [m.category_id, m])),
      mappingByProduct: new Map(mappings.filter((m) => m.product_master_id != null).map((m) => [m.product_master_id, m])),
    };
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const prodName = new Map(products.map((p) => [p.id, p.name]));
    const chips = mappings
      .map((m) => chip(m.category_id != null ? catName.get(m.category_id) : prodName.get(m.product_master_id), m.state))
      .filter(Boolean);

    container.innerHTML = `<div class="ep-pane ep-pane-pad">
      <div class="ep-k">Category declaration</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px">${chips.length ? chips.join("") : '<span class="hint">Nothing requested yet.</span>'}</div>
      <div class="hint" style="margin-top:12px">Category approval does not auto-approve every SKU within it. Requests are reviewed by the category manager and timestamped on approval.</div>
      <button class="ep-b" style="margin-top:12px" id="toggle-request">${requesting ? "Hide request panel" : "Request additional category"}</button>
      ${
        requesting
          ? `<div id="request-panel" style="margin-top:16px;padding-top:16px;border-top:2px solid rgba(32,30,29,.4);display:flex;flex-direction:column;gap:20px">
              ${renderCategoryRequestSection(ctx)}${renderItemRequestSection(ctx)}
              <div id="vendor-category-picker-result" class="result"></div>
            </div>`
          : ""
      }
    </div>`;

    container.querySelector("#toggle-request").addEventListener("click", () => {
      requesting = !requesting;
      renderVendorCategories(container);
    });
    const panel = container.querySelector("#request-panel");
    if (panel) {
      const report = ({ created, failed }) => {
        const msg = `${created} request(s) sent${failed.length ? `, ${failed.length} failed (${failed[0]})` : ""}.`;
        renderVendorCategories(container).then(() => {
          const out = container.querySelector("#vendor-category-picker-result");
          if (out) showResult(out, msg, failed.length === 0);
        });
      };
      panel.querySelector("#request-categories-btn")?.addEventListener("click", async () => report(await submitCategoryRequests(panel)));
      panel.querySelector("#request-items-btn")?.addEventListener("click", async () => report(await submitItemRequests(panel)));
    }
  } catch (err) {
    container.innerHTML = `<div class="result err">Could not load categories: ${esc(err.message)}</div>`;
  }
}
