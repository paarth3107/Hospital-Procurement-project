import { esc } from "./kit.js";

// Success messages self-clear after a few seconds (they're a confirmation,
// not something to act on); an error message stays until something else
// replaces it, since the user may need time to read and act on it. Timer is
// tracked per element, not globally, so an unrelated showResult() elsewhere
// on the page can't cancel this one's dismissal.
const dismissTimers = new WeakMap();
const AUTO_DISMISS_MS = 5000;

export function showResult(el, message, ok) {
  el.textContent = message;
  el.className = "result " + (ok ? "ok" : "err");
  clearTimeout(dismissTimers.get(el));
  if (ok) {
    dismissTimers.set(
      el,
      setTimeout(() => {
        if (el.textContent === message) {
          el.textContent = "";
          el.className = "result";
        }
      }, AUTO_DISMISS_MS)
    );
  } else {
    dismissTimers.delete(el);
  }
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
