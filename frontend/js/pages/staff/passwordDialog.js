import { api } from "../../api.js";
import { esc, kicker } from "../../kit.js";

// Reset a staff member's password (System Admin sets a new one and shares it).
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

const close = () => {
  overlay.hidden = true;
  box.innerHTML = "";
};

export function openPasswordDialog(user, onDone) {
  box.innerHTML = `
    <div class="dlg-head"><div class="flex-1">${kicker("Reset password")}<h4>${esc(user.full_name)}</h4></div></div>
    <form id="pw-form" class="ep-form padding-16px-18px bg-transparent border-0">
      <div class="ep-field">${kicker("New password (min 8 characters)")}<input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required></div>
      <div id="pw-result" class="result"></div>
      <div class="d-flex justify-end gap-10px"><button type="button" class="ep-b" id="pw-cancel">Cancel</button><button class="ep-b" data-v="p">Set password</button></div>
    </form>`;
  overlay.hidden = false;
  box.querySelector("#pw-cancel").addEventListener("click", close);
  box.querySelector("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/staff/${user.id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: e.target.password.value }) });
      close();
      onDone(`Password reset for ${user.full_name}.`);
    } catch (err) {
      const out = box.querySelector("#pw-result");
      out.className = "result err";
      out.textContent = err.message;
    }
  });
}
