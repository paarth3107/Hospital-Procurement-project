import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuthState } from "../lib/authStore";
import { setPendingBidTenderId } from "../lib/bridge";

// Ported from frontend/js/shell.js's onSearchInput()/renderSearchResults().
// Staff groups switch to the matching tab (same item can be found again
// there); a vendor has no such tabs for its results, so a null view means
// "open that tender's bid page directly" instead.
interface SearchResultItem {
  id: number;
  label: string;
  sub: string;
}
type SearchResponse = Record<string, SearchResultItem[]>;

const SEARCH_GROUPS: Record<"staff" | "vendor", [key: string, title: string, view: string | null][]> = {
  staff: [
    ["vendors", "Vendors", "queue"],
    ["tenders", "Tenders", "tenders"],
    ["products", "Items", "catalog-list"],
  ],
  vendor: [
    ["tenders", "Your tenders", null],
    ["products", "Items on your tenders", null],
  ],
};

export function QuickSearch({ onNavigated }: { onNavigated: () => void }) {
  const { actorType } = useAuthState();
  const navigate = useNavigate();
  const isVendor = actorType === "vendor";
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setResultsOpen(false);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setResultsOpen(false);
        (document.activeElement as HTMLElement)?.blur?.();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        boxRef.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeydown);
    };
  }, []);

  const onInput = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!q.trim()) {
      setResultsOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const res = await api<SearchResponse>(`${isVendor ? "/vendor-portal/search" : "/search"}?q=${encodeURIComponent(q.trim())}`);
        if (seq === seqRef.current) {
          setData(res);
          setResultsOpen(true);
        }
      } catch {
        // a failed search just leaves the previous results in place
      }
    }, 250);
  };

  const openItem = (item: SearchResultItem, view: string | null) => {
    setResultsOpen(false);
    setQuery("");
    if (view) navigate("/" + view);
    else {
      setPendingBidTenderId(item.id);
      navigate("/bid");
    }
    onNavigated();
  };

  const groups = data
    ? SEARCH_GROUPS[isVendor ? "vendor" : "staff"]
        .map(([key, title, view]) => ({ title, view, items: data[key] || [] }))
        .filter((g) => g.items.length)
    : [];

  return (
    <div className="ep-search" id="search-box" ref={boxRef}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className="input"
        type="search"
        placeholder={isVendor ? "Search your tenders and items" : "Search vendors, tenders, items"}
        autoComplete="off"
        value={query}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => data && setResultsOpen(true)}
      />
      {resultsOpen && (
        <div className="ep-search-results">
          {groups.length ? (
            groups.map((g) => (
              <div key={g.title}>
                <div className="ep-search-group">{g.title}</div>
                {g.items.map((it) => (
                  <button className="ep-search-item" type="button" key={it.id} onClick={() => openItem(it, g.view)}>
                    <span>{it.label}</span>
                    <span className="ep-sub">{it.sub}</span>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <div className="ep-dropdown-empty">No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}
