import { api } from "../api.js";
import { state } from "../state.js";
import { esc, stateTag } from "../kit.js";
import { renderVendorCategories } from "./vendorCategories/vendorCategoriesPage.js";
import { renderVendorDocuments } from "./vendorDocumentsPage.js";

// ---- Company profile & documents (the prototype's vendor profile): the
// read-only company details on the left; document vault and category
// declaration on the right. ----
export async function loadVendorProfile() {
  const root = document.getElementById("vendor-profile-root");
  try {
    const v = await api("/vendor-auth/me");
    state.vendor = v;
    const field = (label, value, span = 1) =>
      `<div style="grid-column:span ${span}"><div class="ep-k" style="margin-bottom:4px">${label}</div><div class="ep-box">${esc(value || "—")}</div></div>`;
    root.innerHTML = `<div class="ep-grid" style="grid-template-columns:1fr 1fr">
      <div class="ep-pane ep-pane-pad">
        <div style="font-size:14px;font-weight:800;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">Company &amp; statutory details ${stateTag(v.status)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:13px 16px">
          ${field("Legal name", v.legal_name, 2)}
          ${field("GSTIN", v.gstin)}${field("PAN", v.pan)}
          ${field("Primary contact", v.contact_person)}${field("Phone", v.phone)}
          ${field("Email (login)", v.email, 2)}
          ${v.rejection_reason ? field("Note on file", v.rejection_reason, 2) : ""}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px">
        <div id="vendor-documents-list"></div>
        <div id="vendor-category-picker"></div>
      </div>
    </div>`;
    renderVendorDocuments(document.getElementById("vendor-documents-list"));
    renderVendorCategories(document.getElementById("vendor-category-picker"));
  } catch (err) {
    root.innerHTML = `<div class="result err">Could not load profile: ${esc(err.message)}</div>`;
  }
}
