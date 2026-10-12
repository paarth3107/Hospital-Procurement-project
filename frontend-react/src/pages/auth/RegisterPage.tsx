import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { switchView } from "../../lib/bridge";
import { CITIES_BY_STATE, INDIAN_STATES, OTHER_CITY, VENDOR_DOC_TYPES } from "../../lib/constants";
import { OpenLinkNote } from "./OpenLinkNote";
import { DocumentDropzones } from "./registerDocuments";
import { OtherDocsSection, type OtherDocsHandle } from "./registerOtherDocs";

const MANDATORY_DOC_TYPES = VENDOR_DOC_TYPES.filter((t) => t.mandatory).map((t) => t.value);

// Ported 1:1 from frontend/js/pages/register/registerPage.js -- vendor
// registration form, in two steps: basic info, then documents. Nothing is
// sent to the server until Step 2's final submit -- Continue on Step 1 only
// validates and advances, it never calls the API.
//
// Most fields stay plain uncontrolled inputs (name= attributes read via
// FormData at submit time, exactly like vanilla's own form.addEventListener
// ("submit", ...) handler) rather than individually-tracked React state --
// re-implementing per-field controlled state here would be a bigger rewrite
// than this form actually needs. State/City is the one real exception: the
// city <select>'s options genuinely depend on the chosen state, so that
// pair is controlled.
const ENTITY_TYPES = ["Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "Other"];

export function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [stateValue, setStateValue] = useState("");
  const [cityValue, setCityValue] = useState("");
  const [chosenFiles, setChosenFiles] = useState<Map<string, File>>(new Map());
  const [invalidTypes, setInvalidTypes] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const step1Ref = useRef<HTMLDivElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);
  const otherDocsRef = useRef<OtherDocsHandle>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cities = CITIES_BY_STATE[stateValue] || [];
  const cityIsOther = cityValue === OTHER_CITY;

  function validateStep1(): boolean {
    // Held in an object, not a plain `let` -- TS's control-flow narrowing
    // doesn't track a reassignment made inside a .forEach() callback against
    // the outer binding, so a plain `let firstBad = null` reads back as
    // statically `null` right after the loop. A property access doesn't hit
    // that limitation.
    const found: { el: HTMLElement | null } = { el: null };
    step1Ref.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=file]), select, textarea").forEach((input) => {
      const bad = !input.checkValidity();
      input.classList.toggle("invalid", bad);
      if (bad && !found.el) found.el = input;
    });
    found.el?.scrollIntoView({ block: "center", behavior: "smooth" });
    return !found.el;
  }

  function validateStep2(): boolean {
    const missing = new Set<string>();
    for (const t of MANDATORY_DOC_TYPES) if (!chosenFiles.has(t)) missing.add(t);
    setInvalidTypes(missing);
    if (missing.size) {
      const first = step2Ref.current?.querySelector(`[data-doc-type="${[...missing][0]}"]`);
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      return false;
    }
    return true;
  }

  function goToStep(n: 1 | 2) {
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startReturnCountdown(vendorId: number) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    let secondsLeft = 5;
    const message = () => `Registered as Vendor #${vendorId}. Taking you to the vendor login page in ${secondsLeft}... please log in with your email and the password you just set.`;
    setResult({ message: message(), ok: true });
    countdownRef.current = setInterval(() => {
      secondsLeft--;
      if (secondsLeft <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        switchView("vendor-login");
        return;
      }
      setResult({ message: message(), ok: true });
    }, 1000);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep2()) return;
    const form = formRef.current!;
    const formData = new FormData(form);
    if (formData.get("city") === OTHER_CITY) formData.set("city", formData.get("city_other") as string);
    formData.delete("city_other");
    for (const [docType, file] of chosenFiles) formData.append(docType, file);
    step2Ref.current?.querySelectorAll<HTMLInputElement>("[data-valid-till]").forEach((el) => {
      if (el.value) formData.append(`valid_till_${el.dataset.validTill}`, el.value);
    });
    otherDocsRef.current?.appendToFormData(formData);
    const openLinkToken = sessionStorage.getItem("openLinkToken");
    if (openLinkToken) formData.append("open_link_token", openLinkToken);
    try {
      // multipart: fetch sets the boundary itself
      const vendor = await api<{ id: number }>("/vendors", { method: "POST", body: formData });
      sessionStorage.removeItem("openLinkToken");
      form.reset();
      setStateValue("");
      setCityValue("");
      setChosenFiles(new Map());
      setInvalidTypes(new Set());
      otherDocsRef.current?.reset();
      goToStep(1);
      startReturnCountdown(vendor.id);
    } catch (err) {
      setResult({ message: "Could not register: " + (err instanceof Error ? err.message : String(err)), ok: false });
    }
  };

  return (
    <>
      <button type="button" className="back-link" onClick={() => switchView("vendor-login")}>
        ← Back to vendor login
      </button>
      <div>
        <div className="ep-k">Module 1</div>
        <div className="fs-24px fw-800">Register as a vendor</div>
        <p className="hint mt-4px">Submissions are reviewed by Procurement Admin before you can bid on anything.</p>
      </div>
      <OpenLinkNote />
      <div className="ep-seg self-start">
        <button type="button" className={step === 1 ? "on pe-none" : "pe-none"}>
          1. Basic info
        </button>
        <button type="button" className={step === 2 ? "on pe-none" : "pe-none"}>
          2. Documents
        </button>
      </div>
      <form ref={formRef} className="ep-form gap-18px" noValidate onSubmit={submit}>
        <div className="d-flex flex-col gap-18px" hidden={step !== 1} ref={step1Ref} onInput={(e) => (e.target as HTMLElement).classList.remove("invalid")}>
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Company Details</span>
            </div>
            <div className="ep-pane-pad">
              <div className="ep-form-grid">
                <div className="ep-field col-span-2">
                  <div className="ep-k">Legal name</div>
                  <input className="input" name="legal_name" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Trade name (optional)</div>
                  <input className="input" name="trade_name" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Entity type</div>
                  <select className="input" name="entity_type" required defaultValue="">
                    <option value="">— select —</option>
                    {ENTITY_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="ep-field">
                  <div className="ep-k">Year of incorporation</div>
                  <input className="input" name="year_of_incorporation" type="number" min={1800} max={2100} required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Website (optional)</div>
                  <input className="input" name="website" type="text" placeholder="https://example.com" />
                </div>
                <div className="ep-field col-span-4">
                  <div className="ep-k">Address line</div>
                  <textarea className="input" name="registered_address" rows={2} required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">State</div>
                  <select
                    className="input"
                    name="state"
                    required
                    value={stateValue}
                    onChange={(e) => {
                      setStateValue(e.target.value);
                      setCityValue("");
                    }}
                  >
                    <option value="">— select —</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ep-field">
                  <div className="ep-k">City</div>
                  <select className="input" name="city" required disabled={!stateValue} value={cityValue} onChange={(e) => setCityValue(e.target.value)}>
                    <option value="">{stateValue ? "— select —" : "— select state first —"}</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={OTHER_CITY}>Other (type it in)</option>
                  </select>
                </div>
                {cityIsOther && (
                  <div className="ep-field">
                    <div className="ep-k">City (type it in)</div>
                    <input className="input" name="city_other" required />
                  </div>
                )}
                <div className="ep-field">
                  <div className="ep-k">Pincode</div>
                  <input className="input" name="pincode" maxLength={6} pattern="\d{6}" title="6 digits" placeholder="6 digits" required />
                </div>
                <div className="ep-field col-span-4">
                  <div className="ep-k">Alternate / correspondence address (optional)</div>
                  <textarea className="input" name="alternate_address" rows={2} placeholder="Only if different from the address above" />
                </div>
                <div className="ep-field col-span-4">
                  <div className="ep-k">Branch locations (optional)</div>
                  <textarea className="input" name="branch_locations" rows={2} />
                </div>
              </div>
            </div>
          </div>
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Statutory Identifiers</span>
            </div>
            <div className="ep-pane-pad">
              <div className="ep-form-grid">
                <div className="ep-field col-span-2">
                  <div className="ep-k">GSTIN (15 characters)</div>
                  <input className="input" name="gstin" required maxLength={15} minLength={15} />
                </div>
                <div className="ep-field">
                  <div className="ep-k">PAN</div>
                  <input className="input" name="pan" required maxLength={10} />
                </div>
              </div>
            </div>
          </div>
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Banking Details</span>
            </div>
            <div className="ep-pane-pad">
              <div className="ep-form-grid">
                <div className="ep-field">
                  <div className="ep-k">Bank name</div>
                  <input className="input" name="bank_name" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Account number</div>
                  <input className="input" name="bank_account_number" required inputMode="numeric" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">IFSC</div>
                  <input className="input" name="bank_ifsc" required maxLength={11} />
                </div>
              </div>
            </div>
          </div>
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Contact Details</span>
            </div>
            <div className="ep-pane-pad">
              <div className="ep-form-grid">
                <div className="ep-field">
                  <div className="ep-k">Primary contact person</div>
                  <input className="input" name="contact_person" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Designation</div>
                  <input className="input" name="contact_designation" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Phone</div>
                  <input className="input" name="phone" required />
                </div>
                <div className="ep-field col-span-4">
                  <div className="ep-k">Email (your login)</div>
                  <input className="input" name="email" type="email" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Escalation contact name</div>
                  <input className="input" name="escalation_contact_name" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Escalation phone</div>
                  <input className="input" name="escalation_contact_phone" required />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Escalation email (optional)</div>
                  <input className="input" name="escalation_contact_email" type="email" />
                </div>
              </div>
            </div>
          </div>
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Login</span>
            </div>
            <div className="ep-pane-pad">
              <div className="ep-form-grid">
                <div className="ep-field col-span-4">
                  <div className="ep-k">Password (8+ characters)</div>
                  <input className="input" name="password" type="password" required minLength={8} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <button type="button" className="ep-b" data-v="p" onClick={() => validateStep1() && goToStep(2)}>
              Continue to documents →
            </button>
          </div>
        </div>

        <div className="d-flex flex-col gap-18px" hidden={step !== 2} ref={step2Ref}>
          <div className="ep-k">Documents · PDF, JPG or PNG, max 10 MB each (the catalogue may also be a spreadsheet)</div>
          <DocumentDropzones
            chosenFiles={chosenFiles}
            invalidTypes={invalidTypes}
            onFile={(docType, f) => {
              setChosenFiles((m) => new Map(m).set(docType, f));
              // Clears the "missing" highlight the moment it's fixed, same
              // as vanilla's setFile() calling clearInvalid(zone) eagerly
              // rather than waiting for the next submit attempt.
              setInvalidTypes((s) => {
                if (!s.has(docType)) return s;
                const next = new Set(s);
                next.delete(docType);
                return next;
              });
            }}
          />
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Other Documents (Optional)</span>
            </div>
            <div className="ep-pane-pad">
              <p className="hint margin-0-0-10px">Anything else you'd like to include — name it and attach the file. Add as many as you need.</p>
              <OtherDocsSection ref={otherDocsRef} />
              <button type="button" className="ep-b mt-10px" onClick={() => otherDocsRef.current?.addRow()}>
                + Add another document
              </button>
            </div>
          </div>
          <div className="d-flex gap-10px">
            <button type="button" className="ep-b" onClick={() => goToStep(1)}>
              ← Back to basic info
            </button>
            <button type="submit" className="ep-b" data-v="p">
              Submit for verification
            </button>
          </div>
        </div>
      </form>
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
    </>
  );
}
