import { api } from "../../api.js";
import { state } from "../../state.js";
import { showResult } from "../../ui.js";
import { refreshChrome } from "../../nav.js";
import { esc } from "../../kit.js";
import { docKey, acceptFor, VENDOR_DOC_TYPES } from "../../constants.js";
import { renderCategoryRequestSection, submitCategoryRequests } from "./categoryRequests.js";
import { renderItemRequestSection, submitItemRequests } from "./itemRequests.js";
import { renderItemRequirements } from "./coveredItems.js";

// ---- Category Declaration: its own tab (2026-09-30, previously a pane
// embedded in Company profile) -- chips showing each category/item the
// vendor has requested and its approval state, plus a "Request additional
// category" button that opens the request panel. ----
let requesting = false;

export function loadVendorCategoriesTab() {
  renderVendorCategories(document.getElementById("vendor-categories-root"));
}

const CHIP = {
  approved: ["chip-approved", "approved"],
  pending: ["chip-pending", "requested"],
  rejected: ["chip-rejected", "rejected"],
  suspended: ["chip-suspended", "suspended"],
};
const chip = (label, stateKey) => {
  const [cls, word] = CHIP[stateKey];
  return `<span class="vc-chip ${cls}">${esc(label)} — ${word}</span>`;
};

export async function renderVendorCategories(container) {
  if (state.vendor.status !== "active") {
    container.innerHTML = `<div class="ep-pane ep-pane-pad"><div class="ep-k">Category declaration</div>
      <div class="hint mt-8px">Categories can be requested once your registration is Active — finish document verification first.</div></div>`;
    return;
  }
  try {
    const [categories, products, mappings, docs, requirements] = await Promise.all([
      api("/categories"),
      api("/products?active=true"),
      api("/vendor-portal/mappings"),
      api("/vendor-portal/documents"),
      api("/vendor-portal/documents/requirements"),
    ]);
    const ctx = {
      docsByKey: new Map(docs.map((d) => [docKey(d), d])),
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

    const owed = renderItemRequirements(requirements);
    container.innerHTML = `${owed ? `<div class="ep-pane ep-pane-pad mb-18px border-left-3px-solid-primary">${owed}</div>` : ""}<div class="ep-pane ep-pane-pad">
      <div class="ep-k">Category declaration</div>
      <div class="d-flex flex-wrap gap-7px mt-9px">${chips.length ? chips.join("") : '<span class="hint">Nothing requested yet.</span>'}</div>
      <div class="hint mt-12px">Category approval does not auto-approve every SKU within it. Requests are reviewed by the category manager and timestamped on approval.</div>
      <button class="ep-b mt-12px" id="toggle-request">${requesting ? "Hide request panel" : "Request additional category"}</button>
      ${
        requesting
          ? `<div id="request-panel" class="mt-16px pt-16px border-top-2px-solid-ink-40 d-flex flex-col gap-20px">
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
    // Free-text "other" documents are uploaded inline, in the request panel or the item-documents notice.
    container.querySelectorAll("[data-upload-other]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,.jpg,.jpeg,.png";
        input.addEventListener("change", async () => {
          if (!input.files[0]) return;
          const formData = new FormData();
          formData.append("doc_type", "other");
          formData.append("custom_label", btn.dataset.uploadOther);
          formData.append("file", input.files[0]);
          formData.append("for_requirement", "true");
          try {
            await api("/vendor-portal/documents", { method: "POST", body: formData });
            renderVendorCategories(container);
          } catch (err) {
            alert("Could not upload: " + err.message);
          }
        });
        input.click();
      })
    );
    // Any document a catalog entry requires (standard type or free-text "other") uploaded from the notice.
    container.querySelectorAll("[data-upload-req]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const entry = btn.dataset.uploadReq;
        const isOther = entry.startsWith("other:");
        const input = document.createElement("input");
        input.type = "file";
        input.accept = isOther ? ".pdf,.jpg,.jpeg,.png" : acceptFor(VENDOR_DOC_TYPES.find((t) => t.value === entry) || {});
        input.addEventListener("change", async () => {
          if (!input.files[0]) return;
          const formData = new FormData();
          formData.append("doc_type", isOther ? "other" : entry);
          if (isOther) formData.append("custom_label", entry.slice(6).trim());
          formData.append("file", input.files[0]);
          formData.append("for_requirement", "true");
          try {
            await api("/vendor-portal/documents", { method: "POST", body: formData });
            renderVendorCategories(container);
            refreshChrome();
          } catch (err) {
            alert("Could not upload: " + err.message);
          }
        });
        input.click();
      })
    );
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
