import { esc } from "./kit.js";

export function showResult(el, message, ok) {
  el.textContent = message;
  el.className = "result " + (ok ? "ok" : "err");
}

// The sidebar identity block: name over role/label. `verified` (Active,
// approved vendor) adds a small blue tick next to the name.
export function setWhoami(name, role, verified = false) {
  const el = document.getElementById("whoami");
  el.innerHTML = name ? `<div class="who-name"></div><div class="who-role"></div>` : "";
  if (name) {
    el.querySelector(".who-name").innerHTML = `${esc(name)}${verified ? ' <span class="verified-tick" title="Active, approved vendor">✓</span>' : ""}`;
    el.querySelector(".who-role").textContent = role;
  }
}
