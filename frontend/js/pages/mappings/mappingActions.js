import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { modalPrompt, modalConfirm, modalChoose, modalAlert } from "../../modal.js";

// The things staff can do to one mapping, shared by the category matrix,
// the item matrix and the mapping list. Each returns true if something
// changed, so the caller knows to refresh.

const resultEl = () => document.getElementById("mapping-result");
const post = (path, body) =>
  api(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });

export async function mapAndApprove(vendor, target, targetLabel, { confirm = true } = {}) {
  if (vendor.status !== "active") {
    await modalAlert(`${vendor.legal_name} isn't Active yet — only an Active, approved vendor can be mapped.`);
    return false;
  }
  if (confirm) {
    const ok = await modalConfirm(`Map ${vendor.legal_name} to ${targetLabel} and approve immediately?`, { confirmLabel: "Map & Approve" });
    if (!ok) return false;
  }
  try {
    const mapping = await post("/mappings", { vendor_id: vendor.id, ...target });
    await post(`/mappings/${mapping.id}/approve`);
    showResult(resultEl(), `Mapped ${vendor.legal_name} to ${targetLabel} and approved.`, true);
    return true;
  } catch (err) {
    // e.g. the minimum-rating gate for restricted categories/items
    showResult(resultEl(), "Could not map: " + err.message, false);
    return true; // the request row may exist as Pending now -- refresh either way
  }
}

export async function suspendMapping(mapping, vendor, targetLabel) {
  const reason = await modalPrompt(`Reason for suspending ${vendor.legal_name} — ${targetLabel} (required):`);
  if (!reason) return false;
  return act(() => post(`/mappings/${mapping.id}/suspend`, { reason }), `Suspended ${vendor.legal_name} — ${targetLabel}.`, "suspend");
}

export async function reinstateMapping(mapping, vendor, targetLabel) {
  const ok = await modalConfirm(`Reinstate ${vendor.legal_name} — ${targetLabel} back to Approved?`, { confirmLabel: "Reinstate" });
  if (!ok) return false;
  return act(() => post(`/mappings/${mapping.id}/reinstate`), `Reinstated ${vendor.legal_name} — ${targetLabel}.`, "reinstate");
}

export async function approveMapping(mapping) {
  return act(() => post(`/mappings/${mapping.id}/approve`), "Mapping approved.", "approve");
}

export async function rejectMapping(mapping) {
  const reason = await modalPrompt("Reason for rejecting (required):");
  if (!reason) return false;
  return act(() => post(`/mappings/${mapping.id}/reject`, { reason }), "Mapping rejected.", "reject");
}

// A pending cell: one click, choose approve or reject.
export async function decidePendingMapping(mapping, vendor, targetLabel) {
  const choice = await modalChoose(`${vendor.legal_name} requested ${targetLabel}. What would you like to do?`, [
    { value: "approve", label: "Approve" },
    { value: "reject", label: "Reject" },
  ]);
  if (choice === "approve") return approveMapping(mapping);
  if (choice === "reject") return rejectMapping(mapping);
  return false;
}

async function act(call, successMessage, verb) {
  try {
    await call();
    showResult(resultEl(), successMessage, true);
  } catch (err) {
    showResult(resultEl(), `Could not ${verb}: ${err.message}`, false);
  }
  return true;
}
