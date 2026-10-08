import { api } from "../../api.js";
import { state } from "../../state.js";
import { showResult } from "../../ui.js";
import { refreshChrome } from "../../nav.js";
import { esc } from "../../kit.js";
import { docKey, acceptFor, VENDOR_DOC_TYPES } from "../../constants.js";
import { renderCategoryRequestTable, submitCategoryRequests } from "./categoryRequests.js";
import { renderItemRequestTable, submitItemRequests } from "./itemRequests.js";
import { renderItemRequirements } from "./coveredItems.js";

// ---- Category Declaration: its own tab (2026-09-30, previously a pane
// embedded in Company profile) -- chips showing each category/item the
// vendor has requested and its approval state, plus a "Request additional
// category" button that opens the request panel. ----
//
// Request panel (2026-10-08, was a flex-wrapped cloud of checkbox pills):
// a real searchable table, Items tab first since that's what most vendors
// want, with a shared search box + Item/Asset/Service type filter. Only the
// table body (#request-tbody) re-renders on search/filter/selection changes
// -- the search <input> itself is never replaced, so it never loses focus
// or caret position while typing.
let requesting = false;
let requestTab = "items";
let requestSearch = "";
let requestType = "all";
const expandedGroups = new Set(); // category ids expanded in the Items tab -- starts empty, i.e. every group starts collapsed
const selectedCategoryIds = new Set();
const selectedProductIds = new Set();

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

