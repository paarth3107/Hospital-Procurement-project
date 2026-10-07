import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { switchView } from "../../nav.js";
import { esc } from "../../kit.js";
import { CITIES_BY_STATE, INDIAN_STATES, OTHER_CITY } from "../../constants.js";
import { clearInvalid, getChosenFiles, highlightMissingDocuments, renderRegisterDropzones } from "./registerDocuments.js";
import { addOtherDocRow, appendOtherDocsToFormData, resetOtherDocs } from "./registerOtherDocs.js";

// ---- Vendor registration form, in two steps: basic info, then documents.
// Nothing is sent to the server until Step 2's final submit -- Continue on
// Step 1 only validates and advances, it never calls the API. ----
const form = document.getElementById("register-form");
const step1 = document.getElementById("register-step-1");
const step2 = document.getElementById("register-step-2");
const step1Tab = document.getElementById("register-step-1-tab");
const step2Tab = document.getElementById("register-step-2-tab");
const submitBtn = document.getElementById("register-submit-btn");
const stateSelect = document.getElementById("register-state");
const citySelect = document.getElementById("register-city");
const cityOtherField = document.getElementById("register-city-other-field");
const cityOtherInput = document.getElementById("register-city-other");

// State -> City is a real cascade (city options depend on the chosen state);
// "Other" always stays available since the city list is a convenience, not
// an exhaustive gazetteer -- typing one in must never block registration.
stateSelect.innerHTML += INDIAN_STATES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");

function syncCityOptions() {
  const cities = CITIES_BY_STATE[stateSelect.value] || [];
  citySelect.innerHTML =
    `<option value="">— select —</option>` + cities.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="${OTHER_CITY}">Other (type it in)</option>`;
  citySelect.disabled = !stateSelect.value;
  syncCityOtherField();
}

function syncCityOtherField() {
  const isOther = citySelect.value === OTHER_CITY;
  cityOtherField.hidden = !isOther;
  cityOtherInput.required = isOther;
  if (!isOther) cityOtherInput.value = "";
}

stateSelect.addEventListener("change", syncCityOptions);
citySelect.addEventListener("change", syncCityOtherField);
syncCityOptions();

function validateStep1() {
  let firstBad = null;
  step1.querySelectorAll("input:not([type=file]), select, textarea").forEach((input) => {
    const bad = !input.checkValidity();
    input.classList.toggle("invalid", bad);
    if (bad && !firstBad) firstBad = input;
  });
  if (firstBad) firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
  return !firstBad;
}

function validateStep2() {
  const missingDoc = highlightMissingDocuments(form);
  if (missingDoc) missingDoc.scrollIntoView({ block: "center", behavior: "smooth" });
  return !missingDoc;
}

function goToStep(n) {
  step1.hidden = n !== 1;
  step2.hidden = n !== 2;
  step1Tab.classList.toggle("on", n === 1);
  step2Tab.classList.toggle("on", n === 2);
  submitBtn.disabled = n !== 2;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startReturnCountdown(resultEl, vendorId) {
  let secondsLeft = 5;
  const message = () =>
    `Registered as Vendor #${vendorId}. Taking you back to the login page in ${secondsLeft}... please log in with your email and the password you just set.`;
  showResult(resultEl, message(), true);
  const countdown = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(countdown);
      switchView("landing");
      return;
    }
    showResult(resultEl, message(), true);
  }, 1000);
}

renderRegisterDropzones();
form.addEventListener("input", (e) => clearInvalid(e.target));

document.getElementById("register-continue-btn").addEventListener("click", () => {
  if (validateStep1()) goToStep(2);
});
document.getElementById("register-back-btn").addEventListener("click", () => goToStep(1));
document.getElementById("register-add-other-doc-btn").addEventListener("click", () => addOtherDocRow());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateStep2()) return;
  const formData = new FormData(form);
  if (formData.get("city") === OTHER_CITY) formData.set("city", formData.get("city_other"));
  formData.delete("city_other");
  for (const [docType, file] of getChosenFiles()) formData.append(docType, file);
  form.querySelectorAll("[data-valid-till]").forEach((el) => {
    if (el.value) formData.append(`valid_till_${el.dataset.validTill}`, el.value);
  });
  appendOtherDocsToFormData(formData);
  const openLinkToken = sessionStorage.getItem("openLinkToken");
  if (openLinkToken) formData.append("open_link_token", openLinkToken);
  const resultEl = document.getElementById("register-result");
  try {
    // multipart: fetch sets the boundary itself
    const vendor = await api("/vendors", { method: "POST", body: formData });
    sessionStorage.removeItem("openLinkToken");
    document.getElementById("open-link-banner").hidden = true;
    form.reset();
    syncCityOptions();
    getChosenFiles().clear();
    renderRegisterDropzones();
    resetOtherDocs();
    goToStep(1);
    startReturnCountdown(resultEl, vendor.id);
  } catch (err) {
    showResult(resultEl, "Could not register: " + err.message, false);
  }
});
