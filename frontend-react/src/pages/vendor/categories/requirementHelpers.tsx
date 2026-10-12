import { docLabel, entryKey } from "../../../lib/constants";
import { Tag } from "../../../components/Tag";
import type { Category, CatalogProduct, VendorDocument } from "../../../lib/types";

// Ported 1:1 from frontend/js/pages/vendorCategories/requirements.js -- the
// documents a vendor must supply to request a category / an item, checked
// against what is already in their Document vault. Asked for right here,
// inline, the moment the requirement shows up -- not "go upload it
// elsewhere and come back" -- and sent straight to the category manager,
// not staged as a draft, since ticking the box and supplying the document
// is one action. Requesting is disabled until they're all there.
//
// A Draft document hasn't been submitted -- it can't satisfy a requirement
// (the category manager can't see it) until it's actually sent for review.
const usable = (doc: VendorDocument | undefined): boolean => !!doc && doc.status !== "rejected" && doc.status !== "draft" && doc.expiry_state !== "expired";

export interface RequirementItem {
  entry: string;
  key: string;
  label: string;
  other: boolean;
  ok: boolean;
}

export interface Requirement {
  items: RequirementItem[];
  missing: RequirementItem[];
}

export function requirementsFor(entries: string[], docsByKey: Map<string, VendorDocument>): Requirement {
  const items = entries.map((entry) => ({ entry, key: entryKey(entry), label: docLabel(entry), other: entry.startsWith("other:"), ok: usable(docsByKey.get(entryKey(entry))) }));
  return { items, missing: items.filter((i) => !i.ok) };
}

export function categoryRequirements(category: Category, docsByKey: Map<string, VendorDocument>): Requirement {
  return requirementsFor(category.required_documents || [], docsByKey);
}

export function itemRequirements(product: CatalogProduct, category: Category | undefined, docsByKey: Map<string, VendorDocument>): Requirement {
  const entries = [...new Set([...(product.required_documents || []), ...(category?.required_documents || [])])];
  return requirementsFor(entries, docsByKey);
}

// A pill per required document -- green and labelled when it's already on
// file, a clickable "Upload" pill when it's missing.
export function RequirementPills({ req, onUpload }: { req: Requirement; onUpload: (entry: string, isOther: boolean, customLabel: string) => void }) {
  if (!req.items.length) return null;
  return (
    <div className="vc-doc-pills">
      {req.items.map((i) =>
        i.ok ? (
          <Tag text={i.label} tone="pos" key={i.key} />
        ) : (
          <button
            type="button"
            className="ep-tag ep-tag-action"
            data-t="att"
            key={i.key}
            onClick={() => onUpload(i.entry, i.other, i.other ? i.entry.slice(6).trim() : "")}
          >
            Upload {i.label}
          </button>
        )
      )}
    </div>
  );
}
