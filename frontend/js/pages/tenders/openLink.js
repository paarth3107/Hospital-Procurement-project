import { api } from "../../api.js";
import { modalAlert, modalConfirm } from "../../modal.js";

// Registration link for an Open Tender (2026-10-06): copy it, make a new one
// (the old one stops working at once), or turn it off. Shown for a saved Open
// Tender only; a new tender has no link until it is saved. No visible URL
// field (2026-10-07) -- the column it lives in is too narrow to show a full
// link anyway, and Copy is the only thing anyone does with it.
const box = () => document.getElementById("open-link-box");
const urlFor = (token) => `${location.origin}/?open=${token}`;

export function renderOpenLink(tender) {
  const el = box();
  if (!tender || !tender.open_tender) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const token = tender.open_link_token;
  el.hidden = false;
  el.innerHTML = `
    <div class="ep-k">Registration link</div>
    <div class="d-flex gap-10px items-center flex-wrap mt-6px">
      ${token ? '<button type="button" class="ep-b copy-link-btn" data-v="p" data-open-copy>Copy link</button>' : ""}
      <button type="button" class="ep-b" data-open-new>${token ? "New link" : "Turn on"}</button>
      ${token ? '<button type="button" class="ep-b" data-open-off>Turn off</button>' : ""}
    </div>
    <div class="hint mt-6px">New vendors open this link and register. They see this tender listed once they are approved.</div>`;

  const copyBtn = el.querySelector("[data-open-copy]");
  copyBtn?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copy-success");
      setTimeout(() => {
        copyBtn.textContent = "Copy link";
        copyBtn.classList.remove("copy-success");
      }, 1400);
    } catch (err) {
      modalAlert("Could not copy the link automatically. Check your browser's clipboard permission.");
    }
  });
  el.querySelector("[data-open-new]").addEventListener("click", async () => {
    const ok = await modalConfirm(token ? "Make a new link? The current one stops working straight away." : "Turn the link on for this tender?");
    if (!ok) return;
    renderOpenLink(await api(`/tenders/${tender.id}/open-link/regenerate`, { method: "POST" }));
  });
  el.querySelector("[data-open-off]")?.addEventListener("click", async () => {
    const ok = await modalConfirm("Turn the link off? New vendors can't register through it until you turn it on again.");
    if (!ok) return;
    renderOpenLink(await api(`/tenders/${tender.id}/open-link`, { method: "DELETE" }));
  });
}
