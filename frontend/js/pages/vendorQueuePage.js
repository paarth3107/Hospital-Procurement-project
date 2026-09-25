import { askRevealPassword } from "./vendorReveal.js";
import { API_BASE, api, apiHeaders } from "../api.js";
import { showResult } from "../ui.js";
import { modalPrompt, modalConfirm } from "../modal.js";
import { VENDOR_DOC_TYPES } from "../constants.js";
import { esc, kicker, tag, stateTag, th, emptyRow, fmtDate, fmtDateTime, btn, expiryTag } from "../kit.js";
import { refreshChrome } from "../nav.js";
import { state } from "../state.js";

// ---- Vendor registrations (Module 1): queue on the left, the selected
// registration's identity, KYC documents and decision bar on the right. ----
const root = () => document.getElementById("queue-root");
const resultEl = () => document.getElementById("queue-result");

let statusFilter = null; // set on first load, by role
let vendors = [];
let selectedId = null;
// Verify/Reject on a document stay disabled until the reviewer has opened
// the file in this review session, so nobody rubber-stamps unseen documents.
let reviewedDocIds = new Set();

const FILTERS = [
  ["pending_verification", "Pending"],
  ["info_requested", "Info requested"],
  ["active", "Active"],
  ["rejected", "Rejected"],
  ["suspended", "Suspended"],
  ["blacklisted", "Blacklisted"],
  ["", "All"],
];

// Lets the dashboard's action queue open the list with one vendor preselected.
export function preselectVendor(id) {
  selectedId = id;
  statusFilter = "pending_verification";
}

export async function loadVendors() {
  if (statusFilter === null) statusFilter = "pending_verification";
  try {
    vendors = await api("/vendors" + (statusFilter ? `?status_filter=${statusFilter}` : ""));
    if (!vendors.some((v) => v.id === selectedId)) selectedId = vendors[0]?.id ?? null;
    reviewedDocIds = new Set();
    await render();
  } catch (err) {
    showResult(resultEl(), "Could not load vendors: " + err.message, false);
  }
}

