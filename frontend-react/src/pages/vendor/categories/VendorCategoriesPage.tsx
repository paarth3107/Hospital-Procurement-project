import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { refreshChrome } from "../../../lib/bridge";
import { docKey } from "../../../lib/constants";
import type { Category, CatalogProduct, ItemRequirement, VendorDetail, VendorDocument, VendorMapping } from "../../../lib/types";
import { ItemRequirementsPanel } from "./ItemRequirementsPanel";
import { RequestPanel } from "./RequestPanel";
import { uploadRequirementDoc } from "./uploadRequirementDoc";
import type { RequestCtx } from "./types";

// Ported 1:1 from frontend/js/pages/vendorCategories/vendorCategoriesPage.js
// -- its own tab: chips showing each category/item the vendor has
// requested and its approval state, plus a "Request additional category"
// button that opens the request panel.
const CHIP: Record<string, [string, string]> = {
  approved: ["chip-approved", "approved"],
  pending: ["chip-pending", "requested"],
  rejected: ["chip-rejected", "rejected"],
  suspended: ["chip-suspended", "suspended"],
};

export function VendorCategoriesPage() {
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [mappings, setMappings] = useState<VendorMapping[]>([]);
  const [docs, setDocs] = useState<VendorDocument[]>([]);
  const [requirements, setRequirements] = useState<ItemRequirement[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await api<VendorDetail>("/vendor-auth/me");
      setVendor(v);
      if (v.status !== "active") return;
      const [c, p, m, d, reqs] = await Promise.all([
        api<Category[]>("/categories"),
        api<CatalogProduct[]>("/products?active=true"),
        api<VendorMapping[]>("/vendor-portal/mappings"),
        api<VendorDocument[]>("/vendor-portal/documents"),
        api<ItemRequirement[]>("/vendor-portal/documents/requirements"),
      ]);
      setCategories(c);
      setProducts(p);
      setMappings(m);
      setDocs(d);
      setRequirements(reqs);
      setError("");
    } catch (err) {
      setError("Could not load categories: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onUpload = (entry: string, isOther: boolean, customLabel: string) => {
    uploadRequirementDoc(
      entry,
      isOther,
      customLabel,
      async () => {
        await load();
        refreshChrome();
      },
      (message) => setResult({ message, ok: false })
    );
  };

  if (error) return <div className="result err">{error}</div>;
  if (!vendor) return null;

  if (vendor.status !== "active") {
    return (
      <div className="ep-pane ep-pane-pad">
        <div className="ep-k">Category declaration</div>
        <div className="hint mt-8px">Categories can be requested once your registration is Active — finish document verification first.</div>
      </div>
    );
  }

  const ctx: RequestCtx = {
    docsByKey: new Map(docs.map((d) => [docKey(d), d])),
    categories,
    products,
    categoryById: new Map(categories.map((c) => [c.id, c])),
    mappingByCategory: new Map(mappings.filter((m) => m.category_id != null).map((m) => [m.category_id!, m])),
    mappingByProduct: new Map(mappings.filter((m) => m.product_master_id != null).map((m) => [m.product_master_id!, m])),
  };
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const prodName = new Map(products.map((p) => [p.id, p.name]));
  const chips = mappings
    .map((m) => {
      const label = m.category_id != null ? catName.get(m.category_id) : prodName.get(m.product_master_id!);
      return label ? { label, state: m.state } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <div>
      <ItemRequirementsPanel requirements={requirements} onUploaded={async () => { await load(); refreshChrome(); }} onError={(message) => setResult({ message, ok: false })} />
      <div className="ep-pane ep-pane-pad">
        <div className="ep-k">Category declaration</div>
        <div className="d-flex flex-wrap gap-7px mt-9px">
          {chips.length ? (
            chips.map((c, i) => {
              const [cls, word] = CHIP[c.state] ?? ["", c.state];
              return (
                <span className={`vc-chip ${cls}`} key={i}>
                  {c.label} — {word}
                </span>
              );
            })
          ) : (
            <span className="hint">Nothing requested yet.</span>
          )}
        </div>
        <div className="hint mt-12px">Category approval does not auto-approve every SKU within it. Requests are reviewed by the category manager and timestamped on approval.</div>
        <button className="ep-b mt-12px" onClick={() => setRequesting((v) => !v)}>
          {requesting ? "Hide request panel" : "Request additional category"}
        </button>
        {requesting && (
          <div className="mt-16px pt-16px border-top-2px-solid-ink-40">
            <RequestPanel ctx={ctx} onUpload={onUpload} onSubmitted={async (message, ok) => { await load(); setResult({ message, ok }); }} />
          </div>
        )}
      </div>
      {result && <div className={`result mt-10px ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
    </div>
  );
}
