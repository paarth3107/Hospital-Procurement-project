import { useState, type CSSProperties } from "react";
import { Icon } from "../../lib/icons";
import { Pagination, pageSlice } from "../../components/Pagination";

// Ported 1:1 from frontend/js/pages/dashboard/tenderProgressCard.js --
// Vuexy's "Assignment Progress" card: a row per tender with a percentage
// ring, what's happening on it, and a chevron through to it. Shared by every
// dashboard that has a "Tenders" pane (Officer, Approving Authority) so the
// pagination and the ring/tone rule only live in one place. `subtitle(t)`
// builds the one-line status text per role; `onOpen(id)` decides where the
// chevron goes.
const PAGE_SIZE = 6;

interface ProgressTender {
  id: number;
  title: string;
  status: string;
  bid_due_date: string | null;
  progress_pct: number;
}

// Tone for the progress ring: green on track, amber a bit behind, red only
// for a line that's genuinely stalled (deadline passed, still under
// halfway), grey for a tender just starting out.
function progressTone(t: ProgressTender, value: number): "danger" | "success" | "warning" | "muted" {
  if (t.status === "published" && t.bid_due_date && new Date(t.bid_due_date) <= new Date() && value <= 55) return "danger";
  if (value >= 65) return "success";
  if (value >= 20) return "warning";
  return "muted";
}

export function TenderProgressCard<T extends ProgressTender>({ tenders, subtitle, onOpen }: { tenders: T[]; subtitle: (t: T) => string; onOpen: (id: number) => void }) {
  const [page, setPage] = useState(0);
  const { pageItems, totalPages, page: clamped } = pageSlice(tenders, page, PAGE_SIZE);
  if (clamped !== page) setPage(clamped);
  return (
    <div>
      <div className="ep-pane-head">
        <span>Tenders</span>
        <span className="ep-k">{tenders.length} in progress</span>
      </div>
      <div className="assign-list">
        {pageItems.length === 0 ? (
          <div className="ep-sub">Nothing in progress right now.</div>
        ) : (
          pageItems.map((t) => {
            const value = t.progress_pct;
            const tone = progressTone(t, value);
            return (
              <div className="assign-row d-flex items-center gap-14px" key={t.id}>
                <div className={`assign-ring ring-tone-${tone}`} style={{ "--ring-value": value } as CSSProperties}>
                  <div className="assign-ring-hole">{value}%</div>
                </div>
                <div className="flex-1 minw-0">
                  <div className="fw-600">{t.title}</div>
                  <div className="ep-sub mt-2px">{subtitle(t)}</div>
                </div>
                <button type="button" className="assign-chevron" aria-label={`Open ${t.title}`} onClick={() => onOpen(t.id)}>
                  <Icon name="chevron-right" size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>
      <Pagination page={clamped} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
