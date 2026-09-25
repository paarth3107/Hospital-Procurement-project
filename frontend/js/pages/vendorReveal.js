import { api } from "../api.js";
import { esc, kicker } from "../kit.js";

// Reveal one masked vendor identifier (GSTIN, PAN, bank account...). The
// server only returns the real value after the staff member re-enters their
// own password. Resolves to the value, or null if cancelled.
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

export function askRevealPassword(vendorId, field, label) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.hidden = true;
      box.innerHTML = "";
      resolve(value);
    };
    box.innerHTML = `
      <div class="dlg-head"><div style="flex:1">${kicker("Protected detail")}<h4>Show ${esc(label)}</h4></div></div>
      <form id="reveal-form" class="ep-form" style="padding:16px 18px;background:transparent;border:0">
        <div class="hint">This is personal / financial information. Enter your own password to view it.</div>
        <div class="ep-field">${kicker("Your password")}<input class="input" name="password" type="password" autocomplete="current-password" required></div>
        <div id="reveal-result" class="result"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="ep-b" id="reveal-cancel">Cancel</button><button class="ep-b" data-v="p">Show</button></div>
      </form>`;
    overlay.hidden = false;
    const form = box.querySelector("#reveal-form");
    form.password.focus();
    box.querySelector("#reveal-cancel").addEventListener("click", () => close(null));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await api(`/vendors/${vendorId}/reveal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, password: form.password.value }) });
        close(res.value ?? "—");
      } catch (err) {
        const out = box.querySelector("#reveal-result");
        out.className = "result err";
        out.textContent = err.message;
        form.password.value = "";
      }
    });
  });
}
