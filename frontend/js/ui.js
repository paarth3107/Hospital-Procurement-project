export function showResult(el, message, ok) {
  el.textContent = message;
  el.className = "result " + (ok ? "ok" : "err");
}
