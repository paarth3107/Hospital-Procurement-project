import { api } from "../api.js";
import { state } from "../state.js";
import { showResult } from "../ui.js";
import { modalPrompt } from "../modal.js";
import { switchView } from "../nav.js";
import { MAPPING_STATE_PRIORITY } from "../constants.js";

// Reflects the actual outcome of the vendor's category requests instead of
// a generic "go pick some" prompt once there's something to report --
// disappears back to a plain prompt only when there's truly nothing yet.
async function renderVendorCategoriesNotice(vendor) {
  const notice = document.getElementById("vendor-categories-notice");
  if (vendor.status !== "active") {
    notice.hidden = true;
    return;
  }

  let mappings, products;
  try {
    [mappings, products] = await Promise.all([api("/vendor-portal/mappings"), api("/products?active=true")]);
  } catch (err) {
    notice.hidden = true;
    return;
  }

  // Aggregate by category, same as the Categories tab itself -- counting
  // raw mapping rows would double-count a category with multiple products.
  const productsByCategory = new Map();
  for (const p of products) {
    if (!productsByCategory.has(p.category)) productsByCategory.set(p.category, []);
    productsByCategory.get(p.category).push(p.id);
  }
  const mappingByProduct = new Map(mappings.map((m) => [m.product_master_id, m]));
  const counts = { approved: 0, pending: 0, rejected: 0, suspended: 0 };
  let totalCategoriesWithStatus = 0;
  for (const [, productIds] of productsByCategory) {
    let categoryState = null;
    for (const pid of productIds) {
      const m = mappingByProduct.get(pid);
      if (!m) continue;
      if (categoryState === null || MAPPING_STATE_PRIORITY.indexOf(m.state) < MAPPING_STATE_PRIORITY.indexOf(categoryState)) {
        categoryState = m.state;
      }
    }
    if (categoryState) {
      counts[categoryState]++;
      totalCategoriesWithStatus++;
    }
  }

  let message;
  if (totalCategoriesWithStatus === 0) {
    message = "Pick which catalog categories you can supply to become eligible for tenders in them.";
  } else {
    const parts = [];
    if (counts.approved) parts.push(`${counts.approved} approved`);
    if (counts.rejected) parts.push(`${counts.rejected} rejected`);
    if (counts.pending) parts.push(`${counts.pending} pending review`);
    if (counts.suspended) parts.push(`${counts.suspended} suspended`);
    message = `Your category request(s): ${parts.join(", ")}.`;
  }

  notice.hidden = false;
  notice.innerHTML = `<span>${message}</span>`;
  const goBtn = document.createElement("button");
  goBtn.textContent = "Go to Categories";
  goBtn.addEventListener("click", () => switchView("vendor-categories"));
  notice.appendChild(goBtn);
}

export async function loadVendorDashboard() {
  const profileEl = document.getElementById("vendor-profile-card");
  const resultEl = document.getElementById("vendor-dashboard-result");
  try {
    const vendor = await api("/vendor-auth/me");
    state.vendor = vendor;
    profileEl.innerHTML = `
      <p><b>${vendor.legal_name}</b> (#${vendor.id}) —
        <span class="status-pill status-${vendor.status}">${vendor.status.replace("_", " ")}</span>
        ${vendor.rejection_reason ? `<br><span style="color:#a33;">Reason: ${vendor.rejection_reason}</span>` : ""}
      </p>`;

    await renderVendorCategoriesNotice(vendor);

    const [openTenders, bids] = await Promise.all([api("/vendor-portal/tenders"), api("/vendor-portal/bids")]);

    const openBody = document.querySelector("#vendor-open-tenders-table tbody");
    openBody.innerHTML = "";
    let rowCount = 0;
    for (const t of openTenders) {
      for (const li of t.line_items) {
        rowCount++;
        const tr = document.createElement("tr");
        const dueStr = t.bid_due_date ? new Date(t.bid_due_date).toLocaleString() : "—";
        let actionCell;
        if (li.already_bid) {
          actionCell = `<span class="status-pill status-active">Bid ${li.bid_status}</span>`;
        } else if (t.can_bid) {
          actionCell = `<button class="approve" data-line-item-id="${li.line_item_id}" data-title="${t.title}" data-product="${li.product_name}">Submit Bid</button>`;
        } else {
          actionCell = `<span style="color:#888;">Deadline passed</span>`;
        }
        tr.innerHTML = `
          <td>${t.title}</td>
          <td>${t.tender_type}</td>
          <td>${li.product_name}</td>
          <td>${li.qty}</td>
          <td>${dueStr}</td>
          <td class="row-actions">${actionCell}</td>`;
        openBody.appendChild(tr);
      }
    }
    if (rowCount === 0) {
      openBody.innerHTML = '<tr><td colspan="6" style="color:#888;">No open tenders you\'re currently invited to.</td></tr>';
    }

    const bidsBody = document.querySelector("#vendor-bids-table tbody");
    bidsBody.innerHTML = bids.length ? "" : '<tr><td colspan="6" style="color:#888;">No bids submitted yet.</td></tr>';
    for (const b of bids) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${b.tender_title}</td>
        <td>${b.product_name}</td>
        <td>${b.qty}</td>
        <td>${b.unit_price}</td>
        <td><span class="status-pill status-active">${b.status}</span></td>
        <td>${new Date(b.submitted_at).toLocaleString()}</td>`;
      bidsBody.appendChild(tr);
    }
    resultEl.textContent = "";
  } catch (err) {
    showResult(resultEl, "Could not load dashboard: " + err.message, false);
  }
}

document.querySelector("#vendor-open-tenders-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-line-item-id]");
  if (!btn) return;
  const resultEl = document.getElementById("vendor-dashboard-result");
  const priceStr = await modalPrompt(`Your unit price for "${btn.dataset.product}" (${btn.dataset.title}):`);
  if (!priceStr) return;
  const unitPrice = Number(priceStr);
  if (!(unitPrice > 0)) {
    showResult(resultEl, "Price must be a positive number.", false);
    return;
  }
  try {
    await api("/vendor-portal/bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tender_line_item_id: Number(btn.dataset.lineItemId), unit_price: unitPrice }),
    });
    showResult(resultEl, "Bid submitted.", true);
    loadVendorDashboard();
  } catch (err) {
    showResult(resultEl, "Could not submit bid: " + err.message, false);
  }
});
