import { api } from "../../api.js";
import { showResult } from "../../ui.js";
import { switchView } from "../../nav.js";
import { clearInvalid, getChosenFiles, highlightMissingDocuments, renderRegisterDropzones } from "./registerDocuments.js";

// ---- Vendor registration form ----
// Submitting sends the details AND the mandatory documents together; the
// backend refuses a registration without them, this just highlights what's
// missing (after a submit attempt) instead of listing it.
const form = document.getElementById("register-form");

function validate() {
  let firstBad = null;
  form.querySelectorAll("input:not([type=file]), select, textarea").forEach((input) => {
    const bad = !input.checkValidity();
    input.classList.toggle("invalid", bad);
    if (bad && !firstBad) firstBad = input;
  });
  const missingDoc = highlightMissingDocuments(form);
  firstBad = firstBad || missingDoc;
  if (firstBad) firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
  return !firstBad;
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validate()) return;
  const formData = new FormData(form);
  for (const [docType, file] of getChosenFiles()) formData.append(docType, file);
  form.querySelectorAll("[data-valid-till]").forEach((el) => {
    if (el.value) formData.append(`valid_till_${el.dataset.validTill}`, el.value);
  });
  const resultEl = document.getElementById("register-result");
  try {
    // multipart: fetch sets the boundary itself
    const vendor = await api("/vendors", { method: "POST", body: formData });
    form.reset();
    getChosenFiles().clear();
    renderRegisterDropzones();
    startReturnCountdown(resultEl, vendor.id);
  } catch (err) {
    showResult(resultEl, "Could not register: " + err.message, false);
  }
});
