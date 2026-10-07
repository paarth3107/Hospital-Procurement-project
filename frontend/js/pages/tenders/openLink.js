import { api } from "../../api.js";
import { esc } from "../../kit.js";
import { modalAlert, modalConfirm } from "../../modal.js";

// Registration link for an Open Tender (2026-10-06): copy it, make a new one
// (the old one stops working at once), or turn it off. Shown for a saved Open
// Tender only; a new tender has no link until it is saved.
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
      <input class="input flex-1" readonly value="${token ? esc(urlFor(token)) : ""}" placeholder="Link is off">
      ${token ? '<button type="button" class="ep-b" data-open-copy>Copy</button>' : ""}
      <button type="button" class="ep-b" data-open-new>${token ? "New link" : "Turn on"}</button>
      ${token ? '<button type="button" class="ep-b" data-open-off>Turn off</button>' : ""}
    </div>
    <div class="hint mt-6px">New vendors open this link and register. They see this tender listed once they are approved.</div>`;

  el.querySelector("[data-open-copy]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      modalAlert("Link copied.");
    } catch (err) {
      modalAlert("Could not copy automatically. Select the link and copy it.");
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
