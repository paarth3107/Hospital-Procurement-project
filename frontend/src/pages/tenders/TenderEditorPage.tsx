import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { switchView, takePendingTenderId } from "../../lib/bridge";
import { fmtDateTime, inr } from "../../lib/format";
import { useModal } from "../../components/useModal";
import { useAuthState } from "../../lib/authStore";
import { StateTag } from "../../components/Tag";
import { Req } from "../../components/Req";
import type { CatalogProduct, Facility, LineItem, LineItemEligibility, Tender, TenderStatus, TenderType } from "../../lib/types";
import { LineItemsGrid, type LineItemsGridHandle } from "./LineItemsGrid";
import { mapApiLineItems } from "./lineItemRow";
import { SingleDocumentField } from "./SingleDocumentField";
import { OpenTenderLinkBox } from "./OpenTenderLinkBox";
import { TenderDetail } from "./TenderDetail";

// Ported 1:1 from frontend/js/pages/tenders/tenderForm.js -- the tender
// editor form, reached from the Tender List's Manage/+ New tender (see
// lib/bridge.ts's setPendingTenderId/switchView). One form serves both "New
// Tender" and editing an existing Draft: all header fields plus the full
// line-item list live in it, and "Save as Draft"/"Submit for Approval" both
// persist everything first. Non-Draft tenders open read-only (the header
// fields; see the line-items grid's own note below for the one thing that
// ISN'T gated, matching the vanilla version exactly).
interface FormState {
  facility_id: string;
  title: string;
  description: string;
  tender_type: TenderType;
  department: string;
  min_rating_threshold: string;
  min_invites: string;
  max_invites: string;
  open_tender: boolean;
  is_rate_contract: boolean;
  contract_start_date: string;
  contract_end_date: string;
  bid_due_date: string;
  publish_date: string;
}

