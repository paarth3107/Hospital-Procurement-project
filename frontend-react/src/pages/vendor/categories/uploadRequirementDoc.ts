import { api } from "../../../lib/api";
import { VENDOR_DOC_TYPES, acceptFor } from "../../../lib/constants";

// Shared by RequirementPills (requirementHelpers.tsx) and
// ItemRequirementsPanel's own "Upload"/"Upload again" buttons -- the same
// upload flow the vanilla page delegated on `data-upload-req`/
// `data-upload-other`. `for_requirement: true` tells the backend this
// upload is answering a specific requirement, same as the vanilla
// FormData field.
export function uploadRequirementDoc(entry: string, isOther: boolean, customLabel: string, onDone: () => void, onError: (message: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  const docType = VENDOR_DOC_TYPES.find((t) => t.value === entry);
  input.accept = isOther ? ".pdf,.jpg,.jpeg,.png" : acceptFor(docType ?? { value: entry, label: "", mandatory: false });
  input.addEventListener("change", async () => {
    if (!input.files?.[0]) return;
    const fd = new FormData();
    fd.append("doc_type", isOther ? "other" : entry);
    if (isOther) fd.append("custom_label", customLabel);
    fd.append("file", input.files[0]);
    fd.append("for_requirement", "true");
    try {
      await api("/vendor-portal/documents", { method: "POST", body: fd });
      onDone();
    } catch (err) {
      onError("Could not upload: " + (err instanceof Error ? err.message : String(err)));
    }
  });
  input.click();
}
