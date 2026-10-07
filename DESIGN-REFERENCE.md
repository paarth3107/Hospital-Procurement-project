# Design reference — Vuexy-based system

Target look: the Vuexy admin template (vertical-menu demo), adopted 2026-10-06 by user direction.
It replaces the earlier Modernist prototype (Archivo, `#ec3013`, radius 0), which no longer applies.

Where this file and the code disagree, the code (`frontend/design-system.css`, `frontend/styles.css`)
is the truth. Retune values in `design-system.css` only; `styles.css` references tokens and never
hardcodes colour.

## Tokens (`frontend/design-system.css`)
- **Type:** Public Sans (400/500/600/700). Monospace `ui-monospace` for codes and refs.
- **Radius:** 6px everywhere (`--radius`). Pills and avatars are the only round shapes.
- **Primary:** `#7367f0` (`--primary`), hover `--primary-dark`, link hover `--primary-deep`. Labels on solid primary use `--on-solid`.
- **Status:** danger `#ea5455` (`--danger`, tints `--danger-08/100`, text `--danger-700`); success `#28c76f` (`--success-bg`, `--success-text`); warning `#ff9f43`; info `#00cfe8`.
- **Surfaces:** page `--page-bg`, cards `--surface`, sidebar `--sidebar-bg`, table heads `--surface-subtle`.
- **Ink:** body text `--ink`. Every muted or rule colour is `--ink-NN` (opacity steps of `--ink-rgb`), so changing the ink base recolours all of them.
- **Elevation:** `--card-shadow` for cards and the app bar, `--dialog-shadow` for dialogs and menus.
- **Dark theme:** `[data-theme="dark"]` on `<html>` overrides the surface, page and ink tokens. The choice is stored per viewer in `localStorage` and applied by an inline script before first paint.

## Shell
- **Sidebar** (260px, white, `#sidebar`): brand mark, section heading (role-specific), then the nav. Staff nav is grouped into collapsible sections (Vendors, Catalog, Tenders, Administration); vendor nav is flat. A group is hidden when none of its pages are visible to the role. Collapsed state is remembered per viewer.
- **Active nav item:** purple gradient pill with white label and a soft shadow. Count badges use the danger colour, or the on-solid colour on the active item.
- **App bar** (`#appbar`, shown only when logged in): search (Ctrl/⌘+K), dark-mode toggle, notifications bell with a dot when anything needs attention, and the account menu. Search is staff-only (`GET /api/v1/search`).
- **Page header:** kicker and 22px title, no rule underneath. Content sits on the page background in 22px gaps.

## Components (`frontend/styles.css`)
- **Panel (`.ep-pane`):** surface, radius, card shadow. Header `.ep-pane-head` at 16px/600, body `.ep-pane-pad`.
- **Button (`.ep-b`):** 13px/500, 1px ink border, radius. Primary is `data-v="p"`: purple fill with a soft shadow.
- **Table:** uppercase 12px/600 header on an 18% ink rule. Rows 14px with 12% ink rules and a light hover.
- **Pills (`.ep-tag`):** 12px/500, capitalised, tinted by `data-t` (`pos`, `att`, `neg`, `esc`, `asset`, `service`).
- **KPI tile (`.ep-kpi`):** separate card, 28px value.
- **Segmented control (`.ep-seg`):** grey track with a white active segment in primary text.
- **Inputs:** `.input` from `design-system.css`, 38px min height, 6px radius, primary focus ring.
- **Dialogs and modals:** surface, radius, dialog shadow, scrim from `--scrim`.

## Charts
ApexCharts, with our own data only. Colours come from the tokens above so charts follow the theme.

## Not yet built (see the phase plan)
- Icons in the sidebar and cards (Vuexy uses icon avatars on every tile).
- Dashboard widgets and charts, and the page-by-page restyle beyond the shell.
- Mobile sidebar drawer (the sidebar currently stacks above content below 900px).
