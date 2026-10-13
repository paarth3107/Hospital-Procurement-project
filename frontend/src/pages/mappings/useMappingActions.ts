import { useState } from "react";
import { useModal } from "../../components/useModal";
import { approveMapping, createMapping, rejectMapping, reinstateMapping, suspendMapping } from "../../lib/mappingActions";
import type { VendorLookup } from "../../lib/types";

// Ported from frontend/js/pages/mappings/mappingActions.js's decision
// functions, minus the modalPrompt/modalConfirm/modalAlert calls baked into
// each one there (those are useModal here, same choreography) and minus the
// "which of the two pages' result div is visible" lookup (a real bug once,
// now impossible -- the caller owns its own error state). Shared by both
// Mapping Matrix (the detail dialog's actions) and Mapping Requests (the
// list's row actions), so the prompt/confirm/error choreography lives in
// one place, not duplicated per page.
//
// mapAndApprove skips a confirm step entirely -- the vanilla version's
// confirm:true default is never actually used (it's only ever called from
// the detail dialog with confirm:false), so there's nothing to port there.
export function useMappingActions(onChanged: () => void) {
  const { promptAsync, confirmAsync, alertAsync, modalElement } = useModal();
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<unknown>, verb: string) => {
    try {
      await fn();
      setError("");
      onChanged();
    } catch (err) {
      setError(`Could not ${verb}: ` + (err instanceof Error ? err.message : String(err)));
    }
  };

  const mapAndApprove = async (vendor: VendorLookup, target: { category_id: number } | { product_master_id: number }) => {
    if (vendor.status !== "active") {
      await alertAsync(`${vendor.legal_name} isn't Active yet — only an Active, approved vendor can be mapped.`);
      return;
    }
    await run(async () => {
      const mapping = await createMapping(vendor.id, target);
      await approveMapping(mapping.id);
    }, "map");
  };

  const approve = (id: number) => run(() => approveMapping(id), "approve");

  const reject = async (id: number) => {
    const reason = await promptAsync("Reason for rejecting (required):");
    if (!reason) return;
    await run(() => rejectMapping(id, reason), "reject");
  };

  const suspend = async (id: number, vendor: VendorLookup, targetLabel: string) => {
    const reason = await promptAsync(`Reason for suspending ${vendor.legal_name} — ${targetLabel} (required):`);
    if (!reason) return;
    await run(() => suspendMapping(id, reason), "suspend");
  };

  const reinstate = async (id: number, vendor: VendorLookup, targetLabel: string) => {
    const ok = await confirmAsync(`Reinstate ${vendor.legal_name} — ${targetLabel} back to Approved?`, { confirmLabel: "Reinstate" });
    if (!ok) return;
    await run(() => reinstateMapping(id), "reinstate");
  };

  return { mapAndApprove, approve, reject, suspend, reinstate, modalElement, error, setError };
}
