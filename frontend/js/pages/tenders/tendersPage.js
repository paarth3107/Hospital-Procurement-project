import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { esc, stateTag, th, emptyRow, fmtDateTime, typeTag } from "../../kit.js";
import { initTenderForm, openTenderForm, closeTenderForm, isFormOpen } from "./tenderForm.js";

// ---- Tenders: the list, with "+ New tender" and Manage opening the editor
// form (tenderForm.js) below it. ----
const root = () => document.getElementById("tender-list-root");
const resultEl = () => document.getElementById("tender-result");

const TYPE_LABEL = { rfq: "RFQ", rfp: "RFP", rate_contract: "Rate contract" };

export async function loadTenders() {
  try {
    const tenders = await api("/tenders");
    root().innerHTML = `<div class="ep-pane">
      <div class="ep-pane-head"><span>Tenders</span>
        <button class="ep-b" data-v="p" id="add-tender-btn">+ New tender</button></div>
      <table class="ep-table">${th("ID", "Title", "Type", "Status", "Bids close", "Round", "")}<tbody>${
        tenders.length
          ? tenders
              .map(
                (t) => `<tr>
                  <td class="ep-cell ep-mono" style="font-size:12px">#${t.id}</td>
                  <td class="ep-cell"><div style="font-weight:600">${esc(t.title)}</div><div class="ep-sub">${esc(t.department || "")}</div></td>
                  <td class="ep-cell">${esc(TYPE_LABEL[t.tender_type] || t.tender_type)}</td>
                  <td class="ep-cell">${stateTag(t.status)}</td>
                  <td class="ep-cell" style="font-size:12.5px">${fmtDateTime(t.bid_due_date)}</td>
                  <td class="ep-cell">${t.round_number}</td>
                  <td class="ep-cell" style="text-align:right"><button class="ep-b" data-manage="${t.id}">Manage</button></td>
                </tr>`
              )
              .join("")
          : emptyRow(7, "No tenders yet.")
      }</tbody></table>
    </div>`;
    root().querySelector("#add-tender-btn").addEventListener("click", () => (isFormOpen() ? closeTenderForm() : openTenderForm(null)));
    root().querySelectorAll("[data-manage]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          openTenderForm(await api(`/tenders/${b.dataset.manage}`));
        } catch (err) {
          showResult(resultEl(), "Could not load tender: " + err.message, false);
        }
      })
    );
  } catch (err) {
    showResult(resultEl(), "Could not load tenders: " + err.message, false);
  }
}

initTenderForm({ onTendersChanged: loadTenders });
