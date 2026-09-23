import { api } from "../api.js";
import { showResult } from "../ui.js";
import { switchView } from "../nav.js";

// ---- Vendor registration ----
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("register-result");
  try {
    const vendor = await api("/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    let secondsLeft = 5;
    const baseMessage = `Registered as Vendor #${vendor.id}. Taking you back to the login page in`;
    showResult(resultEl, `${baseMessage} ${secondsLeft}... please log in with the GSTIN and password you just set, then upload your required documents.`, true);
    const countdown = setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        clearInterval(countdown);
        switchView("landing");
        return;
      }
      showResult(resultEl, `${baseMessage} ${secondsLeft}... please log in with the GSTIN and password you just set, then upload your required documents.`, true);
    }, 1000);
  } catch (err) {
    showResult(resultEl, "Could not register: " + err.message, false);
  }
});
