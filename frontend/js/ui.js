export function showResult(el, message, ok) {
  el.textContent = message;
  el.className = "result " + (ok ? "ok" : "err");
}

// The sidebar identity block: name over role/label.
export function setWhoami(name, role) {
  const el = document.getElementById("whoami");
  el.innerHTML = name ? `<div class="who-name"></div><div class="who-role"></div>` : "";
  if (name) {
    el.querySelector(".who-name").textContent = name;
    el.querySelector(".who-role").textContent = role;
  }
}
