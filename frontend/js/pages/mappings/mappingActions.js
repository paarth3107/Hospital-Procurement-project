import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { modalPrompt, modalConfirm, modalChoose } from "../../modal.js";

// The things staff can do to one mapping, shared by the category matrix,
// the item matrix and the mapping list. Each returns true if something
// changed, so the caller knows to refresh.

const resultEl = () => document.getElementById("mapping-result");
const post = (path, body) =>
  api(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });

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
