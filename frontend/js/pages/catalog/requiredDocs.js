import { VENDOR_DOC_TYPES } from "../../constants.js";
import { esc } from "../../kit.js";

// "Documents required from a vendor to be mapped" picker, shared by the
// product forms (core details) and the category form: tick standard document
// types, and/or type an "Other" document by name. The vendor uploads a file
// for each; the human reviewer reads the name and verifies it.
const OTHER = "other:";

export function requiredDocsHtml(selected = []) {
  const others = selected.filter((s) => s.startsWith(OTHER)).map((s) => s.slice(OTHER.length));
  return `<div class="required-docs">
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px">${VENDOR_DOC_TYPES.map(
      (t) => `<label class="ep-check"><input type="checkbox" data-doc-req="${t.value}" ${selected.includes(t.value) ? "checked" : ""}> ${t.label}</label>`
    ).join("")}</div>
    <div class="ep-k" style="margin:12px 0 6px">Other document (anything not listed above)</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input class="input" data-other-input placeholder="e.g. CE marking certificate for the implant" style="max-width:380px">
      <button type="button" class="ep-b" data-other-add>+ Add</button>
    </div>
    <div data-other-chips style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${others.map(chip).join("")}</div>
  </div>`;
}

const chip = (text) =>
  `<span class="ep-tag" data-other="${esc(text)}" style="display:inline-flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:12px">${esc(text)} <button type="button" data-other-remove style="border:0;background:none;cursor:pointer;font-weight:800">×</button></span>`;

export function wireRequiredDocs(root) {
  const input = root.querySelector("[data-other-input]");
  const chips = root.querySelector("[data-other-chips]");
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    if (![...chips.querySelectorAll("[data-other]")].some((c) => c.dataset.other.toLowerCase() === text.toLowerCase())) {
      chips.insertAdjacentHTML("beforeend", chip(text));
    }
    input.value = "";
  };
  root.querySelector("[data-other-add]").addEventListener("click", add);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Enter adds the chip, it must not submit the whole form
      add();
    }
  });
  chips.addEventListener("click", (e) => e.target.closest("[data-other-remove]")?.closest("[data-other]").remove());
}

export function readRequiredDocs(root) {
  const standard = [...root.querySelectorAll("[data-doc-req]:checked")].map((el) => el.dataset.docReq);
  const typed = root.querySelector("[data-other-input]").value.trim(); // a name typed but not yet "+ Add"-ed still counts
  const others = [...root.querySelectorAll("[data-other]")].map((c) => OTHER + c.dataset.other);
  if (typed && !others.some((o) => o.toLowerCase() === (OTHER + typed).toLowerCase())) others.push(OTHER + typed);
  return [...standard, ...others];
}
