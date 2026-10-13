import { useCallback, useEffect, useRef, useState } from "react";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { acceptFor, VENDOR_DOC_TYPES } from "../../lib/constants";
import { fileTypeError } from "../../lib/fileValidation";
import { Tag, StateTag, ExpiryTag } from "../../components/Tag";
import { useModal } from "../../components/useModal";
import type { VendorDocument } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorDocumentsPage.js -- the vendor's
// document vault (a pane in Company profile): each required/optional
// document with its verification status, and an Upload / Replace button.
// Re-uploading resets a document to Pending. "Other" documents (asked for
// by a catalog entry) are listed after the standard ones under the name
// the catalog entry gave them.
interface Entry {
  key: string;
  type: string;
  label: string;
  mandatory: boolean;
  expires: boolean;
  accept: string;
  allowSpreadsheets: boolean;
  doc: VendorDocument | undefined;
  custom: boolean;
}

export function DocumentVaultPanel({ onChanged }: { onChanged?: () => void }) {
  const [docs, setDocs] = useState<VendorDocument[] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [validTill, setValidTill] = useState<Record<string, string>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const { confirmAsync, modalElement } = useModal();

  const load = useCallback(async () => {
    try {
      setDocs(await api<VendorDocument[]>("/vendor-portal/documents"));
      setError("");
    } catch (err) {
      setError("Could not load documents: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="result err">{error}</div>;
  if (!docs) return null;

  const byType = new Map(docs.filter((d) => d.doc_type !== "other").map((d) => [d.doc_type, d]));
  const entries: Entry[] = [
    ...VENDOR_DOC_TYPES.map((t) => ({
      key: t.value,
      type: t.value,
      label: t.label,
      mandatory: t.mandatory,
      expires: !!t.expires,
      accept: acceptFor(t),
      allowSpreadsheets: !!t.spreadsheet,
      doc: byType.get(t.value),
      custom: false,
    })),
    ...docs
      .filter((d) => d.doc_type === "other")
      .map((d) => ({
        key: "other:" + d.custom_label,
        type: "other",
        label: d.custom_label,
        mandatory: false,
        expires: true,
        accept: ".pdf,.jpg,.jpeg,.png",
        allowSpreadsheets: false,
        doc: d,
        custom: true,
      })),
  ];
  const draftCount = docs.filter((d) => d.status === "draft").length;

  const upload = async (entry: Entry, file: File) => {
    const fd = new FormData();
    fd.append("doc_type", entry.type);
    if (entry.custom) fd.append("custom_label", entry.label);
    fd.append("file", file);
    const vt = validTill[entry.key];
    if (vt) fd.append("valid_till", vt);
    try {
      // no JSON Content-Type: fetch sets the multipart boundary itself
      await api("/vendor-portal/documents", { method: "POST", body: fd });
      await load();
      onChanged?.();
    } catch (err) {
      setResult({ message: "Could not upload: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  const view = async (docId: number) => {
    try {
      const res = await fetch(API_BASE + `/vendor-portal/documents/${docId}/download`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not open document");
      window.open(URL.createObjectURL(await res.blob()), "_blank");
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  const remove = async (docId: number) => {
    const ok = await confirmAsync("Delete this attachment? You'll need to upload a replacement before it counts toward any requirement.", {
      title: "Delete Document",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/vendor-portal/documents/${docId}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch (err) {
      setResult({ message: "Could not delete: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  const submitDrafts = async () => {
    try {
      await api("/vendor-portal/documents/submit", { method: "POST" });
      await load();
      setResult({ message: "Your documents were submitted for review.", ok: true });
      onChanged?.();
    } catch (err) {
      setResult({ message: "Could not submit: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>Document Vault</span>
        <span className="ep-k">PDF, JPG or PNG · max 10 MB · an expired document suspends bidding until renewed</span>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Document", "File", "Valid till", "Status", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const d = e.doc;
            return (
              <tr key={e.key}>
                <td className="ep-cell fw-600">
                  {e.label}
                  <div>{e.custom ? <Tag text="Requested by a catalog entry" /> : <Tag text={e.mandatory ? "Required" : "Optional"} tone={e.mandatory ? "att" : ""} />}</div>
                </td>
                <td className="ep-cell fs-12px">
                  {d ? (
                    <>
                      <span className="ep-mono">{d.original_filename}</span>
                      <div className="ep-sub">
                        {(d.size_bytes / 1024).toFixed(0)} KB · uploaded {fmtDate(d.uploaded_at)} ·{" "}
                        <a
                          href="#"
                          onClick={(ev) => {
                            ev.preventDefault();
                            view(d.id);
                          }}
                        >
                          View
                        </a>
                      </div>
                    </>
                  ) : (
                    <span className="ep-sub">Not uploaded</span>
                  )}
                </td>
                <td className="ep-cell fs-12-5px">
                  {d?.valid_till ? (
                    <>
                      {fmtDate(d.valid_till)}
                      <div>
                        <ExpiryTag expiryState={d.expiry_state} validTill={d.valid_till} />
                      </div>
                    </>
                  ) : (
                    <span className="ep-sub">—</span>
                  )}
                </td>
                <td className="ep-cell">
                  {d ? <StateTag state={d.status} /> : <Tag text="Missing" tone={e.mandatory ? "att" : ""} />}
                  {d?.status === "draft" && <div className="ep-sub">Not submitted yet</div>}
                  {d?.status === "rejected" && d.rejection_reason && <div className="ep-sub text-danger-700">{d.rejection_reason}</div>}
                </td>
                <td className="ep-cell text-right">
                  {e.expires && (
                    <input
                      className="input w-150px d-inline-block mr-6px"
                      type="date"
                      title="Valid till — set before uploading"
                      value={validTill[e.key] ?? d?.valid_till ?? ""}
                      onChange={(ev) => setValidTill((v) => ({ ...v, [e.key]: ev.target.value }))}
                    />
                  )}
                  <button className="ep-b" onClick={() => fileInputs.current[e.key]?.click()}>
                    {d ? "Replace" : "Upload"}
                  </button>{" "}
                  {d && d.status !== "verified" && (
                    <button className="ep-b" onClick={() => remove(d.id)}>
                      Delete
                    </button>
                  )}
                  <input
                    type="file"
                    accept={e.accept}
                    hidden
                    ref={(el) => {
                      fileInputs.current[e.key] = el;
                    }}
                    onChange={(ev) => {
                      const file = ev.target.files?.[0];
                      ev.target.value = "";
                      if (!file) return;
                      // Real bug, found 2026-10-13: `accept=` above is just a
                      // picker hint ("All files" overrides it) and this field
                      // has no drag-and-drop to begin with, but nothing ever
                      // actually checked the picked file before sending it --
                      // a disallowed type/oversized file only got rejected by
                      // the backend's own document_store.validate(), after
                      // the upload round-trip. See lib/fileValidation.ts.
                      const typeErr = fileTypeError(file, { allowSpreadsheets: e.allowSpreadsheets });
                      if (typeErr) {
                        setResult({ message: typeErr, ok: false });
                        return;
                      }
                      upload(e, file);
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {draftCount > 0 && (
        <div className="ep-note">
          <span>You have {draftCount} document(s) saved as drafts. They stay private until you submit -- the category manager only sees what you submit.</span>
          <button className="ep-b" data-v="p" onClick={submitDrafts}>
            Submit documents ({draftCount})
          </button>
        </div>
      )}
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
      {modalElement}
    </div>
  );
}
