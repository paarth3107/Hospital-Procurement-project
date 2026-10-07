import { api } from "../../api.js";
import { state } from "../../state.js";
import { showResult } from "../../ui.js";
import { esc, tag, stateTag, th, emptyRow, fmtDate, pageSlice, paginationBar, wirePagination } from "../../kit.js";
import { modalConfirm } from "../../modal.js";
import { openStaffForm, ROLE_LABELS } from "./staffForm.js";
import { openPasswordDialog } from "./passwordDialog.js";
import { openFacilityForm } from "./facilityForm.js";

// ---- Staff accounts (System Admin): every hospital staff login, with add /
// edit / reset password / deactivate. ----
const root = () => document.getElementById("staff-root");
const resultEl = () => document.getElementById("staff-result-msg");

let staff = [];
let facilities = [];
let page = 0;
let facilityFilter = ""; // "" = every facility; a numeric facility id otherwise

function render() {
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  // A facility-scoped filter still shows "All facilities" staff (group-wide
  // roles apply everywhere) alongside that facility's own accounts.
  const filtered = facilityFilter === "" ? staff : staff.filter((u) => u.facility_id == null || u.facility_id === Number(facilityFilter));
  const { pageItems, totalPages, page: clamped } = pageSlice(filtered, page);
  page = clamped;
  const rows = pageItems.length
    ? pageItems
        .map((u) => {
          const me = u.id === state.user?.id;
          return `<tr>
            <td class="ep-cell fw-600">${esc(u.full_name)}${me ? ' <span class="ep-sub">(you)</span>' : ""}<div class="ep-sub">${esc(u.email)}</div></td>
            <td class="ep-cell">${esc(ROLE_LABELS[u.role] || u.role)}${u.approval_tier ? `<div class="ep-sub">tier ${u.approval_tier}</div>` : ""}</td>
            <td class="ep-cell">${u.facility_id == null ? "All facilities" : esc(facilityName.get(u.facility_id) || "—")}</td>
            <td class="ep-cell">${u.is_active ? stateTag("active") : tag("Deactivated", "neg")}</td>
            <td class="ep-cell fs-12-5px">${fmtDate(u.created_at)}</td>
            <td class="ep-cell text-right nowrap">
              <button class="ep-b" data-edit="${u.id}">Edit</button>
              <button class="ep-b" data-reset="${u.id}">Reset password</button>
              ${me ? "" : `<button class="ep-b" data-toggle="${u.id}">${u.is_active ? "Deactivate" : "Reactivate"}</button>`}
            </td></tr>`;
        })
        .join("")
    : emptyRow(6, "No staff accounts.");
  const title = facilityFilter === "" ? "All Facilities" : esc(facilityName.get(Number(facilityFilter)) || "Facility");
  root().innerHTML = `<div class="ep-pane">
    <div class="ep-pane-head"><span>${title}</span>
      <div class="d-flex items-center gap-10px">
        <select class="input w-auto" id="staff-facility-filter">
          <option value="">All facilities</option>
          ${facilities.map((f) => `<option value="${f.id}" ${facilityFilter === String(f.id) ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
        </select>
        <button class="ep-b" id="add-facility">Add facility</button>
        <button class="ep-b" data-v="p" id="add-staff">Add staff</button>
      </div>
    </div>
    <table class="ep-table">${th("Name", "Role", "Facility", "Status", "Created", "")}<tbody>${rows}</tbody></table>
    ${paginationBar(page, totalPages, "staff-prev", "staff-next")}
  </div>`;
  wirePagination(root(), "staff-prev", "staff-next", page, (p) => {
    page = p;
    render();
  });
  root().querySelector("#staff-facility-filter").addEventListener("change", (e) => {
    facilityFilter = e.target.value;
    page = 0;
    render();
  });

  const done = (msg) => load(msg);
  root().querySelector("#add-staff").addEventListener("click", () => openStaffForm(null, facilities, done));
  root().querySelector("#add-facility").addEventListener("click", () =>
    openFacilityForm((facility) => {
      facilityFilter = String(facility.id);
      page = 0;
      load(`Created facility "${facility.name}".`);
    })
  );
  root().querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openStaffForm(staff.find((u) => u.id === Number(b.dataset.edit)), facilities, done)));
  root().querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", () => openPasswordDialog(staff.find((u) => u.id === Number(b.dataset.reset)), done)));
  root().querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const u = staff.find((x) => x.id === Number(b.dataset.toggle));
      const off = u.is_active;
      if (off && !(await modalConfirm(`${u.full_name} will no longer be able to log in. Their past work stays on record.`, { title: "Deactivate Account?", confirmLabel: "Deactivate", danger: true }))) return;
      try {
        await api(`/staff/${u.id}/${off ? "deactivate" : "reactivate"}`, { method: "POST" });
        done(`${u.full_name} ${off ? "deactivated" : "reactivated"}.`);
      } catch (err) {
        showResult(resultEl(), err.message, false);
      }
    })
  );
}

async function load(message) {
  try {
    [staff, facilities] = await Promise.all([api("/staff"), api("/facilities")]);
    render();
    if (message) showResult(resultEl(), message, true);
  } catch (err) {
    showResult(resultEl(), "Could not load staff accounts: " + err.message, false);
  }
}

export const loadStaff = () => load();
