import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Tag } from "../components/Tag";
import { useAuthState } from "../lib/authStore";
import { useChromeState, type ChromeState } from "../lib/chromeStore";
import { closingSoonTenders, NOTIFICATION_TONE } from "../lib/vendorNotifications";
import type { StaffNotification } from "../lib/types";

// Ported from frontend/js/shell.js's renderNotifications() + frontend/js/
// pages/vendorNotifications.js's bellRowsHtml()/wireBellRows(). Staff keep
// the existing badge-derived queue summary AND now also get real
// notifications of their own (2026-10-22, user-directed: told when an
// override they requested is approved/rejected) -- same read-live-off-the-
// API-each-open pattern the vendor side already uses.
interface VendorNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  read: boolean;
}
interface VendorPortalTender {
  tender_id: number;
  title: string;
  can_bid: boolean;
  bid_due_date: string | null;
}

const STAFF_ROWS: { badge: keyof ChromeState; label: string; view: string }[] = [
  { badge: "badgeQueue", label: "Vendor registrations to review", view: "queue" },
  { badge: "badgeMappings", label: "Mapping requests waiting", view: "mappings-requests" },
  { badge: "badgeApprovals", label: "Tender approvals waiting", view: "approvals" },
  { badge: "badgeAwards", label: "Award tasks", view: "awards" },
  { badge: "badgeDecisions", label: "Decisions waiting on you", view: "decisions" },
  { badge: "badgeVendorCategories", label: "Documents still needed", view: "vendor-categories" },
  { badge: "badgeVendorDashboard", label: "Unread notifications", view: "vendor-dashboard" },
];

const STAFF_NOTIFICATION_TONE: Record<string, "pos" | "neg"> = {
  override_approved: "pos",
  override_rejected: "neg",
};

export function NotificationsMenu({ onClose }: { onClose: () => void }) {
  const { actorType } = useAuthState();
  const chrome = useChromeState();
  const navigate = useNavigate();
  const isVendor = actorType === "vendor";
  const [notes, setNotes] = useState<VendorNotification[] | null>(null);
  const [tenders, setTenders] = useState<VendorPortalTender[] | null>(null);
  const [staffNotes, setStaffNotes] = useState<StaffNotification[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isVendor) {
      (async () => {
        try {
          const [n, t] = await Promise.all([api<VendorNotification[]>("/vendor-portal/notifications"), api<VendorPortalTender[]>("/vendor-portal/tenders")]);
          setNotes(n);
          setTenders(t);
        } catch {
          setError(true);
        }
      })();
    } else {
      api<StaffNotification[]>("/staff-notifications")
        .then(setStaffNotes)
        .catch(() => setStaffNotes([])); // decorative -- the badge-queue rows below still work either way
    }
  }, [isVendor]);

  const dismiss = async (id: number) => {
    await api(`/vendor-portal/notifications/${id}/read`, { method: "POST" });
    setNotes((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? null);
  };

  const dismissStaff = async (id: number) => {
    await api(`/staff-notifications/${id}/read`, { method: "POST" });
    setStaffNotes((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? null);
  };

  if (isVendor) {
    if (error) return <div className="ep-dropdown ep-dropdown-wide"><div className="ep-dropdown-head">Notifications</div><div className="ep-dropdown-empty">Could not load notifications.</div></div>;
    if (!notes || !tenders) return <div className="ep-dropdown ep-dropdown-wide"><div className="ep-dropdown-head">Notifications</div><div className="ep-dropdown-empty">Loading…</div></div>;
    const unread = notes.filter((n) => !n.read).slice(0, 6);
    const soon = closingSoonTenders(tenders);
    if (!unread.length && !soon.length) {
      return <div className="ep-dropdown ep-dropdown-wide"><div className="ep-dropdown-head">Notifications</div><div className="ep-dropdown-empty">You're all caught up.</div></div>;
    }
    return (
      <div className="ep-dropdown ep-dropdown-wide">
        <div className="ep-dropdown-head">Notifications</div>
        {soon.map((t) => (
          <button
            type="button"
            className="ep-notif-item"
            key={t.tender_id}
            onClick={() => {
              onClose();
              navigate(`/bid/${t.tender_id}`);
            }}
          >
            <div className="d-flex items-center gap-8px flex-wrap">
              <Tag text="Closing soon" tone="att" />
              <span className="fw-700 fs-13px">{t.title}</span>
            </div>
            <div className="ep-sub mt-4px fs-12-5px">Closes {fmtDateTime(t.bid_due_date)} — submit soon or it'll pass without a bid.</div>
          </button>
        ))}
        {unread.map((n) => {
          const [label, tone] = NOTIFICATION_TONE[n.kind] || [n.kind, ""];
          return (
            <div className="ep-notif-item" key={n.id}>
              <div className="d-flex justify-between items-start gap-8px">
                <div className="d-flex items-center gap-8px flex-wrap">
                  <Tag text={label} tone={tone as "" | "pos" | "att" | "neg" | "esc"} />
                  <span className="fw-700 fs-13px">{n.title}</span>
                </div>
                <button type="button" className="ep-notif-dismiss" title="Dismiss" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}>
                  ✕
                </button>
              </div>
              <div className="ep-sub mt-4px fs-12-5px">{n.body}</div>
            </div>
          );
        })}
      </div>
    );
  }

  const rows = STAFF_ROWS.map((r) => ({ ...r, n: chrome[r.badge] })).filter((r) => r.n);
  const unreadStaffNotes = (staffNotes ?? []).filter((n) => !n.read).slice(0, 6);
  if (!rows.length && !unreadStaffNotes.length) {
    return (
      <div className="ep-dropdown ep-dropdown-wide">
        <div className="ep-dropdown-head">Notifications</div>
        <div className="ep-dropdown-empty">You're all caught up.</div>
      </div>
    );
  }
  return (
    <div className="ep-dropdown ep-dropdown-wide">
      {unreadStaffNotes.length > 0 && (
        <>
          <div className="ep-dropdown-head">Notifications</div>
          {unreadStaffNotes.map((n) => (
            <div className="ep-notif-item" key={n.id}>
              <div className="d-flex justify-between items-start gap-8px">
                <div className="d-flex items-center gap-8px flex-wrap">
                  <Tag text={n.kind === "override_approved" ? "Approved" : n.kind === "override_rejected" ? "Declined" : n.kind} tone={STAFF_NOTIFICATION_TONE[n.kind] ?? ""} />
                  <span className="fw-700 fs-13px">{n.title}</span>
                </div>
                <button type="button" className="ep-notif-dismiss" title="Dismiss" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); dismissStaff(n.id); }}>
                  ✕
                </button>
              </div>
              <div className="ep-sub mt-4px fs-12-5px">{n.body}</div>
            </div>
          ))}
        </>
      )}
      {rows.length > 0 && (
        <>
          <div className="ep-dropdown-head">Needs your attention</div>
          {rows.map((r) => (
            <button
              className="ep-dropdown-item"
              type="button"
              key={r.view}
              onClick={() => {
                onClose();
                navigate("/" + r.view);
              }}
            >
              <span>{r.label}</span>
              <span className="nav-badge">{r.n}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
