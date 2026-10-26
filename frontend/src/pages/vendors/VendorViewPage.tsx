import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import { useAuthState } from "../../lib/authStore";
import type { ItemRequirement, VendorDetail, VendorDocument, VendorStatusHistoryEntry } from "../../lib/types";
import { refreshChrome, switchView } from "../../lib/bridge";
import { useModal } from "../../components/useModal";
import { canPreviewInApp } from "../../components/DocumentPreviewModal";
import { IdentityPane } from "./IdentityPane";
import { DocsPane } from "./DocsPane";
import { RequirementsPane } from "./RequirementsPane";
import { HistoryPane } from "./HistoryPane";
import { DecisionBar, type Decision } from "./DecisionBar";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js -- Phase 2b of the
// React migration (see .claude-notes/REACT-MIGRATION-PLAN.md). Reached via
// the Vendor List's View button or a dashboard deep link, both of which
// just navigate to /vendor-view/:id now. Real bug, fixed 2026-10-22: the id
// used to arrive through transient module state (lib/bridge.ts's
// takeViewVendorId()) instead of the URL, which a refresh or a direct link
// never had -- this page rendered with vendorId stuck at null, forever
// blank. useParams() reads it from the URL itself, which a refresh keeps.

const post = (path: string, body?: unknown) => api(path, body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });

export function VendorViewPage() {
  const { id } = useParams();
  const vendorId = id ? Number(id) : null;
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [docs, setDocs] = useState<VendorDocument[]>([]);
  const [history, setHistory] = useState<VendorStatusHistoryEntry[]>([]);
  const [requirements, setRequirements] = useState<ItemRequirement[]>([]);
  const [reviewedDocIds, setReviewedDocIds] = useState<Set<number>>(new Set());
  // Real bug, found 2026-10-15: fetched /auth/me itself for a role check
  // that's already sitting in the shared auth store (AuthBoot.tsx) -- same
  // redundant-fetch pattern found on DashboardPage, and a race against
  // AuthBoot's own fetch of the identical endpoint whenever this page
  // mounts right after a login/refresh (user still null at that moment).
  const currentUser = useAuthState().user;
  const [error, setError] = useState("");
  const { confirmAsync, reasonAsync, alertAsync, openPreview, modalElement } = useModal();

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

  const openDocument = async (docId: number, filename: string): Promise<boolean> => {
    try {
      const res = await fetch(API_BASE + `/vendors/${vendorId}/documents/${docId}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open document");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (canPreviewInApp(blob.type)) openPreview({ url, filename, contentType: blob.type }, () => URL.revokeObjectURL(url));
      else window.open(url, "_blank");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleViewDoc = async (docId: number, filename: string) => {
    if (await openDocument(docId, filename)) {
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
    const reason = await reasonAsync({
      title: "Reject document",
      placeholder: "e.g. Certificate has expired",
      confirmLabel: "Reject document",
      danger: true,
      maxLength: 300,
    });
    if (!reason) return;
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
        const reason = await reasonAsync({
          title: "Reject vendor registration",
          message: "This blacklists the candidate -- they can be reinstated later, with a reason.",
          placeholder: "e.g. GST certificate could not be verified against GSTN records",
          confirmLabel: "Reject vendor",
          danger: true,
        });
        if (!reason) return;
        await post(`/vendors/${vendor.id}/reject`, { reason });
      } else if (kind === "suspend") {
        const reason = await reasonAsync({
          title: "Suspend vendor",
          message: `${vendor.legal_name} will be blocked from bidding, new mappings and new invitations. History and existing mappings are kept.`,
          placeholder: "e.g. Repeated late deliveries on PO-2048 and PO-2063",
          confirmLabel: "Suspend vendor",
          danger: true,
        });
        if (!reason) return;
        await post(`/vendors/${vendor.id}/suspend`, { reason });
      } else if (kind === "reinstate") {
        if (!(await confirmAsync(`Reinstate ${vendor.legal_name} to Active?`, { confirmLabel: "Reinstate" }))) return;
        await post(`/vendors/${vendor.id}/reinstate`, {});
      } else if (kind === "reinstate-blacklisted") {
        const reason = await reasonAsync({
          title: "Reinstate vendor",
          message: `${vendor.legal_name} is currently blacklisted. This is recorded in the status history.`,
          placeholder: "e.g. Compliance issue resolved, GST certificate re-verified",
          confirmLabel: "Reinstate vendor",
        });
        if (!reason) return;
        await post(`/vendors/${vendor.id}/reinstate`, { reason });
      } else if (kind === "blacklist") {
        const reason = await reasonAsync({
          title: "Blacklist vendor",
          message: `${vendor.legal_name} will be blocked from logging in, bidding, being mapped or invited -- it can be reinstated later, with a reason.`,
          placeholder: "e.g. Confirmed bid collusion on Tender #142",
          confirmLabel: "Blacklist vendor",
          danger: true,
        });
        if (!reason) return;
        await post(`/vendors/${vendor.id}/blacklist`, { reason });
      } else {
        const note = await reasonAsync({
          title: "Request more information",
          placeholder: "e.g. Please re-upload a GST certificate that has not expired",
          confirmLabel: "Request info",
        });
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

  // Vendor decisions are System-Admin-only now (2026-10-26, user-directed) --
  // this page itself is unreachable to any other role, so this is really
  // just documenting the mirrored backend gate (vendors.py's
  // VENDOR_DECISION_ROLES), not distinguishing anyone out.
  const canReinstateBlacklisted = currentUser?.role === "system_admin";

  return (
    <div className="d-flex flex-col gap-18px">
      {backLink}
      <IdentityPane v={vendor} />
      {vendor.expedited_review_tender_id != null && (vendor.status === "pending_verification" || vendor.status === "info_requested") && (
        <div className="ep-note">Flagged urgent for tender #{vendor.expedited_review_tender_id}.</div>
      )}
      <DocsPane
        docs={docs}
        reviewedDocIds={reviewedDocIds}
        onViewDoc={handleViewDoc}
        onVerify={handleVerify}
        onReject={handleReject}
        onViewReason={(reason) => alertAsync(reason, "Rejection reason")}
      />
      <RequirementsPane reqs={requirements} />
      <HistoryPane history={history} />
      <DecisionBar vendor={vendor} docs={docs} canReinstateBlacklisted={canReinstateBlacklisted} onDecide={decide} />
      {error && <div className="result err">{error}</div>}
      {modalElement}
    </div>
  );
}
