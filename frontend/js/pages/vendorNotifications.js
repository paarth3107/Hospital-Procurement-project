import { api } from "../api.js";
import { esc, tag, fmtDateTime } from "../kit.js";

// The vendor's portal notifications (award, regret, technical disqualification).
// There is no email/SMS gateway yet, so this is where they arrive.
const TONE = { awarded: ["Awarded", "pos"], regret: ["Not selected", "esc"], technical_disqualified: ["Technical result", "neg"] };

export function notificationsHtml(all) {
  const notes = all.filter((n) => !n.read); // once read, a notification leaves the list
  if (!notes.length) return "";
  const unread = notes.length;
  return `<div class="ep-pane"><div class="ep-pane-head"><span>Notifications</span><span class="d-flex gap-10px items-center"><span class="ep-k">${unread} unread</span>${unread ? '<button class="ep-b" data-read-all>Dismiss all</button>' : ""}</span></div>
    ${notes
      .slice(0, 6)
      .map((n) => {
        const [label, tone] = TONE[n.kind] || [n.kind, ""];
        return `<div class="padding-12px-16px border-top-1px-solid-ink-15">
          <div class="d-flex gap-10px items-center flex-wrap">${tag(label, tone)}<span class="fw-700">${esc(n.title)}</span><span class="ep-sub ml-auto">${esc(fmtDateTime(n.created_at))}</span><button class="ep-b" data-read="${n.id}">Dismiss</button></div>
          <div class="mt-6px fs-13px pre-wrap">${esc(n.body)}</div></div>`;
      })
      .join("")}</div>`;
}

export function wireNotifications(container, onChange) {
  container.querySelectorAll("[data-read]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api(`/vendor-portal/notifications/${b.dataset.read}/read`, { method: "POST" });
      onChange();
    })
  );
  container.querySelector("[data-read-all]")?.addEventListener("click", async () => {
    await api("/vendor-portal/notifications/read-all", { method: "POST" });
    onChange();
  });
}
