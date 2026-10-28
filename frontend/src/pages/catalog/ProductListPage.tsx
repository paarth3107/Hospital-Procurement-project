import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { switchView } from "../../lib/bridge";
import { loadCatalogData } from "../../lib/catalogCache";
import { takeFlash } from "../../lib/flash";
import type { CatalogProduct, ProcurementType, VendorMapping } from "../../lib/types";
import { ImgPlaceholder } from "../../components/ImgPlaceholder";
import { IconActionButton } from "../../components/IconActionButton";
import { Tag, TypeTag } from "../../components/Tag";
import { Pagination, pageSlice } from "../../components/Pagination";
import { inr } from "../../lib/format";
import { toastError, toastSuccess } from "../../lib/toastStore";

// Ported 1:1 from frontend/js/pages/catalog/productListPage.js. 7 columns --
// "Type-specific attributes" was dropped (2026-10-09, user-directed): it's
// covered by Edit/a future Product Detail screen, not duplicated here, and
// dropping it gave Edit/Deactivate real room to sit side by side. Reuses
// .catalog-product-table (styles.css, table-layout: fixed + pinned per-
// column widths) -- without it the browser auto-sizes columns from only the
// currently visible (type-filtered) rows, which visibly resized the whole
// table between tabs even though it's the same component every time.
const TYPE_SEG: [string, string][] = [
  ["all", "All types"],
  ["item", "Item"],
  ["asset", "Asset"],
  ["service", "Service"],
];

function priceBand(p: CatalogProduct): string {
  if (p.price_band_min == null && p.price_band_max == null) return "—";
  return `${p.price_band_min != null ? inr(p.price_band_min) : "…"} – ${p.price_band_max != null ? inr(p.price_band_max) : "…"}`;
}

export function ProductListPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [mappings, setMappings] = useState<VendorMapping[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlashMsg] = useState("");

  const load = useCallback(async (force = false) => {
    try {
      const data = await loadCatalogData(force);
      setProducts(data.products);
      setMappings(data.mappings);
      setError("");
      const f = takeFlash();
      if (f) setFlashMsg(f);
    } catch (err) {
      setError("Could not load catalog: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Vendors currently eligible for an entry: approved item mapping, or an
  // approved category mapping, unless an item-level suspension/rejection
  // says no (same rule as the eligibility resolver).
  const vendorCount = (p: CatalogProduct): number => {
    const blocked = new Set<number>();
    const allowed = new Set<number>();
    for (const m of mappings) {
      if (m.product_master_id === p.id) {
        if (m.state === "approved") allowed.add(m.vendor_id);
        else if (m.state === "suspended" || m.state === "rejected") blocked.add(m.vendor_id);
      } else if (m.category_id === p.category_id && m.state === "approved") {
        allowed.add(m.vendor_id);
      }
    }
    return [...allowed].filter((v) => !blocked.has(v)).length;
  };

  const toggleActive = async (p: CatalogProduct) => {
    const action = p.active ? "deactivate" : "activate";
    try {
      await api(`/products/${p.id}/${action}`, { method: "POST" });
      await load(true);
      toastSuccess(`"${p.name}" ${action}d.`);
    } catch (err) {
      const message = `Could not ${action} "${p.name}": ` + (err instanceof Error ? err.message : String(err));
      setError(message);
      toastError(message);
    }
  };

  const gotoAdd = () => switchView("catalog-add");
  const gotoEdit = (id: number) => switchView(`catalog-add/${id}`);

  if (error && !products.length) {
    return <div className="result err">{error}</div>;
  }

  const filtered = products.filter((p) => typeFilter === "all" || p.procurement_type === (typeFilter as ProcurementType));
  const { pageItems: shown, totalPages, page: clampedPage } = pageSlice(filtered, page);

  return (
    <div className="d-flex flex-col gap-16px">
      <div className="d-flex items-center gap-14px flex-wrap">
        <div className="ep-seg">
          {TYPE_SEG.map(([k, l]) => (
            <button
              key={k}
              className={k === typeFilter ? "on" : ""}
              onClick={() => {
                setTypeFilter(k);
                setPage(0);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="hint flex-1">{filtered.length} entries · procurement type drives the line-item form and the mandatory attachment checklist</div>
        <button className="ep-b" data-v="p" onClick={gotoAdd}>
          + Add Product
        </button>
      </div>
      <div className="ep-pane">
        <table className="ep-table catalog-product-table">
          <thead>
            <tr>
              {["Product", "Category", "Type", "Price band", "Vendors", "Status", "Action"].map((h) => (
                <th className="ep-th" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!shown.length ? (
              <tr>
                <td className="ep-cell text-ink-55" colSpan={7}>
                  No catalog entries of this type yet.
                </td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={p.id}>
                  <td className="ep-cell">
                    <div className="d-flex items-center gap-12px">
                      <ImgPlaceholder iconName="image" size="sm" />
                      <div className="minw-0">
                        <div className="fw-600 ep-clip" title={p.name}>
                          {p.name}
                        </div>
                        <div className="ep-sub ep-mono fs-11px">{p.code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="ep-cell fs-12-5px">
                    {p.category}
                    {p.sub_category && <div className="ep-sub">{p.sub_category}</div>}
                  </td>
                  <td className="ep-cell">
                    <TypeTag type={p.procurement_type} />
                  </td>
                  <td className="ep-cell fs-12-5px nowrap">{priceBand(p)}</td>
                  <td className="ep-cell fw-800">{vendorCount(p)}</td>
                  <td className="ep-cell">{p.active ? <Tag text="Active" tone="pos" /> : <Tag text="Inactive" tone="neg" />}</td>
                  <td className="ep-cell ep-actions-cell nowrap text-right">
                    <div className="d-flex items-center justify-end gap-6px">
                      <IconActionButton
                        icon={p.active ? "trash" : "check-circle"}
                        label={p.active ? "Deactivate" : "Activate"}
                        tone={p.active ? "danger" : undefined}
                        onClick={() => toggleActive(p)}
                      />
                      <IconActionButton icon="edit" label="Edit" onClick={() => gotoEdit(p.id)} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={clampedPage} totalPages={totalPages} onChange={setPage} />
      </div>
      {flash && <div className="result ok">{flash}</div>}
      {error && <div className="result err">{error}</div>}
    </div>
  );
}
