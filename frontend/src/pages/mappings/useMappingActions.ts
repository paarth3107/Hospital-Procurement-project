import { useState } from "react";
import { useModal } from "../../components/useModal";
import { refreshChrome } from "../../lib/chromeStore";
import { patchCachedMapping } from "../../lib/catalogCache";
import { toastError, toastSuccess } from "../../lib/toastStore";
import { approveMapping, createMapping, rejectMapping, reinstateMapping, suspendMapping } from "../../lib/mappingActions";
import type { VendorLookup, VendorMapping } from "../../lib/types";

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
//
// Real bug, found 2026-10-15: `onChanged` used to take no arguments, so
// every page passed loadMappingData() itself as the callback -- a full
// 6-endpoint reload (vendors, categories, subcategories, products,
// mappings, ratings) after EVERY single decision, just to reflect the one
// mapping row that changed. Each decision endpoint already returns the
// updated VendorMapping (mappings.py's response_model); handing it to
// onChanged lets the page patch that one row in place (see
// mappingData.ts's withPatchedMapping) instead of refetching anything.
export function useMappingActions(onChanged: (updated: VendorMapping) => void) {
  const { confirmAsync, reasonAsync, alertAsync, modalElement } = useModal();
  const [error, setError] = useState("");

  // `label` names the record in both the success and error toast (2026-10-27,
  // user-directed: "Category Manager" ticket wants "a clear message that
  // names the record and the result" for every create/update/delete/status
  // action) -- falls back to a plain "the mapping" when a caller doesn't
  // have a nicer description in scope.
  const run = async (fn: () => Promise<VendorMapping>, verb: string, pastTense: string, label?: string) => {
    try {
      const updated = await fn();
      setError("");
      // Keeps the shared cache (catalogCache.ts) correct too, not just this
      // page's own copy of the data -- otherwise the next page (or this one,
      // after a remount) would read the stale pre-decision mapping back out
      // of the cache instead of refetching OR seeing the real current state.
      patchCachedMapping(updated);
      onChanged(updated);
      // Every mapping decision (approve/reject/suspend/reinstate) changes
      // badgeMappings -- found 2026-10-15, alongside removing AppShell's
      // blanket per-navigation chrome refresh: that used to paper over
      // this page never telling chromeStore a decision happened at all.
      refreshChrome();
      toastSuccess(`${label ? `${label} — ` : ""}mapping ${pastTense}.`);
    } catch (err) {
      const message = `Could not ${verb}${label ? ` for ${label}` : ""}: ` + (err instanceof Error ? err.message : String(err));
      setError(message);
      toastError(message);
    }
  };

  const mapAndApprove = async (vendor: VendorLookup, target: { category_id: number } | { product_master_id: number }, targetLabel?: string) => {
    if (vendor.status !== "active") {
      await alertAsync(`${vendor.legal_name} isn't Active yet — only an Active, approved vendor can be mapped.`);
      return;
    }
    await run(
      async () => {
        const mapping = await createMapping(vendor.id, target);
        return await approveMapping(mapping.id);
      },
      "map",
      "mapped and approved",
      targetLabel ? `${vendor.legal_name} — ${targetLabel}` : vendor.legal_name
    );
  };

  const approve = (id: number, vendor?: VendorLookup, targetLabel?: string) =>
    run(() => approveMapping(id), "approve", "approved", vendor && targetLabel ? `${vendor.legal_name} — ${targetLabel}` : undefined);

  const reject = async (id: number, vendor?: VendorLookup, targetLabel?: string) => {
    const reason = await reasonAsync({
      title: "Reject mapping request",
      placeholder: "e.g. Required certification for this category is missing",
      confirmLabel: "Reject mapping",
      danger: true,
    });
    if (!reason) return;
    await run(() => rejectMapping(id, reason), "reject", "rejected", vendor && targetLabel ? `${vendor.legal_name} — ${targetLabel}` : undefined);
  };

  const suspend = async (id: number, vendor: VendorLookup, targetLabel: string) => {
    const reason = await reasonAsync({
      title: "Suspend mapping",
      message: `${vendor.legal_name} — ${targetLabel}`,
      placeholder: "e.g. Quality issue reported on the last 2 deliveries",
      confirmLabel: "Suspend mapping",
      danger: true,
    });
    if (!reason) return;
    await run(() => suspendMapping(id, reason), "suspend", "suspended", `${vendor.legal_name} — ${targetLabel}`);
  };

  const reinstate = async (id: number, vendor: VendorLookup, targetLabel: string) => {
    const ok = await confirmAsync(`Reinstate ${vendor.legal_name} — ${targetLabel} back to Approved?`, { confirmLabel: "Reinstate" });
    if (!ok) return;
    await run(() => reinstateMapping(id), "reinstate", "reinstated", `${vendor.legal_name} — ${targetLabel}`);
  };

  return { mapAndApprove, approve, reject, suspend, reinstate, alertAsync, modalElement, error, setError };
}
