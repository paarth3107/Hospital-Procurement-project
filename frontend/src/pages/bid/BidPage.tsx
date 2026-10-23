import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import { switchView } from "../../lib/bridge";
import { fmtDate, fmtDateTime } from "../../lib/format";
import { Tag } from "../../components/Tag";
import { useModal } from "../../components/useModal";
import { canPreviewInApp } from "../../components/DocumentPreviewModal";
import { BidLineItemsGrid, type BidLineItemsGridHandle } from "./BidLineItemsGrid";
import type { TenderBids } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/bid/bidPage.js -- a thin shell around
// the bid grid: this page only owns loading the tender's bid data and
// rendering the header above the grid, plus the CSV/save/submit/reopen
// controls that sit around it (all exposed by the grid through a ref,
// same reasoning as the Tender Editor's LineItemsGrid).
//
// `tenderId` comes from the `/bid/:id` route param (bug fix, 2026-10-23: it
// used to come from a pending-bid bridge module variable set by whichever
// page navigated here, which meant a refresh or a direct/bookmarked link
// lost the id and silently bounced the vendor back to their dashboard --
// same root cause as the VendorViewPage/TenderEditorPage/ApprovalsPage/
// AwardsPage fixes earlier this session). <BidLineItemsGrid> still mounts
// on the same first render the id is known on, before the tender fetch
// resolves -- the grid's ref needs to already exist the moment the effect
// calls `gridRef.current.loadRows(...)`, same ordering requirement the
// Tender Editor's grid has.
type TenderCtx = Omit<TenderBids, "lines">;

export function BidPage() {
  const { id } = useParams();
  const tenderId = id ? Number(id) : null;
  const [ctx, setCtx] = useState<TenderCtx | null>(null);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [linesVersion, setLinesVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<BidLineItemsGridHandle>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const { openPreview, modalElement } = useModal();

  useEffect(() => {
    if (tenderId == null) {
      switchView("vendor-dashboard");
      return;
    }
    (async () => {
      try {
        const data = await api<TenderBids>(`/vendor-portal/bids/tender/${tenderId}`);
        const { lines, ...rest } = data;
        setCtx(rest);
        gridRef.current?.loadRows(lines);
      } catch (err) {
        setLoadError("Could not load the bid form: " + (err instanceof Error ? err.message : String(err)));
      }
    })();
  }, [tenderId]);

  const view = async (endpoint: string, filename: string) => {
    if (!ctx) return;
    try {
      const res = await fetch(`${API_BASE}/vendor-portal/bids/tender/${ctx.tender_id}/${endpoint}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open the file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (canPreviewInApp(blob.type)) openPreview({ url, filename, contentType: blob.type }, () => URL.revokeObjectURL(url));
      else window.open(url, "_blank");
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  const saveAll = async () => {
    setSaving(true);
    const r = await gridRef.current?.saveAllDrafts();
    setSaving(false);
    if (r) setResult(r);
  };

  const submit = async () => {
    const r = await gridRef.current?.submitBid();
    if (r) setResult(r);
  };

  const reopen = async () => {
    const r = await gridRef.current?.reopenBid();
    if (r) setResult(r);
  };

  const downloadTemplate = () => gridRef.current?.downloadTemplate();

  const onCsvFileChosen = async (file: File) => {
    const text = await file.text();
    const errors = gridRef.current?.applyCsvImport(text) ?? [];
    setResult(errors.length ? { message: `${errors.length} row(s) need fixing: ${errors.join("; ")}`, ok: false } : null);
  };

  if (tenderId == null) return null; // switchView("vendor-dashboard") above handles this
  if (loadError) return <div className="result err">{loadError}</div>;

  void linesVersion; // read only to force the re-render that recomputes gate info below with fresh rows
  const gate = gridRef.current?.gateInfo();

  return (
    <div>
      <div>
        <button className="ep-b" onClick={() => switchView("vendor-dashboard")}>
          ← Back to invitations
        </button>
      </div>

      {ctx && (
        <div className="ep-pane ep-pane-pad mt-14px">
          <div className="d-flex gap-24px items-center flex-wrap">
            <div className="flex-1 minw-260px">
              <div className="ep-k">
                Tender #{ctx.tender_id} · {ctx.tender_type.toUpperCase()} · {ctx.facility_name}
              </div>
              <h4 className="margin-4px-0-3px fs-21px">
                {ctx.tender_title} {ctx.open_tender && <Tag text="Open tender" tone="att" />} {ctx.is_rate_contract && <Tag text="Rate contract" tone="att" />}
              </h4>
            </div>
            <div>
              <div className="ep-k">Closes</div>
              <div className="fw-700 mt-3px">{fmtDateTime(ctx.bid_due_date)}</div>
            </div>
            {ctx.is_rate_contract && (
              <div>
                <div className="ep-k">Rate contract period</div>
                <div className="fw-700 mt-3px">
                  {fmtDate(ctx.contract_start_date)} – {fmtDate(ctx.contract_end_date)}
                </div>
              </div>
            )}
          </div>
          {ctx.tender_description && <div className="hint mt-10px">{ctx.tender_description}</div>}
          {ctx.terms_document_filename && (
            <div className="mt-12px">
              <div className="ep-k">Terms &amp; conditions</div>
              <button type="button" className="ep-b mt-4px" onClick={() => view("terms-document", ctx.terms_document_filename!)}>
                {ctx.terms_document_filename} — view
              </button>
            </div>
          )}
          {ctx.rate_contract_document_filename && (
            <div className="mt-12px">
              <div className="ep-k">Rate contract agreement</div>
              <button type="button" className="ep-b mt-4px" onClick={() => view("rate-contract-document", ctx.rate_contract_document_filename!)}>
                {ctx.rate_contract_document_filename} — view
              </button>
            </div>
          )}
        </div>
      )}

      <div className="d-flex items-center gap-12px flex-wrap mt-14px">
        <span className="fs-14px fw-800">Your bid lines</span>
        <span className="hint">fill in a line or mark it Skip · click Details for technical answers, compliance and attachments</span>
        <div className="flex-1"></div>
        <button type="button" className="ep-b" onClick={downloadTemplate}>
          Download CSV template
        </button>
        <button type="button" className="ep-b" onClick={() => csvFileInputRef.current?.click()}>
          Upload CSV
        </button>
        <input
          ref={csvFileInputRef}
          type="file"
          accept=".csv"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) await onCsvFileChosen(file);
          }}
        />
        <button type="button" className="ep-b" disabled={saving} onClick={saveAll}>
          Save all drafts
        </button>
      </div>

      <BidLineItemsGrid ref={gridRef} tenderId={tenderId} onChange={() => setLinesVersion((v) => v + 1)} />

      <div className="ep-pane padding-14px-16px d-flex items-center gap-14px border-left-3px-solid-danger mt-14px">
        <div className="flex-1">
          <div className="fs-13px fw-800 text-danger-700">{gate?.title ?? "Not ready to submit"}</div>
          <div className="hint mt-2px">{gate?.body ?? "Answer every line (bid or skip) before you can submit."}</div>
        </div>
        {gate?.isSubmitted && (
          <button type="button" className="ep-b" onClick={reopen}>
            Reopen for editing
          </button>
        )}
        {!gate?.isSubmitted && (
          <button type="button" className="ep-b" data-v="p" disabled={!gate || gate.submitDisabled} onClick={submit}>
            Submit Bid
          </button>
        )}
      </div>
      {result && <div className={`result ${result.ok ? "ok" : "err"} mt-10px`}>{result.message}</div>}
      {modalElement}
    </div>
  );
}
