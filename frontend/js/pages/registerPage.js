import { api } from "../api.js";
import { showResult } from "../ui.js";
import { switchView } from "../nav.js";
import { VENDOR_DOC_TYPES } from "../constants.js";

// Files picked on the form, by doc_type. Submit stays disabled until every
// mandatory one is present (backend re-enforces this regardless).
const chosenFiles = new Map();
const registerForm = document.getElementById("register-form");

// Highlights (rather than lists) whatever mandatory field/document is still
// empty, only after a submit attempt; each highlight clears as it's fixed.
function clearInvalid(el) {
  el.classList.remove("invalid");
}

function validateRegisterForm() {
  let firstBad = null;
  registerForm.querySelectorAll("input:not([type=file])").forEach((input) => {
    const bad = !input.checkValidity();
    input.classList.toggle("invalid", bad);
    if (bad && !firstBad) firstBad = input;
  });
  registerForm.querySelectorAll(".dropzone").forEach((zone) => {
    const t = VENDOR_DOC_TYPES.find((d) => d.value === zone.dataset.docType);
    const bad = t.mandatory && !chosenFiles.has(t.value);
    zone.classList.toggle("invalid", bad);
    if (bad && !firstBad) firstBad = zone;
  });
  if (firstBad) firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
  return !firstBad;
}

function renderRegisterDropzones() {
  const container = document.getElementById("register-doc-zones");
  container.innerHTML = VENDOR_DOC_TYPES.map(
    (t) => `<div class="doc-card">
      <div class="doc-card-head"><span class="doc-title">${t.label}</span>
        <span class="badge ${t.mandatory ? "badge-required" : "badge-optional"}">${t.mandatory ? "Required" : "Optional"}</span></div>
      <div class="dropzone" data-doc-type="${t.value}"><span class="dz-text">Drop a file here, or click to browse</span>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png"></div></div>`
  ).join("");
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
renderRegisterDropzones();
registerForm.addEventListener("input", (e) => clearInvalid(e.target));


// ---- Vendor registration ----
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateRegisterForm()) return;
  const form = e.target;
  const formData = new FormData(form);
  for (const [docType, file] of chosenFiles) formData.append(docType, file);
  const resultEl = document.getElementById("register-result");
  try {
    const vendor = await api("/vendors", {
      method: "POST",
      body: formData, // multipart: let fetch set the boundary
    });
    form.reset();
    chosenFiles.clear();
    renderRegisterDropzones();
    let secondsLeft = 5;
    const baseMessage = `Registered as Vendor #${vendor.id}. Taking you back to the login page in`;
    showResult(resultEl, `${baseMessage} ${secondsLeft}... please log in with the GSTIN and password you just set.`, true);
    const countdown = setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(countdown);
        switchView("landing");
        return;
      }
      showResult(resultEl, `${baseMessage} ${secondsLeft}... please log in with the GSTIN and password you just set.`, true);
    }, 1000);
  } catch (err) {
    showResult(resultEl, "Could not register: " + err.message, false);
  }
});