function resetRequestState() {
  requestTab = "items";
  requestSearch = "";
  requestType = "all";
  selectedCategoryIds.clear();
  selectedProductIds.clear();
}

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
      categoryById: new Map(categories.map((c) => [c.id, c])),
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
      ${requesting ? `<div id="request-panel" class="mt-16px pt-16px border-top-2px-solid-ink-40"></div>` : ""}
    </div>`;

    container.querySelector("#toggle-request").addEventListener("click", () => {
      requesting = !requesting;
      if (requesting) resetRequestState();
      renderVendorCategories(container);
    });

    // Delegated once on `container` itself (never replaced by an innerHTML
    // reassignment, only its descendants are) so it keeps working no matter
    // how many times #request-tbody gets rebuilt underneath it.
    if (!container.dataset.uploadWired) {
      container.dataset.uploadWired = "1";
      container.addEventListener("click", (e) => {
        // Two attributes, same as before this was delegated: data-upload-other
        // is always a free-text doc (its value is already the plain label);
        // data-upload-req carries a requirement entry that may itself be a
        // bare VendorDocType value or an "other:Label" free-text entry.
        const otherBtn = e.target.closest("[data-upload-other]");
        const reqBtn = !otherBtn && e.target.closest("[data-upload-req]");
        const btn = otherBtn || reqBtn;
        if (!btn) return;
        const reqEntry = reqBtn ? btn.dataset.uploadReq : "";
        const isOther = !!otherBtn || reqEntry.startsWith("other:");
        const customLabel = otherBtn ? btn.dataset.uploadOther : isOther ? reqEntry.slice(6).trim() : "";
        const input = document.createElement("input");
        input.type = "file";
        input.accept = isOther ? ".pdf,.jpg,.jpeg,.png" : acceptFor(VENDOR_DOC_TYPES.find((t) => t.value === reqEntry) || {});
        input.addEventListener("change", async () => {
          if (!input.files[0]) return;
          const formData = new FormData();
          formData.append("doc_type", isOther ? "other" : reqEntry);
          if (isOther) formData.append("custom_label", customLabel);
          formData.append("file", input.files[0]);
          formData.append("for_requirement", "true");
          try {
            await api("/vendor-portal/documents", { method: "POST", body: formData });
            await renderVendorCategories(container);
            refreshChrome();
          } catch (err) {
            alert("Could not upload: " + err.message);
          }
        });
        input.click();
      });
    }

    if (requesting) renderRequestShell(container.querySelector("#request-panel"), ctx, container);
  } catch (err) {
    container.innerHTML = `<div class="result err">Could not load categories: ${esc(err.message)}</div>`;
  }
}

const TYPE_FILTER_OPTS = [["all", "All types"], ["item", "Item"], ["asset", "Asset"], ["service", "Service"]];

// A column header's text-align has to match its cells' (left for the name
// column's identity block, centered for the short columns either side of
// it) or the short columns read as off-center against a header that isn't.
const headRow = (cols) => `<thead><tr>${cols.map(([label, cls]) => `<th class="ep-th${cls ? ` ${cls}` : ""}">${label}</th>`).join("")}</tr></thead>`;
const ITEMS_HEAD = headRow([["", "vc-col-check"], ["Item", ""], ["SKU", "text-center"], ["Type", "text-center"], ["Min rating", "text-center"]]);
const CATEGORIES_HEAD = headRow([["", "vc-col-check"], ["Category", ""], ["Type", "text-center"], ["Min rating", "text-center"]]);

function renderRequestShell(panel, ctx, container) {
  const items = requestTab === "items";
  panel.innerHTML = `
    <div class="ep-seg mb-14px" id="request-tabs">
      <button type="button" data-tab="items" class="${items ? "on" : ""}">Individual items</button>
      <button type="button" data-tab="categories" class="${items ? "" : "on"}">Categories</button>
    </div>
    <div class="d-flex items-center gap-14px flex-wrap mb-12px">
      <div class="flex-1 minw-220px">
        <input class="input" id="request-search" placeholder="${items ? "Search items, codes, or their category" : "Search categories by name"}" value="${esc(requestSearch)}">
      </div>
      <div class="ep-seg" id="request-type-tabs">${TYPE_FILTER_OPTS.map(([v, l]) => `<button type="button" data-type="${v}" class="${v === requestType ? "on" : ""}">${l}</button>`).join("")}</div>
      <span class="ep-sub" id="request-count"></span>
    </div>
    <div class="vc-request-list">
      <table class="ep-table">${items ? ITEMS_HEAD : CATEGORIES_HEAD}<tbody id="request-tbody"></tbody></table>
    </div>
    <div class="d-flex items-center justify-between mt-14px">
      <span class="ep-sub"><b id="request-sel-count">0</b> selected</span>
      <button class="ep-b" data-v="p" id="request-submit-btn" disabled>Request selected</button>
    </div>
    <div id="vendor-category-picker-result" class="result mt-10px"></div>
  `;

  panel.querySelector("#request-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn || btn.dataset.tab === requestTab) return;
    requestTab = btn.dataset.tab;
    requestSearch = "";
    renderRequestShell(panel, ctx, container);
  });
  panel.querySelector("#request-type-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    requestType = btn.dataset.type;
    panel.querySelectorAll("#request-type-tabs button").forEach((b) => b.classList.toggle("on", b === btn));
    renderTbody(panel, ctx);
  });
  panel.querySelector("#request-search").addEventListener("input", (e) => {
    requestSearch = e.target.value;
    renderTbody(panel, ctx);
  });
  panel.querySelector("#request-submit-btn").addEventListener("click", async () => {
    const selected = requestTab === "items" ? selectedProductIds : selectedCategoryIds;
    const { created, failed } = await (requestTab === "items" ? submitItemRequests(selected) : submitCategoryRequests(selected));
    selected.clear();
    await renderVendorCategories(container);
    const out = container.querySelector("#vendor-category-picker-result");
    if (out) showResult(out, `${created} request(s) sent${failed.length ? `, ${failed.length} failed (${failed[0]})` : ""}.`, failed.length === 0);
  });

  renderTbody(panel, ctx);
}

function renderTbody(panel, ctx) {
  const selected = requestTab === "items" ? selectedProductIds : selectedCategoryIds;
  const { countLabel, bodyHtml } =
    requestTab === "items"
      ? renderItemRequestTable(ctx, { search: requestSearch, typeFilter: requestType }, selected, expandedGroups)
      : renderCategoryRequestTable(ctx, { search: requestSearch, typeFilter: requestType }, selected);
  panel.querySelector("#request-count").textContent = countLabel;
  const tbody = panel.querySelector("#request-tbody");
  tbody.innerHTML = bodyHtml;

  tbody.querySelectorAll("[data-category-id]").forEach((el) =>
    el.addEventListener("change", () => {
      const id = Number(el.dataset.categoryId);
      el.checked ? selectedCategoryIds.add(id) : selectedCategoryIds.delete(id);
      updateSelBar(panel);
    })
  );
  tbody.querySelectorAll("[data-product-id]").forEach((el) =>
    el.addEventListener("change", () => {
      const id = Number(el.dataset.productId);
      el.checked ? selectedProductIds.add(id) : selectedProductIds.delete(id);
      updateSelBar(panel);
    })
  );
  tbody.querySelectorAll("[data-group-toggle]").forEach((el) =>
    el.addEventListener("click", () => {
      const id = Number(el.dataset.groupToggle);
      expandedGroups.has(id) ? expandedGroups.delete(id) : expandedGroups.add(id);
      renderTbody(panel, ctx);
    })
  );
  updateSelBar(panel);
}

function updateSelBar(panel) {
  const selected = requestTab === "items" ? selectedProductIds : selectedCategoryIds;
  panel.querySelector("#request-sel-count").textContent = selected.size;
  panel.querySelector("#request-submit-btn").disabled = selected.size === 0;
}
