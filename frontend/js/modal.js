// In-page modal (replaces native prompt()/confirm()/alert()). openModal()
// is the primitive; modalPrompt/modalConfirm/modalAlert/modalChoose below
// mirror the native functions' call shape so every call site only needed
// `await` added in front of it.
export function openModal({ title, message, type = "confirm", placeholder = "", options = [], danger = false, confirmLabel = "Confirm" }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modal-overlay");
    const body = document.getElementById("modal-body");
    const confirmBtn = document.getElementById("modal-confirm-btn");
    const cancelBtn = document.getElementById("modal-cancel-btn");

    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-message").textContent = message || "";
    body.innerHTML = "";
    cancelBtn.hidden = type === "alert";
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle("danger", danger);

    let inputEl = null;
    if (type === "text") {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.placeholder = placeholder;
      body.appendChild(inputEl);
    } else if (type === "choice") {
      inputEl = document.createElement("select");
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        inputEl.appendChild(o);
      }
      body.appendChild(inputEl);
    }

    function cleanup(result) {
      overlay.hidden = true;
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("mousedown", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onConfirm() {
      if (type === "text") {
        const val = inputEl.value.trim();
        if (!val) {
          inputEl.focus();
          return;
        }
        cleanup(val);
      } else if (type === "choice") {
        cleanup(inputEl.value);
      } else {
        cleanup(true);
      }
    }
    function onCancel() {
      cleanup(type === "text" || type === "choice" ? null : false);
    }
    function onOverlayClick(e) {
      if (e.target === overlay) onCancel();
    }
    function onKeydown(e) {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter" && type !== "choice") onConfirm();
    }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("mousedown", onOverlayClick);
    document.addEventListener("keydown", onKeydown);

    overlay.hidden = false;
    (inputEl || confirmBtn).focus();
  });
}

export const modalPrompt = (message, placeholder = "") => openModal({ title: "Input required", message, type: "text", placeholder });
export const modalConfirm = (message, opts = {}) => openModal({ title: opts.title || "Please confirm", message, type: "confirm", confirmLabel: opts.confirmLabel || "Confirm", danger: opts.danger });
export const modalAlert = (message, title = "Notice") => openModal({ title, message, type: "alert", confirmLabel: "OK" });
export const modalChoose = (message, options, title = "Choose one") => openModal({ title, message, type: "choice", options });
