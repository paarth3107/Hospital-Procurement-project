import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Facility } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";

// Ported 1:1 from frontend/js/pages/staff/facilityForm.js.
export function FacilityFormDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (facility: Facility) => void }) {
  const [name, setName] = useState("");
  const [legalEntityCode, setLegalEntityCode] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const facility = await api<Facility>("/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, legal_entity_code: legalEntityCode }),
      });
      onClose();
      onSaved(facility);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <DialogShell kicker="Facility" title="Add Facility">
      <form className="ep-form padding-16px-18px bg-transparent border-0" onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">Facility name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="ep-field">
          <div className="ep-k">Legal entity code</div>
          <input className="input" value={legalEntityCode} onChange={(e) => setLegalEntityCode(e.target.value)} required />
        </div>
        {error && <div className="result err">{error}</div>}
        <div className="d-flex justify-end gap-10px">
          <button type="button" className="ep-b" onClick={onClose}>
            Cancel
          </button>
          <button className="ep-b" data-v="p">
            Create facility
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
