import { docLabel, entryKey } from "../../constants.js";
import { esc, tag } from "../../kit.js";

// The documents a vendor must supply to request a category / an item, checked
// against what is already in their Document vault. Asked for right here,
// inline, the moment the requirement shows up -- not "go upload it elsewhere
// and come back" -- and sent straight to the category manager, not staged as
// a draft, since ticking the box and supplying the document is one action.
// Requesting is disabled until they're all there.
// A Draft document hasn't been submitted -- it can't satisfy a requirement
// (the category manager can't see it) until it's actually sent for review.
const usable = (doc) => doc && doc.status !== "rejected" && doc.status !== "draft" && doc.expiry_state !== "expired";

export function requirementsFor(entries, docsByKey) {
  const items = entries.map((entry) => ({ entry, key: entryKey(entry), label: docLabel(entry), other: entry.startsWith("other:"), ok: usable(docsByKey.get(entryKey(entry))) }));
  return { items, missing: items.filter((i) => !i.ok) };
}

export function categoryRequirements(category, docsByKey) {
  return requirementsFor(category.required_documents || [], docsByKey);
}

export function itemRequirements(product, category, docsByKey) {
  const entries = [...new Set([...(product.required_documents || []), ...(category?.required_documents || [])])];
  return requirementsFor(entries, docsByKey);
}

// A pill per required document (2026-10-08, was a "Needs: X, Y" sentence) --
// green and labelled when it's already on file, a clickable "Upload" pill
// wired to the same data-upload-req/data-upload-other attributes the page's
// existing upload handlers already listen for, when it's missing. Reads at a
// glance in the request table instead of as a paragraph under the name.
export function requirementPills(req) {
  if (!req.items.length) return "";
  return `<div class="vc-doc-pills">${req.items
    .map((i) =>
      i.ok
        ? tag(i.label, "pos")
        : `<button type="button" class="ep-tag ep-tag-action" data-t="att" data-upload-${i.other ? "other" : "req"}="${esc(
            i.other ? i.entry.slice(6).trim() : i.entry
          )}">Upload ${esc(i.label)}</button>`
    )
    .join("")}</div>`;
}
