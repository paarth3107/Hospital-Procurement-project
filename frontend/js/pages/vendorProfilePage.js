import { api } from "../api.js";
import { state } from "../state.js";
import { renderVendorCategoryPicker } from "./vendorCategoriesPage.js";
import { renderVendorDocuments } from "./vendorDocumentsPage.js";

// "My Profile" is the vendor's own-account home: sub-tabs for read-only
// company details and the document uploads (moved here from its own tab).
export function setProfileSubtab(name) {
  document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.toggle("active", b.dataset.subtab === name));
  document.querySelectorAll(".subtab-panel").forEach((p) => (p.hidden = p.id !== "profile-subtab-" + name));
}

export async function loadVendorProfile() {
  setProfileSubtab("details");
  renderVendorDocuments();
  renderVendorCategoryPicker();
  const el = document.getElementById("vendor-profile-details");
  try {
    const v = await api("/vendor-auth/me");
    state.vendor = v;
    const row = (k, val) => `<dt>${k}</dt><dd>${val || "—"}</dd>`;
    el.innerHTML = `<dl class="profile-grid">
      ${row("Legal Name", v.legal_name)}
      ${row("GSTIN", v.gstin)}
      ${row("PAN", v.pan)}
      ${row("Contact Person", v.contact_person)}
      ${row("Email", v.email)}
      ${row("Phone", v.phone)}
      ${row("Status", `<span class="status-pill status-${v.status}">${v.status.replace("_", " ")}</span>`)}
      ${v.rejection_reason ? row("Reason", v.rejection_reason) : ""}
    </dl>`;
  } catch (err) {
    el.textContent = "Could not load profile: " + err.message;
  }
}

document.querySelectorAll(".subtab-btn").forEach((b) => b.addEventListener("click", () => setProfileSubtab(b.dataset.subtab)));
