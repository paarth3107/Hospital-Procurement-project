# Design reference — Modernist prototype (condensed)

Source folder (on the user's machine, outside the repo): `C:\Users\Paart\Downloads\design_handoff_eprocurement\`
- `prototype\E-Procurement Prototype.dc.html` — **the main file** (14 screens, all behaviour).
- `index.html` — the developer handoff spec (rules below are from it); `README.md` — same, condensed.
- `prototype\support.js` — runtime for the prototype only; not part of the design.
- `prototype\_ds\modernist-*\styles.css` — the design-system tokens/components (source of truth for the look; they match the tokens below).
- `reference\functional-specification.txt` — text of the original functional spec the prototype was built from.

Where the handoff spec and the prototype disagree, the prototype is correct. Where either
disagrees with `CLAUDE.md` / `E-Procurement-Spec-v2.md`, **ask the user** (see CLAUDE.md
"Active Questions").

## Tokens
| Token | Value | Use |
|---|---|---|
| bg | `#f3f2f2` | page ground, input fills |
| surface | `#eae9e9` | panels, sidebar, cards |
| ink | `#201e1d` | body text, dark tag fills |
| accent | `#ec3013` | primary button, L1 marker, bars |
| accent-700 / 900 / 100 | `#ae1800` / `#7c1405` / `#ffe0d9` | accent text / text on tint / positive tag fill |
| neutral-300 | `#d7d3d3` | Service tag, escalated |
| strong rule | `2px solid rgba(32,30,29,.4)` | dividers, table head |
| panel border | `1px solid rgba(32,30,29,.3)` | |
| row rule | `1px solid rgba(32,30,29,.18)` | |
| muted text | ink at .5–.6; secondary .65–.7 | |

No green/blue anywhere. Positive = accent tint (`#ffe0d9` on `#7c1405`); terminal/negative =
solid ink (`#201e1d` on `#f3f2f2`); neutral/in-progress = `rgba(32,30,29,.12)` on ink;
attention = `rgba(236,48,19,.16)` on `#ae1800`; escalated = `#d7d3d3` on `#2d2b2b`.

Type: Archivo only (400/600/700/800). Radius **0 everywhere**. Flush-left, never centred.
Kicker/label: 10px/600, letter-spacing .11em, uppercase, ink .5. Table head: 10px/600, .09em,
uppercase, on a 2px rule. Table cell 13.5px, padding 9px 10px, no zebra. Tag 10–10.5px/600
uppercase, padding 2px 7–8px. Codes/refs in ui-monospace 12px. Button: 5px 11px, 12px/600,
ghost = 1px ink-30% border; primary = accent fill `#f3f2f2` label; disabled = opacity .4.
Hover: ghost `rgba(32,30,29,.09)`, primary `#dd2b0f`. Focus: 2px accent outline, 2px offset.

## Shell
Sidebar 238px (`#eae9e9`, 2px right rule): brand `MEDIPROC` + kicker, role-scoped nav heading,
flat nav list (button 9px 14px 9px 17px, 13.5px/600, 3px left border that turns accent when
active + `rgba(236,48,19,.08)` fill + `#ae1800` label, optional right badge), identity block
pinned at the bottom. Header: kicker (module) + 24px title on a 2px bottom rule. Content
24px 28px, 22px gap. Panels: surface fill, 1px border, optional 2px-ruled header bar,
optional 3px accent left border for urgency. Toast bottom-left, ink fill, 3px accent left
border, auto-dismiss 4200ms; modal 560px, 2px ink border, scrim `rgba(45,43,43,.5)`.

## Screens (14) — internal: dash, vendors, master, mapping, rating, create, publish, evaluate, po, overrides; vendor: vTenders, vBid, vPo, vProfile
Key structures worth copying when building each (details in the prototype):
- **vendors:** 340px queue list | detail (identity, KYC docs table, decision bar Approve / Reject / Request info).
- **master:** All/Item/Asset/Service segment filter; table Code, Name+spec, Type tag, Category breadcrumb (`Cat › Sub`), type-specific attrs, price band, vendor count.
- **mapping:** vendor × category grid, cells MAPPED / PENDING / —; click opens a detail dialog (facts, versioned history, SKUs in scope, Approve/Suspend). *(Our build currently acts directly on a cell click — pending user decision.)*
- **rating:** weight strip (25/25/20/15/15) + 3-up scorecards with parameter bars, tiers Preferred ≥85 / Qualified ≥75 / Watch, floor 70.
- **create:** header field grid + one panel per line item (attrs by type | mandatory attachment checklist) + gate bar.
- **publish:** per line: filter-chain bars, excluded chips with reasons, invite list (System qualified / Manually invited / Guest invite), zero-vendor block.
- **evaluate (centrepiece):** per-line comparative tables (L-rank, optional T-rank/tech score, vendor, rating, unit, tax, landed, total, qualification, Award), technical criteria strip, split slider (50–100 step 5, min split 30%), sticky award summary.
- **overrides:** six-state engine strip + inbox table.
- **vendor screens:** invitation banner + invitations table; quotation per-line panels (unit price, GST, lead time, validity, exact-match declaration + mandatory deviation reason, remark, attachments, sealed-bid submit gate); awards/POs; company profile + document vault + category chips.

## Prototype rules already implemented there (server-side in a real build)
Landed = unit × (1+tax%); L-rank among Qualified only, ascending landed, tie-break higher rating; T-rank by weighted technical score, cut-off 70 (Asset) / 65 (other); split value = landed(L1)·qty·pct + landed(L2)·qty·(1−pct); non-L1 award needs an override; eligibility = Active ∩ mapping ∩ rating ≥ threshold ∩ compliance current, ordered by rating, capped at max invites; a line with zero eligible vendors is held back while other lines publish (**open question — our build blocks the whole submission**).
