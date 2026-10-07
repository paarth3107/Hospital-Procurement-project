import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { esc, stateTag, imgPlaceholder } from "../kit.js";
import { renderVendorDocuments } from "./vendorDocumentsPage.js";
import { refreshChrome } from "../nav.js";

// ---- Company profile & documents: read-only company details on the left,
// the document vault on the right. Category declaration moved to its own
// tab (2026-09-30) -- it's a different concern from KYC document review.
// Commercial terms (2026-10-01): no longer collected at registration (it's
// optional, spec §3.2), so this is the only place a vendor can ever set it --
// the one editable bit of an otherwise read-only profile. ----
function commercialTermsForm(v) {
  return `<div class="ep-pane ep-pane-pad">
    <div class="fs-14px fw-800 mb-4px">Commercial terms (optional)</div>
    <p class="hint margin-0-0-12px">Shown to staff for reference; nothing here gates your bidding.</p>
    <div class="d-grid grid-cols-1fr-1fr gap-13px-16px">
      <div><div class="ep-k mb-4px">Standard payment terms</div><input class="input" id="ct-payment-terms" value="${esc(v.payment_terms || "")}"></div>
      <div><div class="ep-k mb-4px">Delivery lead time (days)</div><input class="input" id="ct-lead-time" type="number" min="0" value="${v.delivery_lead_time_days ?? ""}"></div>
      <div class="col-span-2"><div class="ep-k mb-4px">Minimum order value (₹)</div><input class="input" id="ct-min-order" type="number" min="0" step="any" value="${v.min_order_value ?? ""}"></div>
    </div>
    <div class="mt-12px d-flex items-center gap-12px">
      <button class="ep-b" data-v="p" id="ct-save">Save commercial terms</button>
      <div id="ct-result" class="result"></div>
    </div>
  </div>`;
}

function wireCommercialTermsForm(root) {
  root.querySelector("#ct-save").addEventListener("click", async () => {
    const num = (v) => (v === "" ? null : Number(v));
    const body = {
      payment_terms: root.querySelector("#ct-payment-terms").value.trim() || null,
      delivery_lead_time_days: num(root.querySelector("#ct-lead-time").value),
      min_order_value: num(root.querySelector("#ct-min-order").value),
    };
    try {
      const v = await api("/vendor-portal/commercial-terms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      state.vendor = v;
      showResult(root.querySelector("#ct-result"), "Saved.", true);
    } catch (err) {
      showResult(root.querySelector("#ct-result"), err.message, false);
    }
  });
}

export async function loadVendorProfile() {
  const root = document.getElementById("vendor-profile-root");
  try {
    const v = await api("/vendor-auth/me");
    state.vendor = v;
    const field = (label, value, span = 1) =>
      `<div class="col-span-${span}"><div class="ep-k mb-4px">${label}</div><div class="ep-box">${esc(value || "—")}</div></div>`;
    root.innerHTML = `<div class="ep-grid grid-cols-1fr-1fr">
      <div class="d-flex flex-col gap-18px">
        <div class="ep-pane ep-pane-pad">
          <div class="fs-14px fw-800 mb-14px d-flex justify-between items-center">Company &amp; statutory details ${stateTag(v.status)}</div>
          <div class="d-flex items-center gap-14px mb-16px">
            ${imgPlaceholder("image", "md")}
            <div class="ep-sub">Company logo — reserved for later, no upload yet</div>
          </div>
          <div class="d-grid grid-cols-1fr-1fr gap-13px-16px">
            ${field("Legal name", v.legal_name, 2)}
            ${field("Trade name", v.trade_name)}${field("Entity type", v.entity_type)}
            ${field("Year of incorporation", v.year_of_incorporation)}${field("GSTIN", v.gstin)}
            ${field("PAN", v.pan)}${field("Website", v.website)}
            ${field("Address line", v.registered_address, 2)}
            ${field("City", v.city)}${field("State", v.state)}
            ${field("Pincode", v.pincode)}
            ${field("Alternate / correspondence address", v.alternate_address, 2)}
            ${field("Branch locations", v.branch_locations, 2)}
            ${field("Bank", [v.bank_name, v.bank_ifsc].filter(Boolean).join(" · "))}${field("Account number", v.bank_account_number)}
            ${field("Primary contact", [v.contact_person, v.contact_designation].filter(Boolean).join(", "))}${field("Phone", v.phone)}
            ${field("Email (login)", v.email, 2)}
            ${field("Escalation contact", [v.escalation_contact_name, v.escalation_contact_phone, v.escalation_contact_email].filter(Boolean).join(" · "), 2)}
            ${v.rejection_reason ? field("Note on file", v.rejection_reason, 2) : ""}
          </div>
        </div>
        ${commercialTermsForm(v)}
      </div>
      <div class="d-flex flex-col gap-18px">
        <div id="vendor-documents-list"></div>
      </div>
    </div>`;
    wireCommercialTermsForm(root);
    renderVendorDocuments(document.getElementById("vendor-documents-list"), refreshChrome);
  } catch (err) {
    root.innerHTML = `<div class="result err">Could not load profile: ${esc(err.message)}</div>`;
  }
}
