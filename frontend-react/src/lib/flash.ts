// A one-shot success message that must survive a switchView() into another
// page's own async load -- same "set state, then switchView" pattern
// frontend/js/state.js's `state.flash` already uses (e.g. Add Product ->
// Product List after a save). Product List and Add Product are both React
// now (Phase 3b), in the SAME bundle, so a plain module-scoped variable here
// is genuinely shared between them -- no window bridge needed, unlike state
// shared across the vanilla/React bundle boundary. This has no vanilla
// counterpart of its own; `state.js`'s `state.flash` keeps serving pages
// still on that side.
let flash: string | null = null;

export const setFlash = (message: string) => {
  flash = message;
};

export const takeFlash = (): string | null => {
  const f = flash;
  flash = null;
  return f;
};
