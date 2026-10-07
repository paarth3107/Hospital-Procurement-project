import { api } from "../../api.js";
import { kicker } from "../../kit.js";

// Add a facility (System Admin, spec §2.3: multi-facility/entity setup).
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

const close = () => {
  overlay.hidden = true;
  box.innerHTML = "";
};

export function openFacilityForm(onSaved) {
  box.innerHTML = `
    <div class="dlg-head"><div class="flex-1">${kicker("Facility")}<h4>Add Facility</h4></div></div>
    <form id="facility-form" class="ep-form padding-16px-18px bg-transparent border-0">
      <div class="ep-field">${kicker("Facility name")}<input class="input" name="name" required></div>
      <div class="ep-field">${kicker("Legal entity code")}<input class="input" name="legal_entity_code" required></div>
      <div id="facility-dialog-result" class="result"></div>
      <div class="d-flex justify-end gap-10px"><button type="button" class="ep-b" id="facility-cancel">Cancel</button><button class="ep-b" data-v="p">Create facility</button></div>
    </form>`;
  overlay.hidden = false;

  const form = box.querySelector("#facility-form");
  box.querySelector("#facility-cancel").addEventListener("click", close);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const facility = await api("/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.value, legal_entity_code: form.legal_entity_code.value }),
      });
      close();
      onSaved(facility);
    } catch (err) {
      const out = box.querySelector("#facility-dialog-result");
      out.className = "result err";
      out.textContent = err.message;
    }
  });
}
