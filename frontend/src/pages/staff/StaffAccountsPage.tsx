import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuthState } from "../../lib/authStore";
import { ROLE_LABELS, fmtDate } from "../../lib/format";
import type { Facility, StaffUser } from "../../lib/types";
import { Tag, StateTag } from "../../components/Tag";
import { IconActionButton } from "../../components/IconActionButton";
import { Pagination, pageSlice } from "../../components/Pagination";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { StaffFormDialog } from "./StaffFormDialog";
import { FacilityFormDialog } from "./FacilityFormDialog";

// Ported 1:1 from frontend/js/pages/staff/staffPage.js -- Phase 1 of the
// React migration (see .claude-notes/REACT-MIGRATION-PLAN.md).
//
// Reset password moved off this page's own row action and into the Edit
// dialog (2026-10-24, user-directed) -- StaffFormDialog.tsx now opens
// PasswordResetDialog itself, so this page no longer needs its own "kind" or
// button for it.

type Dialog =
  | { kind: "add-staff" }
  | { kind: "edit-staff"; user: StaffUser }
  | { kind: "add-facility" }
  | { kind: "confirm-toggle"; user: StaffUser };

export function StaffAccountsPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  // Real bug, found 2026-10-15: own redundant /auth/me fetch, same pattern
  // as DashboardPage -- the id is already in the shared auth store.
  const currentUserId = useAuthState().user?.id ?? null;
  const [page, setPage] = useState(0);
  const [facilityFilter, setFacilityFilter] = useState(""); // "" = every facility
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const load = useCallback(async (successMessage?: string) => {
    try {
      const [s, f] = await Promise.all([api<StaffUser[]>("/staff"), api<Facility[]>("/facilities")]);
      setStaff(s);
      setFacilities(f);
      if (successMessage) setMessage({ text: successMessage, ok: true });
      else setMessage(null);
    } catch (err) {
      setMessage({ text: "Could not load staff accounts: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  // A facility-scoped filter still shows "All facilities" staff (group-wide
  // roles apply everywhere) alongside that facility's own accounts.
  const filtered = facilityFilter === "" ? staff : staff.filter((u) => u.facility_id == null || u.facility_id === Number(facilityFilter));
  const { pageItems, totalPages, page: clamped } = pageSlice(filtered, page);
  if (clamped !== page) setPage(clamped);

  const title = facilityFilter === "" ? "All Facilities" : facilityName.get(Number(facilityFilter)) || "Facility";

  const toggleActive = async (u: StaffUser) => {
    try {
      await api(`/staff/${u.id}/${u.is_active ? "deactivate" : "reactivate"}`, { method: "POST" });
      load(`${u.full_name} ${u.is_active ? "deactivated" : "reactivated"}.`);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  return (
    <div className="ep-pane">
      <div className="ep-pane-head">
        <span>{title}</span>
        <div className="d-flex items-center gap-10px">
          <select
            className="input w-auto"
            value={facilityFilter}
            onChange={(e) => {
              setFacilityFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All facilities</option>
            {facilities.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="ep-b" onClick={() => setDialog({ kind: "add-facility" })}>
            Add facility
          </button>
          <button className="ep-b" data-v="p" onClick={() => setDialog({ kind: "add-staff" })}>
            Add staff
          </button>
        </div>
      </div>
      <table className="ep-table">
        <thead>
          <tr>
            {["Name", "Role", "Facility", "Status", "Created", "Action"].map((h) => (
              <th className="ep-th" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageItems.length === 0 ? (
            <tr>
              <td className="ep-cell text-ink-55" colSpan={6}>
                No staff accounts.
              </td>
            </tr>
          ) : (
            pageItems.map((u) => {
              const me = u.id === currentUserId;
              return (
                <tr key={u.id}>
                  <td className="ep-cell fw-600">
                    {u.full_name}
                    {me && <span className="ep-sub"> (you)</span>}
                    <div className="ep-sub">{u.email}</div>
                  </td>
                  <td className="ep-cell">
                    {ROLE_LABELS[u.role] || u.role}
                    {u.approval_tier && <div className="ep-sub">Tier {u.approval_tier}</div>}
                  </td>
                  <td className="ep-cell">{u.facility_id == null ? "All facilities" : facilityName.get(u.facility_id) || "—"}</td>
                  <td className="ep-cell">{u.is_active ? <StateTag state="active" /> : <Tag text="Deactivated" tone="neg" />}</td>
                  <td className="ep-cell fs-12-5px">{fmtDate(u.created_at)}</td>
                  <td className="ep-cell ep-actions-cell text-right nowrap">
                    <div className="d-flex items-center justify-end gap-6px">
                      {!me && (
                        // Deactivating asks for confirmation first (matches the vanilla
                        // modalConfirm gate); reactivating needs none, same as before.
                        <IconActionButton
                          icon={u.is_active ? "trash" : "check-circle"}
                          label={u.is_active ? "Deactivate" : "Reactivate"}
                          tone={u.is_active ? "danger" : undefined}
                          onClick={() => (u.is_active ? setDialog({ kind: "confirm-toggle", user: u }) : toggleActive(u))}
                        />
                      )}
                      <IconActionButton icon="edit" label="Edit" onClick={() => setDialog({ kind: "edit-staff", user: u })} />
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      {message && <div className={`result ${message.ok ? "ok" : "err"}`}>{message.text}</div>}

      {dialog?.kind === "add-staff" && (
        <StaffFormDialog user={null} facilities={facilities} existingEmails={staff.map((u) => u.email)} onClose={() => setDialog(null)} onSaved={(msg) => load(msg)} />
      )}
      {dialog?.kind === "edit-staff" && (
        <StaffFormDialog user={dialog.user} facilities={facilities} existingEmails={staff.map((u) => u.email)} onClose={() => setDialog(null)} onSaved={(msg) => load(msg)} />
      )}
      {dialog?.kind === "add-facility" && (
        <FacilityFormDialog
          existingCodes={facilities.map((f) => f.legal_entity_code)}
          onClose={() => setDialog(null)}
          onSaved={(facility) => {
            setFacilityFilter(String(facility.id));
            setPage(0);
            load(`Created facility "${facility.name}".`);
          }}
        />
      )}
      {dialog?.kind === "confirm-toggle" && (
        <ConfirmDialog
          title="Deactivate Account?"
          message={`${dialog.user.full_name} will no longer be able to log in. Their past work stays on record.`}
          confirmLabel="Deactivate"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            toggleActive(dialog.user);
          }}
        />
      )}
    </div>
  );
}
