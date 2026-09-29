// ---- Registration's "Other documents" section: the vendor names and
// attaches whatever else they want, as many as they like. Rows are appended
// as DOM nodes (never re-rendered wholesale) so a chosen file in an earlier
// row is never lost when another row is added or removed. ----
let nextId = 0;

function rowHtml(id) {
  return `<div class="ep-pane ep-pane-pad" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap" data-other-row="${id}">
    <div class="ep-field" style="flex:2;min-width:220px"><div class="ep-k">Document name</div><input class="input" data-other-label placeholder="e.g. CE marking certificate"></div>
    <div class="ep-field" style="flex:2;min-width:220px"><div class="ep-k">File</div><input class="input" type="file" data-other-file></div>
    <button type="button" class="ep-b" data-remove-other="${id}">Remove</button>
  </div>`;
}

export function addOtherDocRow() {
  const container = document.getElementById("register-other-docs");
  const id = nextId++;
  container.insertAdjacentHTML("beforeend", rowHtml(id));
  container.querySelector(`[data-remove-other="${id}"]`).addEventListener("click", () => {
    container.querySelector(`[data-other-row="${id}"]`)?.remove();
  });
}

export function resetOtherDocs() {
  document.getElementById("register-other-docs").innerHTML = "";
  nextId = 0;
}

// A row only counts once it has both a name and a file -- an empty row
// someone added and never filled in is silently skipped, not an error.
export function appendOtherDocsToFormData(formData) {
  document.querySelectorAll("#register-other-docs [data-other-row]").forEach((row) => {
    const label = row.querySelector("[data-other-label]").value.trim();
    const file = row.querySelector("[data-other-file]").files[0];
    if (label && file) {
      formData.append("other_doc_label", label);
      formData.append("other_doc_file", file);
    }
  });
}
