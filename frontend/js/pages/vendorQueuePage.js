import { API_BASE, api, apiHeaders } from "../api.js";
import { showResult } from "../ui.js";
import { modalPrompt, modalConfirm } from "../modal.js";
import { VENDOR_DOC_TYPES } from "../constants.js";
import { esc, kicker, tag, stateTag, th, emptyRow, fmtDate, fmtDateTime, btn } from "../kit.js";
import { refreshChrome } from "../nav.js";

// ---- Vendor registrations (Module 1): queue on the left, the selected
// registration's identity, KYC documents and decision bar on the right. ----
const root = () => document.getElementById("queue-root");
const resultEl = () => document.getElementById("queue-result");

let statusFilter = "pending_verification";
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
  ["", "All"],
];

export async function loadVendors() {
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
    <div class="ep-pane-head"><span>Registration queue</span></div>
    <div style="padding:10px 12px;border-bottom:1px solid rgba(32,30,29,.18)">
      <select class="input" id="queue-filter">${FILTERS.map(([v, l]) => `<option value="${v}" ${v === statusFilter ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    ${list}
  </div>`;
}

function identityPane(v) {
  const facts = [
    ["GSTIN", v.gstin], ["PAN", v.pan || "—"], ["Contact person", v.contact_person], ["Email", v.email],
    ["Phone", v.phone || "—"], ["Applied", fmtDate(v.created_at)], ["Vendor ID", `V-${v.id}`], ["Note on file", v.rejection_reason || "—"],
  ];
  return `<div class="ep-pane ep-pane-pad">
    <div style="display:flex;align-items:flex-start;gap:16px">
      <div style="flex:1">${kicker(`V-${v.id} · applied ${fmtDate(v.created_at)}`)}<h4 style="margin:4px 0 3px;font-size:22px">${esc(v.legal_name)}</h4></div>
      <div style="text-align:right">${kicker("Current status")}<div style="margin-top:5px">${stateTag(v.status)}</div></div>
    </div>
    <div style="height:2px;background:rgba(32,30,29,.4);margin:16px 0"></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">${facts
      .map(([k, val]) => `<div>${kicker(k)}<div style="font-size:13px;font-weight:600;margin-top:3px;word-break:break-word">${esc(val)}</div></div>`)
      .join("")}</div>
  </div>`;
}

function docsPane(vendor, docs) {
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  const rows = VENDOR_DOC_TYPES.map((t) => {
    const d = byType.get(t.value);
    if (!d) {
      return `<tr><td class="ep-cell" style="font-weight:600">${t.label}${t.mandatory ? "" : ' <span class="ep-sub">(optional)</span>'}</td>
        <td class="ep-cell ep-sub" colspan="2">Not uploaded</td><td class="ep-cell">${tag("Missing", t.mandatory ? "att" : "")}</td><td class="ep-cell"></td></tr>`;
    }
    const viewed = reviewedDocIds.has(d.id);
    const off = viewed ? "" : "disabled";
    return `<tr>
      <td class="ep-cell" style="font-weight:600">${t.label}</td>
      <td class="ep-cell ep-mono" style="font-size:12px">${esc(d.original_filename)}<div class="ep-sub">${(d.size_bytes / 1024).toFixed(0)} KB · <a href="#" data-view-doc="${d.id}">View</a></div></td>
      <td class="ep-cell" style="font-size:12.5px">${fmtDate(d.uploaded_at)}</td>
      <td class="ep-cell">${stateTag(d.status)}${d.status === "rejected" && d.rejection_reason ? `<div class="ep-sub" style="color:#ae1800">${esc(d.rejection_reason)}</div>` : ""}</td>
      <td class="ep-cell" style="text-align:right;white-space:nowrap">
        ${d.status !== "verified" ? `<button class="ep-b" data-v="p" data-doc="${d.id}" data-act="verify" ${off}>Verify</button> ` : ""}
        <button class="ep-b" data-doc="${d.id}" data-act="reject" ${off}>Reject</button>
        ${viewed ? "" : '<div class="ep-sub">View before deciding</div>'}
      </td></tr>`;
  }).join("");
  return `<div class="ep-pane">
    <div class="ep-pane-head"><span>KYC &amp; statutory documents</span></div>
    <table class="ep-table">${th("Document", "File", "Uploaded", "Verification", "")}<tbody>${rows}</tbody></table>
  </div>`;
}

function decisionBar(vendor, docs) {
  const decidable = ["pending_verification", "info_requested"].includes(vendor.status);
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  const mandatoryRejected = VENDOR_DOC_TYPES.filter((t) => t.mandatory).some((t) => byType.get(t.value)?.status === "rejected");
  const banner = mandatoryRejected
    ? `<div class="ep-note warn">A mandatory document has been rejected. Either reject this registration outright, or request the documents again with a note explaining what's needed.</div>`
    : "";
  if (!decidable) {
    return `${banner}<div class="ep-pane ep-pane-pad hint">This registration is ${esc(vendor.status.replace("_", " "))}; no decision is pending.</div>`;
  }
  return `${banner}<div class="ep-pane" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
    <div style="flex:1;font-size:12.5px;color:rgba(32,30,29,.68);line-height:1.45">Every mandatory document must be Verified before approval. Approval activates the vendor and opens category mapping.</div>
    ${btn("Request info", { attrs: 'data-decision="info"' })}
    ${btn("Reject", { attrs: 'data-decision="reject"' })}
    ${mandatoryRejected ? "" : btn("Approve &amp; activate", { primary: true, attrs: 'data-decision="approve"' })}
  </div>`;
}

async function render() {
  let detail = '<div class="ep-pane ep-pane-pad hint">Select a registration to review it.</div>';
  let current = null;
  let docs = [];
  if (selectedId !== null) {
    try {
      [current, docs] = await Promise.all([api(`/vendors/${selectedId}`), api(`/vendors/${selectedId}/documents`)]);
      detail = `<div style="display:flex;flex-direction:column;gap:18px">${identityPane(current)}${docsPane(current, docs)}${decisionBar(current, docs)}</div>`;
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
