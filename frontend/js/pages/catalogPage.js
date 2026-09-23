import { api } from "../api.js";
import { showResult } from "../ui.js";

// ---- Product catalog ----
document.getElementById("add-product-btn").addEventListener("click", () => {
  const form = document.getElementById("product-form");
  form.hidden = !form.hidden;
  document.getElementById("add-product-btn").textContent = form.hidden ? "+ Add Item" : "Cancel";
});

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = Object.fromEntries(new FormData(form).entries());
  const resultEl = document.getElementById("product-result");
  try {
    const product = await api("/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showResult(resultEl, `Added catalog entry #${product.id}: ${product.name}`, true);
    form.reset();
    form.hidden = true;
    document.getElementById("add-product-btn").textContent = "+ Add Item";
    loadProducts();
  } catch (err) {
    showResult(resultEl, "Could not add catalog entry: " + err.message, false);
  }
});

export async function loadProducts() {
  const tbody = document.querySelector("#product-table tbody");
  const resultEl = document.getElementById("product-result");
  try {
    const products = await api("/products");
    tbody.innerHTML = "";
    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">No catalog entries yet.</td></tr>';
    }
    for (const p of products) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.code} <span style="color:#888;">(#${p.id})</span></td>
        <td>${p.name}</td>
        <td>${p.procurement_type}</td>
        <td>${p.category}</td>
        <td>${p.active ? "Yes" : "No"}</td>
        <td class="row-actions">
          <button data-id="${p.id}" data-action="${p.active ? "deactivate" : "activate"}">${p.active ? "Deactivate" : "Activate"}</button>
        </td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    showResult(resultEl, "Could not load catalog: " + err.message, false);
  }
}

document.querySelector("#product-table tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const resultEl = document.getElementById("product-result");
  try {
    await api(`/products/${btn.dataset.id}/${btn.dataset.action}`, { method: "POST" });
    loadProducts();
  } catch (err) {
    showResult(resultEl, `Could not ${btn.dataset.action} catalog entry: ` + err.message, false);
  }
});
