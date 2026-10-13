import { useCallback, useEffect, useState } from "react";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import type { CurrentUser, ItemRequirement, VendorDetail, VendorDocument, VendorStatusHistoryEntry } from "../../lib/types";
import { takeViewVendorId, refreshChrome, switchView } from "../../lib/bridge";
import { useModal } from "../../components/useModal";
import { IdentityPane } from "./IdentityPane";
import { DocsPane } from "./DocsPane";
import { RequirementsPane } from "./RequirementsPane";
import { HistoryPane } from "./HistoryPane";
import { DecisionBar, type Decision } from "./DecisionBar";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js -- Phase 2b of the
// React migration (see .claude-notes/REACT-MIGRATION-PLAN.md). Reached via
// the (now React) Vendor List's View button, or a dashboard deep link --
// either way, the vendor id to show arrives through the same window-backed
// bridge vendorViewState.js now uses (lib/bridge.ts's takeViewVendorId()).

const post = (path: string, body?: unknown) => api(path, body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });

export function VendorViewPage() {
  const [vendorId] = useState<number | null>(() => takeViewVendorId());
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [docs, setDocs] = useState<VendorDocument[]>([]);
  const [history, setHistory] = useState<VendorStatusHistoryEntry[]>([]);
  const [requirements, setRequirements] = useState<ItemRequirement[]>([]);
  const [reviewedDocIds, setReviewedDocIds] = useState<Set<number>>(new Set());
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState("");
  const { promptAsync, confirmAsync, modalElement } = useModal();

  const load = useCallback(async () => {
    if (vendorId === null) return;
    try {
      const [v, d, h, r] = await Promise.all([
        api<VendorDetail>(`/vendors/${vendorId}`),
        api<VendorDocument[]>(`/vendors/${vendorId}/documents`),
        api<VendorStatusHistoryEntry[]>(`/vendors/${vendorId}/status-history`),
        api<ItemRequirement[]>(`/vendors/${vendorId}/document-requirements`),
      ]);
      setVendor(v);
      setDocs(d);
      setHistory(h);
      setRequirements(r);
      setError("");
    } catch (err) {
      setError("Could not load vendor: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [vendorId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<CurrentUser>("/auth/me")
      .then(setCurrentUser)
      .catch(() => {});
  }, []);

  const openDocument = async (docId: number): Promise<boolean> => {
    try {
      const res = await fetch(API_BASE + `/vendors/${vendorId}/documents/${docId}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open document");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleViewDoc = async (docId: number) => {
    if (await openDocument(docId)) {
      setReviewedDocIds((prev) => new Set(prev).add(docId));
    }
  };

  const handleVerify = async (docId: number) => {
    try {
      await post(`/vendors/${vendorId}/documents/${docId}/verify`);
      // Update local state immediately rather than waiting on load()'s
      // round-trip (a separate 4-way fetch) -- gates like DecisionBar's
      // mandatoryIssue read straight from this `docs` state, so a visible
      // gap between "the action succeeded" and "the page reflects it" is a
      // real window where a gate can look like it isn't enforced yet, even
      // though it's purely a rendering lag, not a logic bug. load() still
      // runs after, for the fully authoritative server state (reviewed_by,
      // reviewed_at, etc. this optimistic patch doesn't know about).
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, status: "verified", rejection_reason: null } : d)));
      load();
    } catch (err) {
      setError("Could not update document: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleReject = async (docId: number) => {
    const reason = await promptAsync("Reason for rejecting this document (required):");
    if (!reason) return;
    if (!(await confirmAsync(`Reject this document? Reason: "${reason}"`, { title: "Reject Document", confirmLabel: "Reject document", danger: true }))) return;
    try {
      await post(`/vendors/${vendorId}/documents/${docId}/reject`, { reason });
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, status: "rejected", rejection_reason: reason } : d)));
      load();
    } catch (err) {
      setError("Could not update document: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const decide = async (kind: Decision) => {
    if (!vendor) return;
    try {
      if (kind === "approve") {
        if (!(await confirmAsync("Approve this vendor? They'll become Active and can start requesting catalog mappings.", { confirmLabel: "Approve" }))) return;
        await post(`/vendors/${vendor.id}/approve`);
        setError("");
      } else if (kind === "reject") {
        const reason = await promptAsync("Reason for rejecting this registration (required):");
        if (!reason) return;
        if (!(await confirmAsync(`Reject this candidate's registration? Reason: "${reason}"`, { title: "Reject Candidate", confirmLabel: "Reject candidate", danger: true }))) return;
        await post(`/vendors/${vendor.id}/reject`, { reason });
      } else if (kind === "suspend") {
        const reason = await promptAsync(`Reason for suspending ${vendor.legal_name} (required):`);
        if (!reason) return;
        await post(`/vendors/${vendor.id}/suspend`, { reason });
      } else if (kind === "reinstate") {
        if (!(await confirmAsync(`Reinstate ${vendor.legal_name} to Active?`, { confirmLabel: "Reinstate" }))) return;
        await post(`/vendors/${vendor.id}/reinstate`, {});
      } else if (kind === "reinstate-blacklisted") {
        const reason = await promptAsync(`Explicit reason for reinstating ${vendor.legal_name} (required — recorded in the status history):`);
        if (!reason) return;
        await post(`/vendors/${vendor.id}/reinstate`, { reason });
      } else if (kind === "blacklist") {
        const reason = await promptAsync(`Reason for blacklisting ${vendor.legal_name} (required — it can be reinstated later, with a reason):`);
        if (!reason) return;
        await post(`/vendors/${vendor.id}/blacklist`, { reason });
      } else {
        const note = await promptAsync("Note to the vendor explaining what's needed (required):");
        if (!note) return;
        await post(`/vendors/${vendor.id}/request-info`, { note });
      }
      await load(); // this vendor's own data changed -- refresh it in place rather than leaving
      refreshChrome();
    } catch (err) {
      setError("Could not complete that: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Real bug, found 2026-10-12 (Final Phase): this back-link used to be
  // vanilla markup sitting in index.html, always shown above this page's
  // own root div -- it relied on nav.js's generic ".back-link" wiring, not
  // anything this component rendered itself. Now that the vanilla shell is
  // gone, the page needs its own, same as every other ported page already
  // has (BidPage's "Back to invitations", etc.).
  const backLink = (
    <button className="back-link" onClick={() => switchView("queue")}>
      ← Back to Vendor List
    </button>
  );

  if (vendorId === null) {
    return (
      <>
        {backLink}
        <div className="ep-pane ep-pane-pad hint">No vendor selected.</div>
      </>
    );
  }
  if (error && !vendor) {
    return (
      <>
        {backLink}
        <div className="result err">{error}</div>
      </>
    );
  }
  if (!vendor) return backLink;

  const canReinstateBlacklisted = currentUser ? ["procurement_admin", "category_manager", "system_admin"].includes(currentUser.role) : false;

  return (
    <div className="d-flex flex-col gap-18px">
      {backLink}
      <IdentityPane v={vendor} />
      <DocsPane docs={docs} reviewedDocIds={reviewedDocIds} onViewDoc={handleViewDoc} onVerify={handleVerify} onReject={handleReject} />
      <RequirementsPane reqs={requirements} />
      <HistoryPane history={history} />
      <DecisionBar vendor={vendor} docs={docs} canReinstateBlacklisted={canReinstateBlacklisted} onDecide={decide} />
      {error && <div className="result err">{error}</div>}
      {modalElement}
    </div>
  );
}
