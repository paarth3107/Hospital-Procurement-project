import { docLabel, entryKey } from "../../constants.js";
import { esc } from "../../kit.js";

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

export function requirementNote(req) {
  if (!req.items.length) return "";
  return `<div class="ep-sub" style="margin-left:22px">Needs: ${req.items
    .map((i) =>
      i.ok
        ? `<span style="font-weight:600">${esc(i.label)} ✓</span>`
        : i.other
        ? `<span style="color:#173fb0;font-weight:600">${esc(i.label)}</span> <button type="button" class="ep-b" style="padding:1px 8px" data-upload-other="${esc(i.entry.slice(6).trim())}">Upload</button>`
        : `<span style="color:#173fb0;font-weight:600">${esc(i.label)}</span> <button type="button" class="ep-b" style="padding:1px 8px" data-upload-req="${esc(i.entry)}">Upload</button>`
    )
    .join(", ")}</div>`;
}
