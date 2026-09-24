import { VENDOR_DOC_TYPES, acceptFor } from "../../constants.js";

// The document drop zones on the registration form. Holds the files the
// vendor has picked so far, keyed by doc type; the form module reads them at
// submit time.
const chosenFiles = new Map();

export const getChosenFiles = () => chosenFiles;

export function clearInvalid(el) {
  el.classList.remove("invalid");
}

export function renderRegisterDropzones() {
  const container = document.getElementById("register-doc-zones");
  const card = (t) => `<div class="ep-pane" style="padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13.5px;font-weight:800">${t.label}</span>
        <span class="ep-tag"${t.mandatory ? ' data-t="att"' : ""}>${t.mandatory ? "Required" : "Optional"}</span></div>
      <div class="dropzone" data-doc-type="${t.value}"><span class="dz-text">Drop a file here, or click to browse</span>
        <input type="file" accept="${acceptFor(t)}"></div>
      <div class="ep-field" style="margin-top:8px"><div class="ep-k">Valid till (only if this document expires)</div>
        <input class="input" type="date" data-valid-till="${t.value}" style="max-width:220px"></div></div>`;
  const group = (title, types) =>
    `<div style="display:flex;flex-direction:column;gap:12px"><div class="ep-k">${title}</div>${types.map(card).join("")}</div>`;
  container.innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    ${group("Required documents", VENDOR_DOC_TYPES.filter((t) => t.mandatory))}
    ${group("Statutory & compliance — upload those that apply to you", VENDOR_DOC_TYPES.filter((t) => !t.mandatory))}
  </div>`;

  container.querySelectorAll(".dropzone").forEach((zone) => {
    const input = zone.querySelector("input[type=file]");
    const setFile = (file) => {
      if (!file) return;
      chosenFiles.set(zone.dataset.docType, file);
      zone.classList.add("has-file");
      zone.querySelector(".dz-text").textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB) — click or drop to replace`;
      clearInvalid(zone);
    };
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => setFile(input.files[0]));
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      setFile(e.dataTransfer.files[0]);
    });
  });
}

// Marks any mandatory document zone that has no file yet; returns the first one.
export function highlightMissingDocuments(form) {
  let first = null;
  form.querySelectorAll(".dropzone").forEach((zone) => {
    const t = VENDOR_DOC_TYPES.find((d) => d.value === zone.dataset.docType);
    const bad = t.mandatory && !chosenFiles.has(t.value);
    zone.classList.toggle("invalid", bad);
    if (bad && !first) first = zone;
  });
  return first;
}
