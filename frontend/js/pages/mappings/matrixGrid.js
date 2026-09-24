import { esc } from "../../kit.js";

// Draws the prototype's eligibility matrix: a table with a Vendor column and
// one column per category/item, each cell a full-size button reading MAPPED /
// PENDING / SUSPENDED / REJECTED / a dash. Knows nothing about categories vs
// items: the caller supplies the columns, each cell's state, and the click.
//
// columns: [{ key, label, sub }]
// getCell: (vendor, column) => { state }   state: approved | pending | rejected | suspended | none
// onClick: (vendor, column) => void
const LABEL = { approved: "MAPPED", pending: "PENDING", suspended: "SUSPENDED", rejected: "REJECTED", none: "—" };

export function renderMatrixGrid(container, { vendors, columns, getCell, onClick, legend }) {
  container.innerHTML = `<table class="ep-table">
    <thead><tr>
      <th class="ep-th" style="min-width:230px">Vendor</th>
      ${columns
        .map(
          (c) => `<th class="ep-th" style="text-align:center"><div>${esc(c.label)}</div>
            <div style="font-weight:400;letter-spacing:0;text-transform:none;font-size:10.5px;color:rgba(32,30,29,.5)">${esc(c.sub || "")}</div></th>`
        )
        .join("")}
    </tr></thead>
    <tbody>${vendors
      .map(
        (v) => `<tr>
          <td class="ep-cell"><div style="font-weight:600">${esc(v.legal_name)}</div>
            <div style="font-size:11px;color:rgba(32,30,29,.55)">V-${v.id} · ${esc(v.status.replace("_", " "))}</div></td>
          ${columns
            .map((c) => {
              const cell = getCell(v, c);
              return `<td class="ep-cell" style="text-align:center;padding:4px"><button class="matrix-btn" data-s="${cell.state}" data-vendor="${v.id}" data-col="${esc(c.key)}">${LABEL[cell.state]}</button></td>`;
            })
            .join("")}
        </tr>`
      )
      .join("")}</tbody>
  </table>
  <div style="display:flex;gap:22px;flex-wrap:wrap;padding:10px 14px;font-size:11.5px;color:rgba(32,30,29,.62);border-top:1px solid rgba(32,30,29,.18)">${legend}</div>`;

  container.querySelectorAll(".matrix-btn").forEach((el) =>
    el.addEventListener("click", () => {
      const vendor = vendors.find((v) => v.id === Number(el.dataset.vendor));
      const column = columns.find((c) => String(c.key) === el.dataset.col);
      onClick(vendor, column);
    })
  );
}