const BLANK_FORM: FormState = {
  facility_id: "",
  title: "",
  description: "",
  tender_type: "rfq",
  department: "",
  min_rating_threshold: "0",
  min_invites: "",
  max_invites: "",
  open_tender: false,
  is_rate_contract: false,
  contract_start_date: "",
  contract_end_date: "",
  bid_due_date: "",
  publish_date: "",
};

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TenderEditorPage() {
  const [loadError, setLoadError] = useState("");
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [tender, setTender] = useState<Tender | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [linesVersion, setLinesVersion] = useState(0); // bumped by the grid's onChange -- forces a re-render so the gate (computed fresh below) picks up the new rows
  // Real bug, found 2026-10-14: TenderDetail's Eligible Vendors panel only
  // ever fetched once on mount (tenderId doesn't change across saves), so
  // adding a line and clicking Save as Draft never refreshed it -- only
  // closing and reopening the tender did (that remounts TenderDetail fresh).
  // Bumped on every successful save and passed down so its effect re-runs.
  const [refreshToken, setRefreshToken] = useState(0);
  // User-directed (2026-10-16): the "Required before submission." note next
  // to an empty mandatory document shouldn't sit there from the moment the
  // page loads like a standing validation error -- only once the user has
  // actually tried to move the tender forward (Save as Draft or Send for
  // Approval) and it's still missing.
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  // Real bug, found 2026-10-15: own redundant /auth/me fetch, same pattern
  // as DashboardPage -- the role is already in the shared auth store.
  const currentUser = useAuthState().user;
  const gridRef = useRef<LineItemsGridHandle>(null);
  const { confirmAsync, modalElement } = useModal();

  const currentStatus: TenderStatus = tender?.status ?? "draft";
  const editable = currentStatus === "draft";
  const hasTermsDocument = !!tender?.terms_document_filename;
  const hasRateContractDocument = !!tender?.rate_contract_document_filename;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Real bug, found 2026-10-12: this effect calls gridRef.current?.setRows(...)
  // (via openTender) or ?.startWithBlankRows() to populate the grid -- but
  // the render used to gate the ENTIRE tree (including <LineItemsGrid
  // ref={gridRef}> below) behind a `loaded` flag that only became true AFTER
  // this effect finished. So on every open of an existing tender, the grid
  // had never actually mounted yet at the moment setRows() was called --
  // gridRef.current was null, the optional-chained call silently no-op'd,
  // and the grid was left with its own default empty row state forever
  // (nothing re-populates it later). Line items looked wiped on every open;
  // Split-Award's per-line checkbox (and everything else in the grid) was
  // never actually missing, just never rendered with data. Same ref-mount-
  // ordering bug class caught before in the Tender Editor's own grid
  // (products-prop staleness) and in Prepare Bid (Phase 10d) -- fixed the
  // same way: don't gate a ref-holding child behind a flag the effect
  // itself controls. The `loaded` state was removed entirely; the form now
  // always renders from the first paint (header fields briefly show their
  // blank defaults while the fetch is in flight, same tradeoff every other
  // ported page already accepts), so the grid's ref is guaranteed attached
  // before this effect's async callback ever runs.
  useEffect(() => {
    (async () => {
      try {
        const [facs, prods] = await Promise.all([api<Facility[]>("/facilities"), api<CatalogProduct[]>("/products?active=true")]);
        setFacilities(facs);
        setProducts(prods);
        const id = takePendingTenderId();
        if (id != null) {
          const t = await api<Tender>(`/tenders/${id}`);
          await openTender(t, prods);
        } else {
          setTender(null);
          setForm(BLANK_FORM);
          gridRef.current?.startWithBlankRows();
        }
      } catch (err) {
        setLoadError("Could not load tender: " + (err instanceof Error ? err.message : String(err)));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openTender(t: Tender, prods: CatalogProduct[]) {
    setTender(t);
    setForm({
      facility_id: t.facility_id != null ? String(t.facility_id) : "",
      title: t.title,
      description: t.description || "",
      tender_type: t.tender_type,
      department: t.department || "",
      min_rating_threshold: String(t.min_rating_threshold),
      min_invites: t.min_invites != null ? String(t.min_invites) : "",
      max_invites: t.max_invites != null ? String(t.max_invites) : "",
      open_tender: t.open_tender,
      is_rate_contract: t.is_rate_contract,
      contract_start_date: t.contract_start_date || "",
      contract_end_date: t.contract_end_date || "",
      bid_due_date: t.bid_due_date ? toLocalInputValue(t.bid_due_date) : "",
      publish_date: t.publish_date ? toLocalInputValue(t.publish_date) : "",
    });
    const items = await api<LineItem[]>(`/tenders/${t.id}/line-items`);
    gridRef.current?.setRows(mapApiLineItems(items, prods));
  }

  // `overrides` lets a caller save a field's new value immediately, before
  // the setForm() that would normally carry it has actually re-rendered --
  // see saveDraft's own comment below.
  function buildPayload(overrides: Partial<FormState> = {}) {
    const f = { ...form, ...overrides };
    return {
      // "" (nothing picked yet) must stay null, not Number("") === 0 -- 0
      // isn't a real facility id, and a Draft is allowed to not have one yet
      // (only Submit requires it).
      facility_id: f.facility_id ? Number(f.facility_id) : null,
      title: f.title,
      description: f.description || null,
      tender_type: f.tender_type,
      department: f.department || null,
      min_rating_threshold: f.min_rating_threshold ? Number(f.min_rating_threshold) : 0,
      min_invites: f.min_invites ? Number(f.min_invites) : null,
      max_invites: f.max_invites ? Number(f.max_invites) : null,
      open_tender: f.open_tender,
      is_rate_contract: f.is_rate_contract,
      // Cleared whenever the flag is off, same as open_link_token server-side when open_tender is off.
      contract_start_date: f.is_rate_contract ? f.contract_start_date || null : null,
      contract_end_date: f.is_rate_contract ? f.contract_end_date || null : null,
      publish_date: f.publish_date ? new Date(f.publish_date).toISOString() : null,
      bid_due_date: f.bid_due_date ? new Date(f.bid_due_date).toISOString() : null,
      line_items: gridRef.current?.rowsForPayload() ?? [],
    };
  }

  // Shared by "Save as Draft" and the line-items grid's silent auto-save
  // (onRequestSave below -- there's no "save first" wall before attaching a
  // document, this runs transparently instead). Deliberately does NOT check
  // firstRowProblem() -- that's a whole-grid "is this ready for Submit"
  // check, and a draft must tolerate rows still being filled in.
  // rowsForPayload() already leaves out whatever isn't savable yet; this
  // only ever persists what actually is.
  async function saveDraft(opts: { silent?: boolean; overrides?: Partial<FormState> } = {}): Promise<Tender> {
    if (currentStatus !== "draft") throw new Error("This tender can only be edited while Draft.");
    if (opts.overrides) setForm((f) => ({ ...f, ...opts.overrides }));
    const body = { headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPayload(opts.overrides)) };
    const saved = tender ? await api<Tender>(`/tenders/${tender.id}`, { method: "PUT", ...body }) : await api<Tender>("/tenders", { method: "POST", ...body });
    setTender(saved);
    const items = await api<LineItem[]>(`/tenders/${saved.id}/line-items`);
    gridRef.current?.applySavedLineItems(items);
    if (!opts.silent) setResult({ message: `Tender #${saved.id} saved as draft.`, ok: true });
    setRefreshToken((v) => v + 1);
    return saved;
  }

  // The "no save-first wall" pattern LineItemsGrid's attachments already use
  // (ensureLineSaved -> onRequestSave), mirrored here for anything on the
  // header that needs a real tender id to work at all (T&C/Rate Contract
  // upload, the Open Tender link). Found 2026-10-14: these instead just sat
  // there unusable/hidden with a "Save as Draft first" hint, forcing a
  // separate manual save click for no real reason -- a silent save is just
  // as safe (a Draft tolerates an incomplete header) and removes the step.
  async function ensureSaved(): Promise<Tender> {
    return tender ?? (await saveDraft({ silent: true }));
  }

  async function heldLineNames(tenderId: number): Promise<string[]> {
    try {
      const preview = await api<LineItemEligibility[]>(`/tenders/${tenderId}/eligibility-preview`);
      return preview.filter((p) => p.eligible_vendors.length === 0).map((p) => p.product_name);
    } catch {
      return [];
    }
  }

  function submitProblem(): string | null {
    if (!form.facility_id) return "Select a facility before submitting for approval.";
    if (!form.title.trim()) return "Give the tender a title before submitting for approval.";
    if (!form.bid_due_date) return "Bid Due Date is required to submit for approval.";
    if (form.is_rate_contract && (!form.contract_start_date || !form.contract_end_date))
      return "A rate contract needs both a contract start and end date before it can be submitted for approval.";
    if (form.is_rate_contract && !hasRateContractDocument) return "Upload the Rate Contract agreement before submitting for approval.";
    if (!hasTermsDocument) return "Upload the Terms & Conditions document before submitting for approval.";
    // rowsForPayload() already leaves out untouched blank rows (the default
    // 5 spares) -- counting raw getRows().length here would always pass
    // trivially even with zero real line items (found 2026-10-14).
    if ((gridRef.current?.rowsForPayload().length ?? 0) === 0) return "Add at least one line item to submit for approval.";
    return null;
  }

  const handleSaveClick = async () => {
    setAttemptedSubmit(true);
    setResult(null);
    try {
      await saveDraft();
    } catch (err) {
      setResult({ message: "Could not save tender: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  const handleSubmitClick = async () => {
    setAttemptedSubmit(true);
    if (currentStatus !== "draft") return;
    const problem = gridRef.current?.firstRowProblem() || submitProblem();
    if (problem) {
      setResult({ message: problem, ok: false });
      return;
    }
    try {
      const saved = await saveDraft({ silent: true });
      try {
        await api(`/tenders/${saved.id}/submit-for-approval`, { method: "POST" });
      } catch (err) {
        // The draft is saved; only the submit step failed.
        setResult({ message: `Saved as draft, but could not submit for approval: ${err instanceof Error ? err.message : String(err)}`, ok: false });
        setTender(await api<Tender>(`/tenders/${saved.id}`));
        return;
      }
      const held = await heldLineNames(saved.id);
      const heldNote = held.length ? ` Note: no eligible vendor yet for ${held.join(", ")} — that line will be held back while the rest go live.` : "";
      setResult({ message: `Tender #${saved.id} submitted for E-Tender Approval.${heldNote}`, ok: true });
      switchView("tenders");
    } catch (err) {
      setResult({ message: "Could not save tender: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  const revertToDraft = async () => {
    if (!tender) return;
    const ok = await confirmAsync("Revert this tender to Draft so you can edit it? It will need to go through E-Tender Approval again before it's Published.", {
      confirmLabel: "Revert to Draft",
    });
    if (!ok) return;
    try {
      const t = await api<Tender>(`/tenders/${tender.id}/withdraw-to-draft`, { method: "POST" });
      setResult({ message: `Tender #${t.id} reverted to Draft.`, ok: true });
      await openTender(t, products);
    } catch (err) {
      setResult({ message: "Could not revert to Draft: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  // The gate bar at the bottom of the form: says what's blocking submission,
  // or that it's ready, and shows the estimated tender value. Computed
  // fresh every render (not stored state) -- `linesVersion` below exists
  // purely to force a re-render when the grid's rows change, since those
  // live in the grid's own internal state, not here.
  function gate() {
    if (currentStatus !== "draft") {
      return { title: `Tender is ${currentStatus.replace("_", " ")}`, body: "It can't be edited in this state.", ready: false };
    }
    // rowsForPayload() leaves out untouched blank rows (the default 5
    // spares) -- raw getRows().length would always pass trivially even with
    // zero real line items (found 2026-10-14).
    const savableCount = gridRef.current?.rowsForPayload().length ?? 0;
    let problem: [string, string] | null = null;
    if (!form.facility_id) problem = ["Facility missing", "Select a facility before sending it for approval."];
    else if (!form.title.trim()) problem = ["Title missing", "Give the tender a title before sending it for approval."];
    else if (!form.bid_due_date) problem = ["Bid due date missing", "A bid due date is required before the tender can be sent for approval."];
    else if (form.is_rate_contract && (!form.contract_start_date || !form.contract_end_date))
      problem = ["Contract dates missing", "A rate contract needs both a contract start and end date before it can be sent for approval."];
    else if (form.is_rate_contract && !hasRateContractDocument) problem = ["Rate contract agreement missing", "Upload the Rate Contract agreement before sending it for approval."];
    else if (!hasTermsDocument) problem = ["Terms & conditions missing", "Upload the Terms & Conditions document before sending it for approval."];
    else if (savableCount === 0) problem = ["No line items", "Add at least one line item."];
    else {
      const fp = gridRef.current?.firstRowProblem() ?? null;
      if (fp) problem = ["Line item incomplete", fp];
    }
    return {
      title: problem ? problem[0] : "Ready to send for approval",
      body: problem
        ? problem[1]
        : `${savableCount} line item(s) · estimated value ${inr(gridRef.current?.totalBudget() ?? 0)}. The approval tier is resolved from this value; approval publishes to the eligible vendors.`,
      ready: !problem,
    };
  }

  if (loadError) return <div className="result err">{loadError}</div>;

  void linesVersion; // read only to force the re-render that recomputes gate() below with fresh rows -- see onChange above
  const g = gate();

  return (
    <div className="d-flex flex-col gap-22px">
      <button className="back-link" onClick={() => switchView("tenders")}>
        ← Back to tenders
      </button>

      {!editable && (
        <div className="ep-note">
          {currentStatus === "published" ? (
            <span>
              This tender is <b>Published</b> — it can't be edited while it's live.{" "}
              <button className="ep-b" onClick={revertToDraft}>
                Revert to Draft to Edit
              </button>
            </span>
          ) : currentStatus === "scheduled" ? (
            <span>
              This tender is approved and <b>Scheduled</b> — it will go live to vendors
              {tender?.publish_date ? ` on ${fmtDateTime(tender.publish_date)}` : ""}, and can't be edited until then.{" "}
              <button className="ep-b" onClick={revertToDraft}>
                Revert to Draft to Edit
              </button>
            </span>
          ) : (
            <span>
              This tender is <b>{currentStatus.replace("_", " ")}</b> — it can only be edited while Draft.
            </span>
          )}
        </div>
      )}

      <div className="ep-pane ep-pane-pad">
        <div className="d-flex justify-between items-baseline mb-14px">
          <span className="fs-14px fw-800">{tender ? `Tender #${tender.id}` : "Tender Header"}</span>
          <StateTag state={currentStatus} />
        </div>
        <fieldset className="border-0 padding-0 margin-0 minw-0" disabled={!editable}>
          {/* User-directed reorganization (2026-10-16, matched to the user's
              own screenshot mockup). Rows 1-2 use the shared 4-column
              ep-form-grid: Title's column is twice as wide as Facility's and
              Department's (col-span-2 vs col-span-1 each). Row 1: Title |
              Facility | Department. Row 2: Description | Publish Date | Bid
              Due Date. Row 3 (Tender Type+Threshold | Open Tender | Rate
              Contract) is its own independent flex row below, not part of
              that grid -- see its own comment further down for why. Both
              toggles' content is always rendered (greyed out/disabled until
              their toggle is on), not appearing/disappearing with it. */}
          <div className="ep-form-grid mb-20px">
            <div className="ep-field col-span-2">
              <div className="ep-k">
                Title <Req />
              </div>
              <input className="input" required value={form.title} onChange={(e) => setField("title", e.target.value)} />
            </div>
            <div className="ep-field">
              <div className="ep-k">
                Facility <Req />
              </div>
              <select className="input" required value={form.facility_id} onChange={(e) => setField("facility_id", e.target.value)}>
                <option value="">— select a facility —</option>
                {facilities.map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name} ({f.legal_entity_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="ep-field">
              <div className="ep-k">Department</div>
              <input className="input" value={form.department} onChange={(e) => setField("department", e.target.value)} />
            </div>

            <div className="ep-field col-span-2">
              <div className="ep-k">Description</div>
              <input className="input" value={form.description} onChange={(e) => setField("description", e.target.value)} />
            </div>
            <div className="ep-field">
              <div className="ep-k">Publish Date</div>
              <input className="input" type="datetime-local" value={form.publish_date} onChange={(e) => setField("publish_date", e.target.value)} />
            </div>
            <div className="ep-field">
              <div className="ep-k">
                Bid Due Date <Req />
              </div>
              <input className="input" type="datetime-local" value={form.bid_due_date} onChange={(e) => setField("bid_due_date", e.target.value)} />
            </div>
          </div>

          {/* Row 3, independent of the grid above (user-directed, 2026-10-16):
              3 actual sections, not 2 -- Tender Type+Threshold, Open Tender,
              Rate Contract. Each section sizes to its own content (no
              flex:1 stretch) and stays left-aligned internally. A fixed gap
              (not justify-between, which spread them across the full row
              width -- too much once seen) keeps a clear, consistent space
              between them without it growing with the card's width. */}
          <div className="d-flex flex-wrap gap-60px mb-20px">
            <div className="d-flex gap-20px">
              <div className="ep-field">
                <div className="ep-k">Tender Type</div>
                <select className="input input-narrow" required value={form.tender_type} onChange={(e) => setField("tender_type", e.target.value as TenderType)}>
                  <option value="rfq">RFQ</option>
                  <option value="rfp">RFP</option>
                </select>
              </div>
              <div className="ep-field">
                <div className="ep-k">Min Rating</div>
                <input
                  className="input input-narrow"
                  type="number"
                  step="0.1"
                  value={form.min_rating_threshold}
                  onChange={(e) => setField("min_rating_threshold", e.target.value)}
                />
              </div>
              {/* Added back 2026-10-21 -- removed from the UI earlier, but
                  the backend (eligibility.py's cap-at-max_invites, the
                  review screen's below-minimum warning) never stopped
                  supporting these (spec §6.2/§6.5 point 5); placement here
                  is a first pass, not a final call. Meaningless for Open
                  Tender (§6.8.3 -- every Active vendor is invited, no count
                  filter), so greyed out while that's on. */}
              <div className="ep-field" title="Doesn't apply to Open Tender -- every Active vendor is invited">
                <div className="ep-k">Min Vendors</div>
                <input
                  className="input input-narrow"
                  type="number"
                  min={0}
                  disabled={form.open_tender}
                  value={form.min_invites}
                  onChange={(e) => setField("min_invites", e.target.value)}
                />
              </div>
              <div className="ep-field" title="Doesn't apply to Open Tender -- every Active vendor is invited">
                <div className="ep-k">Max Vendors</div>
                <input
                  className="input input-narrow"
                  type="number"
                  min={0}
                  disabled={form.open_tender}
                  value={form.max_invites}
                  onChange={(e) => setField("max_invites", e.target.value)}
                />
              </div>
            </div>
            <div className="minw-220px">
              <label className="ep-switch ep-check-field">
                <input
                  type="checkbox"
                  checked={form.open_tender}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setField("open_tender", checked);
                    // Turning it on needs a real tender id for the link
                    // box below to do anything -- silently save instead
                    // of leaving it inert until a manual Save as Draft.
                    if (checked) {
                      try {
                        await saveDraft({ silent: true, overrides: { open_tender: true } });
                      } catch (err) {
                        setResult({ message: "Could not turn on Open Tender: " + (err instanceof Error ? err.message : String(err)), ok: false });
                      }
                    }
                  }}
                />
                <span className="ep-switch-track">
                  <span className="ep-switch-knob"></span>
                </span>
                <span className="ep-switch-label">Open Tender</span>
              </label>
              <div className="mt-10px">
                <OpenTenderLinkBox tender={tender} enabled={form.open_tender} onChange={setTender} />
              </div>
            </div>
            <div className="minw-220px">
              <label className="ep-switch ep-check-field">
                <input
                  type="checkbox"
                  checked={form.is_rate_contract}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setField("is_rate_contract", checked);
                    // Real bug, found 2026-10-16: unlike Open Tender right
                    // above, this never auto-saved -- the tender stayed
                    // is_rate_contract=false on the server (and its Agreement
                    // upload below kept using that stale saved tender via
                    // ensureSaved(), which only saves when there's no tender
                    // yet at all) until a manual Save as Draft, exactly the
                    // save-first wall this whole page was redone to remove.
                    if (checked) {
                      try {
                        await saveDraft({ silent: true, overrides: { is_rate_contract: true } });
                      } catch (err) {
                        setResult({ message: "Could not turn on Rate Contract: " + (err instanceof Error ? err.message : String(err)), ok: false });
                      }
                    }
                  }}
                />
                <span className="ep-switch-track">
                  <span className="ep-switch-knob"></span>
                </span>
                <span className="ep-switch-label">Rate Contract</span>
              </label>
              <div className="d-flex gap-10px mt-10px">
                <div>
                  <div className="ep-k">
                    Start Date <Req />
                  </div>
                  <input
                    className="input input-narrow-date"
                    type="date"
                    disabled={!form.is_rate_contract}
                    value={form.contract_start_date}
                    onChange={(e) => setField("contract_start_date", e.target.value)}
                  />
                </div>
                <div>
                  <div className="ep-k">
                    End Date <Req />
                  </div>
                  <input
                    className="input input-narrow-date"
                    type="date"
                    disabled={!form.is_rate_contract}
                    value={form.contract_end_date}
                    onChange={(e) => setField("contract_end_date", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Back in the shared grid, so this lines up to the exact same
              column width as Title/Description above. Terms & Conditions and
              Rate Contract Agreement are a fixed 50/50 split (col-span-2
              each), not two fields just sitting side by side in a plain flex
              row -- a grid track's width never depends on its own content,
              so one field's filename/buttons appearing can't push the other
              one (user-directed, 2026-10-16). Rate Contract Agreement moved
              here from the Rate Contract toggle section above; it's still
              greyed out and disabled until that toggle is actually on. */}
          <div className="ep-form-grid">
            <div className="ep-field col-span-2">
              <div className="ep-k">
                Terms &amp; Conditions <Req />
              </div>
              <SingleDocumentField
                tender={tender}
                ensureSaved={ensureSaved}
                endpoint="terms-document"
                fieldPrefix="terms_document"
                label="Terms & Conditions Document"
                requiredLabel="Required before submission."
                onChange={setTender}
                showRequiredIfMissing={attemptedSubmit}
              />
            </div>
            <div className="ep-field col-span-2">
              <div className="ep-k">
                Rate Contract Agreement <Req />
              </div>
              <SingleDocumentField
                tender={tender}
                ensureSaved={ensureSaved}
                endpoint="rate-contract-document"
                fieldPrefix="rate_contract_document"
                label="Rate Contract Agreement"
                requiredLabel="Required before submission."
                onChange={setTender}
                disabled={!form.is_rate_contract}
                showRequiredIfMissing={attemptedSubmit}
              />
            </div>
          </div>
        </fieldset>
      </div>

      <LineItemsGrid
        ref={gridRef}
        products={products}
        tenderId={tender?.id ?? null}
        onChange={() => setLinesVersion((v) => v + 1)}
        onRequestSave={async () => {
          await saveDraft({ silent: true });
        }}
      />

      <div className={`ep-pane padding-14px-16px d-flex items-center gap-14px border-left-3px-solid${g.ready ? "-ink" : "-danger"}`}>
        <div className="flex-1">
          <div className={`fs-13px fw-800${g.ready ? "" : " text-danger-700"}`}>{g.title}</div>
          <div className="hint mt-2px">{g.body}</div>
        </div>
        {editable && (
          <>
            <button className="ep-b" onClick={handleSaveClick}>
              Save as Draft
            </button>
            <button className="ep-b" data-v="p" disabled={!g.ready} onClick={handleSubmitClick}>
              Send for Approval
            </button>
          </>
        )}
        <button className="ep-b" onClick={() => switchView("tenders")}>
          Close
        </button>
      </div>
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}

      {tender && (
        <TenderDetail
          tenderId={tender.id}
          tenderStatus={tender.status}
          // Min/Max Vendors to Invite removed from Tender Creation (user-
          // directed, 2026-10-16) -- the eligibility preview's own
          // below-minimum warning (TenderDetail.tsx's EligibilityLine) has
          // nothing left to compare against, so this is always null now.
          minInvites={null}
          isSystemAdmin={currentUser?.role === "system_admin"}
          onResult={(message, ok) => setResult({ message, ok })}
          refreshToken={refreshToken}
        />
      )}
      {modalElement}
    </div>
  );
}
