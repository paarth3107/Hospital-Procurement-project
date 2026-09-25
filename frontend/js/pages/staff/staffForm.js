import { api } from "../../api.js";
import { esc, kicker } from "../../kit.js";

// Create / edit one staff account (System Admin). Email is fixed once created;
// a password is only asked for on create (later changes go through Reset password).
const overlay = document.getElementById("app-dialog");
const box = document.getElementById("app-dialog-box");

export const ROLE_LABELS = {
  procurement_officer: "Procurement Officer",
  procurement_admin: "Procurement Admin",
  category_manager: "Category Manager",
  approving_authority: "Approving Authority",
  system_admin: "System Admin",
};

const close = () => {
  overlay.hidden = true;
  box.innerHTML = "";
};

export function openStaffForm(user, facilities, onSaved) {
  const editing = !!user;
  const opt = (value, label, selected) => `<option value="${value}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
  box.innerHTML = `
    <div class="dlg-head"><div style="flex:1">${kicker(editing ? "Edit staff account" : "New staff account")}<h4>${editing ? esc(user.full_name) : "Add hospital staff"}</h4></div></div>
    <form id="staff-form" class="ep-form" style="padding:16px 18px;background:transparent;border:0">
      <div class="ep-field">${kicker("Full name")}<input class="input" name="full_name" value="${editing ? esc(user.full_name) : ""}" required></div>
      <div class="ep-field">${kicker("Email (used to log in)")}<input class="input" name="email" type="email" value="${editing ? esc(user.email) : ""}" ${editing ? "disabled" : "required"}></div>
      ${
        editing
          ? ""
          : `<div class="ep-field">${kicker("Initial password (min 8 characters)")}<input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required>
        <div class="hint" style="margin-top:4px">Share it with the person directly; there is no email delivery yet. Use Reset password later to change it.</div></div>`
      }
      <div class="ep-field">${kicker("Role")}<select class="input" name="role">${Object.entries(ROLE_LABELS)
        .map(([v, l]) => opt(v, l, editing && user.role === v))
        .join("")}</select></div>
      <div class="ep-field" id="tier-field" hidden>${kicker("Approval tier")}<input class="input" name="approval_tier" type="number" min="1" value="${editing && user.approval_tier ? user.approval_tier : ""}">
        <div class="hint" style="margin-top:4px">Higher tiers can approve higher-value tenders (see the approval bands).</div></div>
      <div class="ep-field">${kicker("Facility")}<select class="input" name="facility_id">${opt("", "All facilities", editing && user.facility_id == null)}${facilities
        .map((f) => opt(f.id, f.name, editing && user.facility_id === f.id))
        .join("")}</select></div>
      <div id="staff-dialog-result" class="result"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px"><button type="button" class="ep-b" id="staff-cancel">Cancel</button><button class="ep-b" data-v="p">${editing ? "Save changes" : "Create account"}</button></div>
    </form>`;
  overlay.hidden = false;

  const form = box.querySelector("#staff-form");
  const syncTier = () => (form.querySelector("#tier-field").hidden = form.role.value !== "approving_authority");
  form.role.addEventListener("change", syncTier);
  syncTier();
  box.querySelector("#staff-cancel").addEventListener("click", close);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      full_name: form.full_name.value,
      role: form.role.value,
      facility_id: form.facility_id.value ? Number(form.facility_id.value) : null,
      approval_tier: form.role.value === "approving_authority" && form.approval_tier.value ? Number(form.approval_tier.value) : null,
    };
    if (!editing) {
      body.email = form.email.value;
      body.password = form.password.value;
    }
    try {
      await api(editing ? `/staff/${user.id}` : "/staff", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      close();
      onSaved(editing ? `Updated ${body.full_name}.` : `Created an account for ${body.full_name} (${body.email}).`);
    } catch (err) {
      const out = box.querySelector("#staff-dialog-result");
      out.className = "result err";
      out.textContent = err.message;
    }
  });
}
