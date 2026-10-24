import { useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Facility } from "../../lib/types";
import { DialogShell } from "../../components/DialogShell";
import { FieldError } from "../../components/FieldError";
import { Req } from "../../components/Req";
import { FACILITY_FIELD_VALIDATORS } from "./staffValidation";

// Ported 1:1 from frontend/js/pages/staff/facilityForm.js.
//
// Real bug, found 2026-10-24 (user-reported): this used to rely entirely on
// bare `required` and a single generic error banner shown only once the API
// call came back -- a duplicate legal entity code only surfaced after a
// round-trip, with nothing pointing at which field was wrong. Same
// on-blur-error-under-the-field pattern as registration/login now
// (staffValidation.ts), plus an immediate client-side duplicate check
// against the facilities this page already has loaded -- the backend's own
// check (routers/facilities.py) stays the real guard, this is just faster
// feedback for the common case of retyping a code that's already in the
// table in front of you.
export function FacilityFormDialog({ existingCodes, onClose, onSaved }: { existingCodes: string[]; onClose: () => void; onSaved: (facility: Facility) => void }) {
  const [name, setName] = useState("");
  const [legalEntityCode, setLegalEntityCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const validators = FACILITY_FIELD_VALIDATORS(existingCodes);

  function checkField(fieldName: string, value: string) {
    const err = validators[fieldName](value);
    setFieldErrors((prev) => (prev[fieldName] === (err ?? "") ? prev : { ...prev, [fieldName]: err ?? "" }));
    return err;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const nameErr = checkField("name", name);
    const codeErr = checkField("legal_entity_code", legalEntityCode);
    if (nameErr || codeErr) {
      (nameErr ? nameRef : codeRef).current?.focus();
      return;
    }
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
      <form className="ep-form padding-16px-18px bg-transparent border-0" noValidate onSubmit={submit}>
        <div className="ep-field">
          <div className="ep-k">
            Facility name
            <Req />
          </div>
          <input
            ref={nameRef}
            className={`input${fieldErrors.name ? " invalid" : ""}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) checkField("name", e.target.value);
            }}
            onBlur={(e) => checkField("name", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="name" />
        </div>
        <div className="ep-field">
          <div className="ep-k">
            Legal entity code
            <Req />
          </div>
          <input
            ref={codeRef}
            className={`input${fieldErrors.legal_entity_code ? " invalid" : ""}`}
            value={legalEntityCode}
            onChange={(e) => {
              setLegalEntityCode(e.target.value);
              if (fieldErrors.legal_entity_code) checkField("legal_entity_code", e.target.value);
            }}
            onBlur={(e) => checkField("legal_entity_code", e.target.value)}
          />
          <FieldError errors={fieldErrors} name="legal_entity_code" />
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
