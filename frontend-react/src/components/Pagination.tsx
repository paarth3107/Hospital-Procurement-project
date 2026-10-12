import type { ReactNode } from "react";

// Ported from frontend/js/kit.js's pageSlice()/paginationBar()/wirePagination().
// Every list in the app is expected to grow into the hundreds, so this is
// shared by every future ported page, not just Staff Accounts. Same page-
// window-with-ellipsis truncation, same CSS classes.
export const PAGE_SIZE = 20;

export function pageSlice<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  return { pageItems: items.slice(clamped * pageSize, clamped * pageSize + pageSize), totalPages, page: clamped };
}

function pageWindow(page: number, totalPages: number): number[] {
  const keep = new Set([0, totalPages - 1, page - 1, page, page + 1]);
  return [...keep].filter((p) => p >= 0 && p < totalPages).sort((a, b) => a - b);
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const window = pageWindow(page, totalPages);
  const items: ReactNode[] = [];
  let last = -1;
  for (const p of window) {
    if (last !== -1 && p - last > 1) items.push(<span className="ep-page-ellipsis" key={`e${p}`}>…</span>);
    items.push(
      <button
        type="button"
        className={`ep-page-btn${p === page ? " active" : ""}`}
        aria-current={p === page}
        onClick={() => onChange(p)}
        key={p}
      >
        {p + 1}
      </button>
    );
    last = p;
  }
  return (
    <nav className="ep-pagination" aria-label="Pagination">
      <button type="button" className="ep-page-arrow" disabled={page <= 0} aria-label="Previous page" onClick={() => onChange(page - 1)}>
        ‹
      </button>
      {items}
      <button type="button" className="ep-page-arrow" disabled={page >= totalPages - 1} aria-label="Next page" onClick={() => onChange(page + 1)}>
        ›
      </button>
    </nav>
  );
}
