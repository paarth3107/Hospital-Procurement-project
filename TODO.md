# TODO

## Catalog: split into 4 separate sidebar items (correction, 2026-10-07)

**What I got wrong:** I built "Product List / Add Product / Category List /
Sub-Category List" as an in-page segmented control (`.ep-seg` pill tabs)
inside the single existing "Items" screen (`catalogPage.js`, one `view-catalog`
section, one sidebar entry). The user's actual ask was the Vuexy sidebar
structure itself: in Vuexy, Apps → eCommerce → Products expands in the
**sidebar** into Product List / Add Product / Category List as three
separate sidebar links, each its own page. (Vuexy's pages also show a small
pill-tab strip at the top linking between the three, but that's secondary —
the sidebar entries are the real navigation.)

**Correct target:** the sidebar's "Catalog" nav-group should show 4 separate
items (not 1), replacing today's single "Items" entry:
- Product List
- Add Product
- Category List
- Sub-Category List

### Concrete steps for next time

1. **`frontend/index.html`**
   - Inside `.ep-navgroup[data-group="catalog"]`, replace the single
     `#catalog-tab` (`data-view="catalog"`, label "Items") with 4 `tab-btn`
     buttons, e.g. `catalog-list-tab` / `catalog-add-tab` /
     `catalog-categories-tab` / `catalog-subcategories-tab`, each with its
     own `data-view` and `data-icon`.
   - Split the single `<section id="view-catalog">` into 4 sections (e.g.
     `view-catalog-list`, `view-catalog-add`, `view-catalog-categories`,
     `view-catalog-subcategories`), each with its own root container div
     (nav.js's `switchView` hides/shows by `.view` section id, so each
     destination needs its own section to be an independent view).
   - `#catalog-form-host` / `#product-result` either get duplicated per
     section or centralized — decide based on how state ends up split (see
     step 3).

2. **`frontend/js/nav.js`**
   - `ALL_STAFF_TAB_VIEWS`: replace `"catalog"` with the 4 new view names.
   - `ROLE_TABS` (category_manager, procurement_admin, system_admin today):
     replace `"catalog"` with all 4 new view names in each role's list.
   - `PAGE_TITLES`: one entry per new view (kicker stays "Module 2", title
     changes per view: "Items", "Add Item", "Categories", "Sub-categories" or
     similar).
   - `switchView`: replace `if (view === "catalog") loadProducts();` with one
     dispatch line per new view, each calling that view's own load/render
     function (see step 3).
   - No need for the `tender-edit`-style "sub-screen with no tab of its own"
     special-casing (`tabView = view === "tender-edit" ? "tenders" : view`) --
     unlike the tender editor, Add Product *does* get its own real sidebar
     tab here, so it highlights normally.

3. **`frontend/js/pages/catalog/catalogPage.js`** (biggest change)
   - Currently one module owns one shared `categories/subCategories/
     products/mappings` state array and one `render()` that switches on an
     internal `catalogTab`. Splitting into 4 routed views means either:
     (a) keep one shared data-fetch (`loadCatalogData()`) cached at module
     level and reused by whichever of the 4 view-load-functions needs it
     (avoids re-fetching categories/products/subcategories/mappings on every
     sidebar click), or
     (b) give each view its own independent fetch.
     **(a) is almost certainly right** — these 4 screens are one dataset
     viewed 4 ways, and re-fetching all 4 lists on every nav click would be
     wasteful and would also fight the "Edit" deep-link flow below.
   - Likely becomes 4 files (`productListPage.js`, `addProductPage.js`,
     `categoryListPage.js`, `subCategoryListPage.js`) or 4 exported
     load/render functions from one file — follow this repo's existing
     convention (see `feedback_js_modules` memory: one ES module per
     page/tab, no monolith) once the split is actually built.
   - "Edit" on a Product List row needs to navigate to the Add Product
     *view* (not an in-page tab) with the product pre-filled — same
     "set state, then `switchView(...)`" deep-link pattern already used
     elsewhere in this app (`openTenderById`, `openTenderReview`,
     `openTenderAward`): set a module-level `editingProduct`, then
     `switchView("catalog-add")`, and have that view's load function check
     it.
   - The type switcher (Item/Asset/Service) on Add Product and the
     Product-type filter on Product List stay as in-page `.ep-seg` controls
     *within* their own view — those were never the problem, only the outer
     4-way split was.

4. **Open questions to resolve when actually implementing this:**
   - Do we also want the small secondary pill-tab strip Vuexy shows at the
     top of each of the 4 pages (quick lateral nav without going back to the
     sidebar), or is the sidebar alone enough? Vuexy has both; this app
     might not need both.
   - Icon per sidebar item (`data-icon`) — one icon for the whole group vs.
     a distinct one per item (Vuexy uses the same for all 3 sub-items under
     one parent icon). Check `frontend/js/icons.js` for what's available
     before inventing new names.
   - Confirm sidebar collapse/sub-group behavior (`syncNavGroups()` in
     nav.js) still reads fine with 4 items instead of 1 under "Catalog" --
     should be unaffected (same mechanism already handles the Vendors/
     Tenders/Admin groups with multiple items), just flagging to re-check
     visually once built.

**Everything else from the "mimic Vuexy's eCommerce Products" pass stays as
already built** (image placeholders in `kit.js`'s `imgPlaceholder()`, the
Product List row layout, the Category List card grid, the Add Product
two-column form with the reserved image card + Organize sidebar) — only the
*navigation structure* (in-page tabs vs. sidebar items) needs redoing.
