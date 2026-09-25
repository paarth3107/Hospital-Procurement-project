import { esc, kicker, inr } from "../../kit.js";

// The typed fields of a bid (spec 8.2): commercial part, technical part, and
// the few answers that depend on the line's procurement type. The server
// enforces what is mandatory; this only mirrors it (a * marks required ones).

const num = (v) => (v === "" || v == null ? null : Number(v));
const txt = (v) => (v == null ? "" : String(v));

function field(label, control, { required = false, hint = "", span = 1 } = {}) {
  return `<div class="ep-field" style="grid-column:span ${span}">${kicker(label + (required ? " *" : ""))}${control}${hint ? `<div class="hint" style="margin-top:4px">${esc(hint)}</div>` : ""}</div>`;
}

const input = (name, value, { type = "number", step = "any", min = "0", disabled = false, placeholder = "" } = {}) =>
  `<input class="input" name="${name}" type="${type}" ${type === "number" ? `step="${step}" min="${min}"` : ""} value="${esc(txt(value))}" placeholder="${esc(placeholder)}" ${disabled ? "disabled" : ""}>`;
const area = (name, value, disabled, rows = 4) => `<textarea class="input" name="${name}" rows="${rows}" ${disabled ? "disabled" : ""} style="width:100%;resize:vertical">${esc(txt(value))}</textarea>`;
const check = (name, label, on, disabled) => `<label class="ep-check"><input type="checkbox" name="${name}" ${on ? "checked" : ""} ${disabled ? "disabled" : ""}> ${esc(label)}</label>`;

export function commercialHtml(ctx, bid, req, locked) {
  const need = (f) => req.required_fields.includes(f);
  return `<div class="ep-form-grid" style="grid-template-columns:repeat(3,1fr)">
    ${field("Unit price (₹)", input("unit_price", bid?.unit_price, { disabled: locked }), { required: need("unit_price") })}
    ${field("GST (%)", input("gst_percent", bid?.gst_percent, { disabled: locked }), { required: need("gst_percent") })}
    ${field("Other duties / levies (₹ per unit)", input("other_duties", bid?.other_duties, { disabled: locked }), { hint: "Anything on top of GST, per unit." })}
    ${field("Delivery lead time (days)", input("delivery_lead_days", bid?.delivery_lead_days, { step: "1", disabled: locked }), { required: need("delivery_lead_days") })}
    ${field("Validity of quote (days)", input("quote_validity_days", bid?.quote_validity_days, { step: "1", min: "1", disabled: locked }), { required: need("quote_validity_days") })}
    ${field("Payment terms offered", input("payment_terms", bid?.payment_terms, { type: "text", disabled: locked, placeholder: "e.g. 30 days from delivery" }))}
  </div>
  <div id="bid-totals" style="margin-top:14px;display:flex;gap:26px;flex-wrap:wrap"></div>`;
}

export function technicalHtml(ctx, bid, req, locked) {
  const d = bid?.details || {};
  const need = (f) => req.required_fields.includes(f);
  const t = ctx.procurement_type;
  const typeFields =
    t === "item"
      ? [
          field("Brand / make offered", input("brand_offered", bid?.brand_offered, { type: "text", disabled: locked })),
          field("Shelf life remaining at delivery (months)", input("details.shelf_life_months", d.shelf_life_months, { disabled: locked }), {
            required: need("details.shelf_life_months"),
            hint: ctx.shelf_life_tracked ? "This item is tracked for batch and expiry." : "",
          }),
        ]
      : t === "asset"
      ? [
          field("Brand / model offered", input("brand_offered", bid?.brand_offered, { type: "text", disabled: locked })),
          field("Warranty (months)", input("details.warranty_months", d.warranty_months, { disabled: locked }), { required: need("details.warranty_months") }),
          field("Spare-parts / service commitment (years)", input("details.spares_commitment_years", d.spares_commitment_years, { disabled: locked })),
          `<div class="ep-field" style="display:flex;flex-direction:column;gap:8px;justify-content:flex-end">${check("details.installation_included", "Installation & commissioning included", d.installation_included, locked)}${check("details.training_included", "User / biomedical training included", d.training_included, locked)}${check("details.bidding_as_distributor", "I am bidding as a distributor (manufacturer authorization letter required)", d.bidding_as_distributor, locked)}</div>`,
        ]
      : [
          field("Proposed scope of work / method statement", area("details.sow_response", d.sow_response, locked), { required: need("details.sow_response"), span: 3 }),
          field("Manpower deployment plan", area("details.manpower_plan", d.manpower_plan, locked, 3), { span: 3 }),
          field("SLA commitment", area("details.sla_commitment", d.sla_commitment, locked, 3), { span: 3 }),
        ];
  return `<div class="ep-form-grid" style="grid-template-columns:repeat(3,1fr)">
    ${typeFields.join("")}
    ${field(
      "Technical compliance statement",
      area("technical_compliance", bid?.technical_compliance, locked),
      { required: need("technical_compliance"), span: 3, hint: req.compliance_required ? "Required for this line (RFP or technically scored). Attach the supporting document below." : "Optional for this line." }
    )}
  </div>`;
}

// Reads the whole form back into the API's shape.
export function readBid(form) {
  const v = (n) => form.elements[n]?.value ?? "";
  const on = (n) => (form.elements[n] ? form.elements[n].checked : undefined);
  const details = {};
  const put = (k, val) => val !== null && val !== undefined && val !== "" && (details[k] = val);
  const type = form.dataset.type;
  if (type === "item") put("shelf_life_months", num(v("details.shelf_life_months")));
  if (type === "asset") {
    put("warranty_months", num(v("details.warranty_months")));
    put("spares_commitment_years", num(v("details.spares_commitment_years")));
    for (const k of ["installation_included", "training_included", "bidding_as_distributor"]) if (on(`details.${k}`)) details[k] = true;
  }
  if (type === "service") for (const k of ["sow_response", "manpower_plan", "sla_commitment"]) put(k, v(`details.${k}`).trim());
  return {
    unit_price: num(v("unit_price")),
    gst_percent: num(v("gst_percent")),
    other_duties: num(v("other_duties")),
    delivery_lead_days: num(v("delivery_lead_days")),
    quote_validity_days: num(v("quote_validity_days")),
    payment_terms: v("payment_terms").trim() || null,
    technical_compliance: v("technical_compliance").trim() || null,
    brand_offered: form.elements["brand_offered"] ? v("brand_offered").trim() || null : null,
    details,
  };
}

// Live total / landed price beside the form (the vendor's own numbers only).
export function wireTotals(form, qty) {
  const box = form.querySelector("#bid-totals");
  const show = () => {
    const price = num(form.elements.unit_price.value);
    const gst = num(form.elements.gst_percent.value) ?? 0;
    const duties = num(form.elements.other_duties.value) ?? 0;
    if (price == null) {
      box.innerHTML = '<span class="hint">Enter a unit price to see your totals.</span>';
      return;
    }
    const landed = price * (1 + gst / 100) + duties;
    const cell = (k, val) => `<div>${kicker(k)}<div style="font-size:18px;font-weight:800;margin-top:3px">${inr(val)}</div></div>`;
    box.innerHTML = cell(`Total for ${qty} unit(s)`, price * qty) + cell("Landed price per unit (with GST and duties)", landed) + cell("Landed total", landed * qty);
  };
  ["unit_price", "gst_percent", "other_duties"].forEach((n) => form.elements[n].addEventListener("input", show));
  show();
}
