import { createPortal } from "react-dom";

// In-app file preview (user-reported 2026-10-14, built 2026-10-21): every
// "view document" button across the app used to do
// `fetch -> blob -> window.open(url, "_blank")`, since the download
// endpoints need an auth header a plain `<a href>` can't send -- that's why
// it always opened a new tab instead of staying inside the app. This swaps
// that for a modal showing the same blob inline.
//
// Scoped to PDF and images for now (per .claude-notes/GAPS.md §4 and
// explicit user direction) -- both render natively in-browser via an
// `<iframe>`/`<img>` pointed at the blob, no new dependency needed. DOCX/
// XLSX have no native browser renderer and are deliberately left out of
// this pass; canPreviewInApp() returning false for them is what keeps
// every call site falling back to the old new-tab behavior for those, so
// nothing regresses for formats this pass doesn't cover.
export interface PreviewFile {
  url: string;
  filename: string;
  contentType: string;
}

export function canPreviewInApp(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

export function DocumentPreviewModal({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const isPdf = file.contentType === "application/pdf";
  const isImage = file.contentType.startsWith("image/");
  return createPortal(
    <div className="doc-preview-overlay" onClick={onClose}>
      <div className="doc-preview-box" onClick={(e) => e.stopPropagation()}>
        <div className="doc-preview-head">
          <span className="fw-600 doc-filename" title={file.filename}>
            {file.filename}
          </span>
          <div className="d-flex gap-10px ml-auto">
            <a className="ep-b" href={file.url} download={file.filename}>
              Download
            </a>
            <button type="button" className="ep-b" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="doc-preview-body">
          {isPdf && <iframe src={file.url} title={file.filename} />}
          {isImage && <img src={file.url} alt={file.filename} />}
          {!isPdf && !isImage && <p className="ep-sub">Preview isn't available for this file type yet — use Download instead.</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
