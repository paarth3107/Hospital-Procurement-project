import { api } from "../../api.js";
import { esc, kicker, tag, th, inr } from "../../kit.js";

// The commercial comparison statement for one line (Procurement Officer):
// technically qualified bids ranked by landed price (L1, L2...) or by combined
// score on QCBS lines (C1, C2...). Disqualified bids appear without prices.
// Opening this is logged server-side as price access.
const dash = (v, fmt = (x) => x) => (v == null ? "—" : fmt(v));

function rankCell(r) {
  if (r.rank == null) return tag("Disqualified", "neg");
  return `<span style="font-size:18px;font-weight:800">${esc(r.rank_label)}</span>${r.recommended ? `<div>${tag("Recommended", "pos")}</div>` : ""}`;
}

function row(r, qcbs) {
  const off = r.rank == null;
  return `<tr>
    <td class="ep-cell">${rankCell(r)}</td>
    <td class="ep-cell"><div style="font-weight:600">${esc(r.vendor_name)}</div><div class="ep-sub">rating ${r.rating}</div>${r.tie_note ? `<div class="ep-sub" style="max-width:220px;color:#ae1800">${esc(r.tie_note)}</div>` : ""}</td>
    <td class="ep-cell" style="font-size:12.5px">${off ? esc(r.technical_reason || "") : `${r.technical_score != null ? `score <b>${r.technical_score}</b> / 10${r.t_rank ? ` · T${r.t_rank}` : ""}` : "qualified"}`}</td>
    <td class="ep-cell">${off ? '<span class="ep-sub">Price not opened</span>' : `<div style="font-weight:700">${inr(r.unit_price)}</div><div class="ep-sub">+${r.gst_percent ?? 0}% GST${r.other_duties ? ` + ${inr(r.other_duties)}` : ""}</div>`}</td>
    <td class="ep-cell">${off ? "" : `<div style="font-weight:700">${inr(r.landed_unit_price)}</div><div class="ep-sub">total ${inr(r.landed_total)}</div>`}</td>
    ${qcbs ? `<td class="ep-cell" style="font-size:12.5px">${off ? "" : `price ${dash(r.price_score)}<div class="ep-sub">combined <b>${dash(r.combined_score)}</b></div>`}</td>` : ""}
    <td class="ep-cell" style="font-size:12.5px">${off ? "" : `${dash(r.delivery_lead_days, (d) => d + " days")}<div class="ep-sub">valid ${dash(r.quote_validity_days, (d) => d + " days")}</div>${r.payment_terms ? `<div class="ep-sub">${esc(r.payment_terms)}</div>` : ""}`}</td>
    <td class="ep-cell" style="font-size:12.5px">${off ? "" : `${r.variance_pct != null ? `${r.variance_pct > 0 ? "+" : ""}${r.variance_pct}% vs estimate` : ""}${r.price_flags.map((f) => `<div style="color:#ae1800">${esc(f)}</div>`).join("")}`}</td>
  </tr>`;
}

export async function renderCommercial(container, lineId, resultEl) {
  container.innerHTML = '<div class="ep-pane ep-pane-pad hint">Opening prices…</div>';
  try {
    const s = await api(`/evaluation/lines/${lineId}/commercial`);
    const qcbs = s.method === "QCBS";
    container.innerHTML = `<div class="ep-pane">
      <div class="ep-pane-head"><span>Commercial comparison · ${qcbs ? `QCBS (technical ${s.technical_weight} / price ${s.price_weight})` : "lowest landed price (L1)"}</span><span class="ep-k">prices opened · access is logged</span></div>
      <div style="padding:10px 16px" class="hint">Only technically qualified bids are ranked. Landed price = unit price + GST + duties.${qcbs ? " On QCBS lines the lowest bid scores 100 on price and the rest are scored against it." : ""}${s.estimated_price != null ? ` Internal estimate: ${inr(s.estimated_price)} per unit (never shown to vendors).` : ""}</div>
      <table class="ep-table">${th("Rank", "Vendor", "Technical", "Quoted price", "Landed price", ...(qcbs ? ["QCBS"] : []), "Delivery / terms", "Checks")}<tbody>${s.rows.map((r) => row(r, qcbs)).join("")}</tbody></table>
      <div style="padding:10px 16px" class="ep-sub">Confirming the recommendation (L1 confirmation) and any split-award proposal come next; this statement does not award anything.</div>
    </div>`;
  } catch (err) {
    container.innerHTML = "";
    resultEl.className = "result err";
    resultEl.textContent = "Could not open prices: " + err.message;
  }
}
