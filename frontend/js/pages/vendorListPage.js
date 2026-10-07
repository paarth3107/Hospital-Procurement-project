import { api } from "../api.js";
import { showResult } from "../ui.js";
import { switchView } from "../nav.js";
import { esc, stateTag, th, emptyRow, fmtDate, pageSlice, paginationBar, wirePagination, imgPlaceholder } from "../kit.js";
import { kpiStrip as kpiTiles } from "./dashboard/kpi.js";
import { setViewVendorId, setPendingListFilter, takePendingListFilter } from "./vendorViewState.js";

// ---- Vendor List (Module 1, 2026-10-07 -- Vuexy's own User List applied to
// vendors, split out of the old combined queue+detail screen into two
// sidebar-reachable screens: this table, and Vendor View for one vendor's
// full profile/decision screen, reached via the View button below or a
// deep link from the dashboard's action queue (preselectVendor). ----
const root = () => document.getElementById("queue-root");
const resultEl = () => document.getElementById("queue-result");

const FILTERS = [
  ["pending_verification", "Pending"],
  ["info_requested", "Info requested"],
  ["active", "Active"],
  ["rejected", "Rejected"],
  ["suspended", "Suspended"],
  ["blacklisted", "Blacklisted"],
  ["", "All"],
];

let allVendors = [];
let statusFilter = "";
let listPage = 0;

// Lets the dashboard's action queue open a vendor's profile directly
// (Vendor View), remembering a filter for when staff clicks back here.
export function preselectVendor(id, filter = "pending_verification") {
  setPendingListFilter(filter);
  setViewVendorId(id);
}

function kpiStrip(vendors) {
  const count = (s) => vendors.filter((v) => v.status === s).length;
  return kpiTiles([
    ["Total vendors", vendors.length, "all registrations", null, "users", "primary"],
    ["Active", count("active"), "approved, can bid", null, "user-check", "success"],
    ["Needs review", count("pending_verification") + count("info_requested"), "pending verification or info requested", null, "clock", "warning"],
    ["Suspended / blacklisted", count("suspended") + count("blacklisted"), "blocked from bidding", null, "shield", "danger"],
  ]);
}

function tableRows() {
  const filtered = statusFilter ? allVendors.filter((v) => v.status === statusFilter) : allVendors;
  const { pageItems, totalPages, page } = pageSlice(filtered, listPage);
  listPage = page;
  const html = pageItems.length
    ? pageItems
        .map(
          (v) => `<tr>
        <td class="ep-cell">
          <div class="d-flex items-center gap-12px">
            ${imgPlaceholder("image", "sm")}
            <div class="minw-0">
              <div class="fw-600 ep-clip" title="${esc(v.legal_name)}">${esc(v.legal_name)}</div>
              <div class="ep-sub">V-${v.id}</div>
            </div>
          </div>
        </td>
        <td class="ep-cell fs-12-5px">${esc(v.contact_person)}</td>
        <td class="ep-cell">${stateTag(v.status)}</td>
        <td class="ep-cell fs-12-5px">${fmtDate(v.created_at)}</td>
        <td class="ep-cell text-right"><button class="ep-b" data-view-vendor="${v.id}">View</button></td>
      </tr>`
        )
        .join("")
    : emptyRow(5, "No vendors in this status.");
  return { html, totalPages, page, count: filtered.length };
}

function render() {
  const { html, totalPages, page, count } = tableRows();
  root().innerHTML = `<div class="d-flex flex-col gap-16px">
    ${kpiStrip(allVendors)}
    <div class="ep-pane">
      <div class="ep-pane-head"><span>Vendors</span>
        <span class="d-flex items-center gap-10px"><span class="ep-k">${count} shown</span>
          <select class="input" id="queue-filter">${FILTERS.map(([v, l]) => `<option value="${v}" ${v === statusFilter ? "selected" : ""}>${l}</option>`).join("")}</select>
        </span></div>
      <table class="ep-table">${th("Vendor", "Contact", "Status", "Applied", "")}<tbody>${html}</tbody></table>
      ${paginationBar(page, totalPages, "queue-prev", "queue-next")}
    </div>
  </div>`;
  wire();
}

function wire() {
  const r = root();
  r.querySelector("#queue-filter")?.addEventListener("change", (e) => {
    statusFilter = e.target.value;
    listPage = 0;
    render();
  });
  wirePagination(r, "queue-prev", "queue-next", listPage, (p) => {
    listPage = p;
    render();
  });
  r.querySelectorAll("[data-view-vendor]").forEach((b) =>
    b.addEventListener("click", () => {
      setViewVendorId(Number(b.dataset.viewVendor));
      switchView("vendor-view");
    })
  );
}

export async function loadVendors() {
  const pendingFilter = takePendingListFilter();
  if (pendingFilter !== null) statusFilter = pendingFilter;
  try {
    allVendors = await api("/vendors");
    render();
    resultEl().textContent = "";
  } catch (err) {
    showResult(resultEl(), "Could not load vendors: " + err.message, false);
  }
}
