import { useCallback, useEffect, useState } from "react";
import { api, API_BASE, apiHeaders } from "../../lib/api";
import { fmtDateTime, inr } from "../../lib/format";
import { Pagination, pageSlice } from "../../components/Pagination";
import type { PoDataFile } from "../../lib/types";

// Ported 1:1 from frontend/js/pages/po/poFilesPage.js (spec 10.3-10.5): one
// PO data file per awarded vendor per tender. This system's job ends at the
// generated file -- download the CSV or XML and hand it to the ERP team.
// Recording the ERP's import outcome and re-exporting a corrected file
// (spec 10.5 points 3-5, 10.7) are out of scope for now (user-directed,
// 2026-09-28).
export function PoFilesPage() {
  const [files, setFiles] = useState<PoDataFile[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setFiles(await api<PoDataFile[]>("/po-files"));
      setError("");
    } catch (err) {
      setError("Could not load PO data files: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const download = async (id: number, batch: string, format: "csv" | "xml") => {
    try {
      const res = await fetch(`${API_BASE}/po-files/${id}/download?format=${format}`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not download the file");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${batch}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && !files.length) return <div className="result err">{error}</div>;

  const { pageItems: shown, totalPages, page: clampedPage } = pageSlice(files, page);

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>PO Data Files</span>
        <span className="ep-k">{files.length}</span>
      </div>
      <div className="hint padding-10px-16px">
        This system's job ends at the file. Download it as CSV or XML and hand it to the ERP team. Files carry vendor GSTIN and prices, so only Procurement Admin / Category
        Manager can download them.
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Batch", "Vendor", "Value", "Approved by", ""].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!shown.length ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={5}>
                No PO data files yet. They are generated when an Approving Authority approves the last line of a tender.
              </td>
            </tr>
          ) : (
            shown.map((f) => (
              <tr key={f.id}>
                <td className="ep-cell">
                  <div className="fw-700">{f.batch_id}</div>
                  <div className="ep-sub">
                    tender #{f.tender_id} · {f.tender_title}
                  </div>
                </td>
                <td className="ep-cell">
                  {f.vendor_name}
                  <div className="ep-sub">{f.vendor_code}</div>
                </td>
                <td className="ep-cell fs-12-5px">
                  {f.lines} line(s)
                  <div className="fw-600">{inr(f.total_incl_tax)}</div>
                </td>
                <td className="ep-cell fs-12-5px">
                  {f.approved_by}
                  <div className="ep-sub">{fmtDateTime(f.generated_at)}</div>
                </td>
                <td className="ep-cell text-right nowrap">
                  <button className="ep-b" onClick={() => download(f.id, f.batch_id, "csv")}>
                    CSV
                  </button>{" "}
                  <button className="ep-b" onClick={() => download(f.id, f.batch_id, "xml")}>
                    XML
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination page={clampedPage} totalPages={totalPages} onChange={setPage} />
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
