// Deep-link state shared between Vendor List and the Vendor View screen
// (2026-10-07, splitting what used to be one combined list+detail screen
// into two separate sidebar-reachable screens, Vuexy's own User List / User
// View pattern applied to vendors). Same "set state, then switchView"
// pattern already used elsewhere in this app (catalogData.js's
// editingProductId, openTenderById, openTenderReview, openTenderAward).
let viewVendorId = null;
export const setViewVendorId = (id) => (viewVendorId = id);
export const takeViewVendorId = () => {
  const id = viewVendorId;
  viewVendorId = null;
  return id;
};

// Which status filter Vendor List should show next -- set when a deep link
// (the dashboard's action queue) jumps straight to a vendor's profile, so
// clicking "Back to Vendor List" lands somewhere relevant instead of
// whatever filter happened to be selected last.
let pendingListFilter = null;
export const setPendingListFilter = (f) => (pendingListFilter = f);
export const takePendingListFilter = () => {
  const f = pendingListFilter;
  pendingListFilter = null;
  return f;
};
