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
    <div class="d-flex flex-wrap gap-8px-18px">${VENDOR_DOC_TYPES.map(
      (t) => `<label class="ep-check"><input type="checkbox" data-doc-req="${t.value}" ${selected.includes(t.value) ? "checked" : ""}> ${t.label}</label>`
    ).join("")}</div>
    <div class="ep-k margin-12px-0-6px">Other document (anything not listed above)</div>
    <div class="d-flex gap-8px items-center">
      <input class="input maxw-380px" data-other-input placeholder="e.g. CE marking certificate for the implant">
      <button type="button" class="ep-b" data-other-add>+ Add</button>
    </div>
    <div data-other-chips class="d-flex flex-wrap gap-6px mt-8px">${others.map(chip).join("")}</div>
  </div>`;
}

const chip = (text) =>
  `<span class="ep-tag d-inline-flex gap-6px items-center tt-none ls-0 fs-12px" data-other="${esc(text)}">${esc(text)} <button type="button" data-other-remove class="border-0 bg-none cursor-pointer fw-800">×</button></span>`;

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