function queuePane() {
  const list = vendors.length
    ? vendors
        .map(
          (v) => `<button class="ep-row-btn${v.id === selectedId ? " sel" : ""}" data-vendor="${v.id}">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
              <span style="font-size:13px;font-weight:800">${esc(v.legal_name)}</span>
              <span class="ep-sub">V-${v.id}</span>
            </div>
            <div style="display:flex;align-items:center;gap:7px;margin-top:5px">${stateTag(v.status)}<span class="ep-sub">${esc(v.contact_person)}</span></div>
          </button>`
        )
        .join("")
    : `<div class="ep-pane-pad hint">No vendors in this status.</div>`;
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Vendors</span></div>
    <div style="padding:10px 12px;border-bottom:1px solid rgba(32,30,29,.18)">
      <select class="input" id="queue-filter">${FILTERS.map(([v, l]) => `<option value="${v}" ${v === statusFilter ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    ${list}
  </div>`;
}

const money = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN"));

function identityPane(v) {
  const groups = [
    ["Company", [["Trade name", v.trade_name], ["Entity type", v.entity_type], ["Incorporated", v.year_of_incorporation], ["Vendor ID", `V-${v.id}`], ["Registered address", v.registered_address, 2], ["Branch locations", v.branch_locations, 2]]],
    ["Statutory & banking", [["GSTIN", v.gstin, 1, "gstin"], ["PAN", v.pan, 1, "pan"], ["Bank", v.bank_name], ["IFSC", v.bank_ifsc, 1, "bank_ifsc"], ["Account number", v.bank_account_number, 2, "bank_account_number"]]],
    ["Contact", [["Primary contact", v.contact_person], ["Designation", v.contact_designation], ["Phone", v.phone, 1, "phone"], ["Email", v.email], ["Escalation contact", [v.escalation_contact_name, v.escalation_contact_email].filter(Boolean).join(" · "), 1], ["Escalation phone", v.escalation_contact_phone, 1, "escalation_contact_phone"]]],
    ["Commercial terms", [["Payment terms", v.payment_terms], ["Lead time", v.delivery_lead_time_days != null ? `${v.delivery_lead_time_days} days` : null], ["Min. order value", v.min_order_value != null ? money(v.min_order_value) : null], ["Note on file", v.rejection_reason]]],
  ];
  return `<div class="ep-pane ep-pane-pad">
    <div style="display:flex;align-items:flex-start;gap:16px">
      <div style="flex:1">${kicker(`V-${v.id} · applied ${fmtDate(v.created_at)}`)}<h4 style="margin:4px 0 3px;font-size:22px">${esc(v.legal_name)}</h4></div>
      <div style="text-align:right">${kicker("Current status")}<div style="margin-top:5px">${stateTag(v.status)}</div></div>
    </div>
    ${groups
      .map(
        ([title, facts]) => `<div style="height:2px;background:rgba(32,30,29,.4);margin:16px 0 12px"></div>${kicker(title)}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px 16px;margin-top:8px">${facts
          .map(([k, val, span, secret]) => {
            const cell = secret && val != null
              ? `<span data-secret="${secret}" data-label="${esc(k)}">${esc(val)}</span> <button type="button" class="ep-b" data-reveal="${secret}" title="Show (asks for your password)" aria-label="Show ${esc(k)}" style="padding:0 7px;font-style:italic;font-family:serif">i</button>`
              : esc(val ?? "—");
            return `<div style="grid-column:span ${span || 1}">${kicker(k)}<div style="font-size:13px;font-weight:600;margin-top:3px;word-break:break-word">${cell}</div></div>`;
          })
          .join("")}</div>`
      )
      .join("")}
  </div>`;
}

function docsPane(vendor, docs) {
  const byType = new Map(docs.filter((d) => d.doc_type !== "other").map((d) => [d.doc_type, d]));
  // Standard document slots first, then any free-text "other" documents a
  // catalog entry asked for (the reviewer reads the name and verifies).
  const slots = [
    ...VENDOR_DOC_TYPES.map((t) => ({ label: t.label, mandatory: t.mandatory, doc: byType.get(t.value) })),
    ...docs.filter((d) => d.doc_type === "other").map((d) => ({ label: d.custom_label, mandatory: false, doc: d, other: true })),
  ];
  const rows = slots
    .map(({ label, mandatory, doc: d, other }) => {
      if (!d) {
        return `<tr><td class="ep-cell" style="font-weight:600">${esc(label)}${mandatory ? "" : ' <span class="ep-sub">(optional)</span>'}</td>
        <td class="ep-cell ep-sub" colspan="3">Not uploaded</td><td class="ep-cell">${tag("Missing", mandatory ? "att" : "")}</td><td class="ep-cell"></td></tr>`;
      }
      const viewed = reviewedDocIds.has(d.id);
      const off = viewed ? "" : "disabled";
      return `<tr>
      <td class="ep-cell" style="font-weight:600">${esc(label)}${other ? '<div class="ep-sub">Other — asked for by a catalog entry; read the name and verify</div>' : ""}</td>
      <td class="ep-cell ep-mono" style="font-size:12px">${esc(d.original_filename)}<div class="ep-sub">${(d.size_bytes / 1024).toFixed(0)} KB · <a href="#" data-view-doc="${d.id}">View</a></div></td>
      <td class="ep-cell" style="font-size:12.5px">${fmtDate(d.uploaded_at)}</td>
      <td class="ep-cell" style="font-size:12.5px">${d.valid_till ? `${fmtDate(d.valid_till)}<div>${expiryTag(d)}</div>` : '<span class="ep-sub">—</span>'}</td>
      <td class="ep-cell">${stateTag(d.status)}${d.status === "rejected" && d.rejection_reason ? `<div class="ep-sub" style="color:#ae1800">${esc(d.rejection_reason)}</div>` : ""}</td>
      <td class="ep-cell" style="text-align:right;white-space:nowrap">
        ${d.status !== "verified" ? `<button class="ep-b" data-v="p" data-doc="${d.id}" data-act="verify" ${off}>Verify</button> ` : ""}
        <button class="ep-b" data-doc="${d.id}" data-act="reject" ${off}>Reject</button>
        ${viewed ? "" : '<div class="ep-sub">View before deciding</div>'}
      </td></tr>`;
    })
    .join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>KYC &amp; statutory documents</span></div>
    <table class="ep-table">${th("Document", "File", "Uploaded", "Valid till", "Verification", "")}<tbody>${rows}</tbody></table>
  </div>`;
}

const canReinstateBlacklisted = () => ["procurement_admin", "category_manager", "system_admin"].includes(state.user?.role);

function decisionBar(vendor, docs) {
  const decidable = ["pending_verification", "info_requested"].includes(vendor.status);
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  const mandatoryRejected = VENDOR_DOC_TYPES.filter((t) => t.mandatory).some((t) => byType.get(t.value)?.status === "rejected");
  const banner = decidable && mandatoryRejected
    ? `<div class="ep-note warn">A mandatory document has been rejected. Either reject this registration outright, or request the documents again with a note explaining what's needed.</div>`
    : "";
  const bar = (text, buttons) =>
    `${banner}<div class="ep-pane" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
      <div style="flex:1;font-size:12.5px;color:rgba(32,30,29,.68);line-height:1.45">${text}</div>${buttons}</div>`;

  if (decidable) {
    return bar(
      "Every mandatory document must be Verified before approval. Approval activates the vendor and opens category mapping.",
      btn("Request info", { attrs: 'data-decision="info"' }) +
        btn("Reject", { attrs: 'data-decision="reject"' }) +
        (mandatoryRejected ? "" : btn("Approve &amp; activate", { primary: true, attrs: 'data-decision="approve"' }))
    );
  }
  if (vendor.status === "active") {
    return bar(
      "Suspending blocks bidding, new mappings and new invitations, and keeps history and mappings. Blacklisting also blocks login; reinstating a blacklisted vendor needs an explicit reason.",
      btn("Blacklist", { attrs: 'data-decision="blacklist"' }) + btn("Suspend vendor", { primary: true, attrs: 'data-decision="suspend"' })
    );
  }
  if (vendor.status === "suspended") {
    return bar(
      "This vendor is suspended and can't bid or be invited. Reinstate once the issue is resolved.",
      btn("Blacklist", { attrs: 'data-decision="blacklist"' }) + btn("Reinstate", { primary: true, attrs: 'data-decision="reinstate"' })
    );
  }
  if (vendor.status === "blacklisted") {
    return canReinstateBlacklisted()
      ? bar(
          "This vendor is blacklisted and cannot log in or bid. Reinstating needs an explicit reason, which is kept in the status history.",
          btn("Reinstate vendor", { primary: true, attrs: 'data-decision="reinstate-blacklisted"' })
        )
      : `<div class="ep-pane ep-pane-pad hint">This vendor is blacklisted. Reinstating it needs an explicit reason.</div>`;
  }
  return `<div class="ep-pane ep-pane-pad hint">This vendor is ${esc(vendor.status)}; no decision is pending.</div>`;
}

function historyPane(history) {
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>Status history</span></div>
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px">${history
      .slice()
      .reverse()
      .map(
        (h) => `<div class="hist"><div class="hist-when">${fmtDateTime(h.at)}</div>
          <div style="font-size:12px;line-height:1.4">${h.from_status ? esc(h.from_status.replace("_", " ")) + " → " : ""}<b>${esc(h.to_status.replace("_", " "))}</b>${h.reason ? " — " + esc(h.reason) : ""}</div></div>`
      )
      .join("")}</div>
  </div>`;
}

async function render() {
  let detail = '<div class="ep-pane ep-pane-pad hint">Select a registration to review it.</div>';
  let current = null;
  let docs = [];
  if (selectedId !== null) {
    try {
      let history;
      [current, docs, history] = await Promise.all([
        api(`/vendors/${selectedId}`),
        api(`/vendors/${selectedId}/documents`),
        api(`/vendors/${selectedId}/status-history`),
      ]);
      detail = `<div style="display:flex;flex-direction:column;gap:18px">${identityPane(current)}${docsPane(current, docs)}${historyPane(history)}${decisionBar(current, docs)}</div>`;
    } catch (err) {
      detail = `<div class="result err">Could not load vendor: ${esc(err.message)}</div>`;
    }
  }
  root().innerHTML = `<div class="ep-grid" style="grid-template-columns:340px 1fr">${queuePane()}${detail}</div>`;
  wire(current);
}

async function openDocument(vendorId, docId) {
  try {
    const res = await fetch(API_BASE + `/vendors/${vendorId}/documents/${docId}/download`, { headers: apiHeaders() });
    if (!res.ok) throw new Error("Could not open document");
    window.open(URL.createObjectURL(await res.blob()), "_blank");
    return true;
  } catch (err) {
    showResult(resultEl(), err.message, false);
    return false;
  }
}

async function post(path, body) {
  return api(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
}

function wire(vendor) {
  const r = root();
  r.querySelector("#queue-filter")?.addEventListener("change", (e) => {
    statusFilter = e.target.value;
    loadVendors();
  });
  r.querySelectorAll("[data-vendor]").forEach((b) =>
    b.addEventListener("click", () => {
      selectedId = Number(b.dataset.vendor);
      reviewedDocIds = new Set();
      render();
    })
  );
  r.querySelectorAll("[data-reveal]").forEach((b) =>
    b.addEventListener("click", async () => {
      const span = b.parentElement.querySelector("[data-secret]");
      const value = await askRevealPassword(selectedId, b.dataset.reveal, span.dataset.label);
      if (value != null) {
        span.textContent = value;
        b.remove(); // shown until the vendor is reopened or the tab re-rendered
      }
    })
  );
  r.querySelectorAll("[data-view-doc]").forEach((a) =>
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (await openDocument(selectedId, a.dataset.viewDoc)) {
        reviewedDocIds.add(Number(a.dataset.viewDoc));
        render();
      }
    })
  );
  r.querySelectorAll("[data-doc]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        if (b.dataset.act === "reject") {
          const reason = await modalPrompt("Reason for rejecting this document (required):");
          if (!reason) return;
          await post(`/vendors/${selectedId}/documents/${b.dataset.doc}/reject`, { reason });
        } else {
          await post(`/vendors/${selectedId}/documents/${b.dataset.doc}/verify`);
        }
        render();
      } catch (err) {
        showResult(resultEl(), "Could not update document: " + err.message, false);
      }
    })
  );
  r.querySelectorAll("[data-decision]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.decision, vendor)));
}

async function decide(kind, vendor) {
  try {
    if (kind === "approve") {
      if (!(await modalConfirm("Approve this vendor? They'll become Active and can start requesting catalog mappings.", { confirmLabel: "Approve" }))) return;
      await post(`/vendors/${vendor.id}/approve`);
      showResult(resultEl(), "Vendor approved.", true);
    } else if (kind === "reject") {
      const reason = await modalPrompt("Reason for rejecting this registration (required):");
      if (!reason) return;
      await post(`/vendors/${vendor.id}/reject`, { reason });
      showResult(resultEl(), "Registration rejected.", true);
    } else if (kind === "suspend") {
      const reason = await modalPrompt(`Reason for suspending ${vendor.legal_name} (required):`);
      if (!reason) return;
      await post(`/vendors/${vendor.id}/suspend`, { reason });
      showResult(resultEl(), "Vendor suspended.", true);
    } else if (kind === "reinstate") {
      if (!(await modalConfirm(`Reinstate ${vendor.legal_name} to Active?`, { confirmLabel: "Reinstate" }))) return;
      await post(`/vendors/${vendor.id}/reinstate`, {});
      showResult(resultEl(), "Vendor reinstated.", true);
    } else if (kind === "reinstate-blacklisted") {
      const reason = await modalPrompt(`Explicit reason for reinstating ${vendor.legal_name} (required — recorded in the status history):`);
      if (!reason) return;
      await post(`/vendors/${vendor.id}/reinstate`, { reason });
      showResult(resultEl(), "Vendor reinstated.", true);
    } else if (kind === "blacklist") {
      const reason = await modalPrompt(`Reason for blacklisting ${vendor.legal_name} (required — it can be reinstated later, with a reason):`);
      if (!reason) return;
      await post(`/vendors/${vendor.id}/blacklist`, { reason });
      showResult(resultEl(), "Vendor blacklisted.", true);
    } else {
      const note = await modalPrompt("Note to the vendor explaining what's needed (required):");
      if (!note) return;
      await post(`/vendors/${vendor.id}/request-info`, { note });
      showResult(resultEl(), "Documents requested again.", true);
    }
    await loadVendors();
    refreshChrome();
  } catch (err) {
    showResult(resultEl(), "Could not complete that: " + err.message, false);
  }
}
