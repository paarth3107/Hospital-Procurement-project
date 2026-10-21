import { useEffect, useRef, useState } from "react";
import { api, uploadWithProgress } from "../../lib/api";
import { switchView, takePendingRegistrationResume } from "../../lib/bridge";
import { CITIES_BY_STATE, INDIAN_STATES, OTHER_CITY, VENDOR_DOC_TYPES } from "../../lib/constants";
import { OpenLinkNote } from "./OpenLinkNote";
import { PasswordField } from "../../components/PasswordField";
import { Req } from "../../components/Req";
import { StateTag } from "../../components/Tag";
import { DocumentDropzones, type DocEntryState } from "./registerDocuments";
import { OtherDocsSection, type OtherDocsHandle } from "./registerOtherDocs";
import { FIELD_VALIDATORS } from "./registerValidation";
import { FieldError } from "../../components/FieldError";
import type { VendorDetail } from "../../lib/types";

const MANDATORY_DOC_TYPES = VENDOR_DOC_TYPES.filter((t) => t.mandatory).map((t) => t.value);

// Ported 1:1 from frontend/js/pages/register/registerPage.js -- vendor
// registration form, in two steps: basic info, then documents.
//
// User-directed rewrite (2026-10-13): Step 1's "Continue" used to just
// advance to Step 2, with nothing sent to the server until ONE giant final
// submit bundling every field plus every document into a single request --
// see registerDocuments.tsx's note on why that was slow/unreliable with
// several large files. Continue now also creates a lightweight DRAFT vendor
// (POST /vendors/draft, backend/app/routers/vendors.py) the moment Step 1
// passes validation + the duplicate check, and each document in Step 2
// uploads itself immediately against that draft. Final "Submit for
// verification" is now just POST /vendors/{id}/complete-registration with
// the registration_token -- no files travel in that last request at all.
//
// Once the draft exists, Step 1's fields are locked (fieldset disabled)
// rather than silently allowed to be edited with no effect -- there's no
// "update draft" endpoint, so editing after this point would look like it
// did something while actually changing nothing on the server.
//
// Most fields stay plain uncontrolled inputs (name= attributes read via
// FormData/querySelector rather than individually-tracked React state) --
// re-implementing per-field controlled state here would be a bigger rewrite
// than this form actually needs. State/City is the one real exception: the
// city <select>'s options genuinely depend on the chosen state, so that
// pair is controlled.
const ENTITY_TYPES = ["Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "Other"];

export function RegisterPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [stateValue, setStateValue] = useState("");
  const [cityValue, setCityValue] = useState("");
  const [docState, setDocState] = useState<Record<string, DocEntryState>>({});
  const [invalidTypes, setInvalidTypes] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  // Registration recovery (2026-10-21): true only when we landed here via
  // VendorLoginPage's "still Draft" redirect, carrying what's already saved.
  // Unlike the normal same-session case, Step 1 stays editable (there's now
  // an update endpoint to actually persist edits to) and there's no
  // plaintext password to prefill, so the password field doesn't render at
  // all in this mode -- same reasoning StaffFormDialog.tsx uses for editing.
  const [resuming, setResuming] = useState(false);
  const resumeCityRef = useRef<string | null>(null);
  // Email ownership verification (2026-10-19, user-directed): once the draft
  // is created, Step 2 is gated behind a 6-digit code sent to the Step 1
  // email -- proves the registrant actually controls that inbox, not just
  // that it's shaped like one (format alone was already checked earlier).
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [codeError, setCodeError] = useState("");
  // Bug report, 2026-10-13: the old success message was a small, generic
  // "result" banner that got overwritten/disappeared within a moment, with
  // nothing on screen to confirm what had actually happened or to say what
  // to do next -- and only an automatic redirect to rely on, no manual way
  // out if anything about that redirect misfired. Once registration
  // completes, `completedVendorId` short-circuits the whole render below
  // into a dedicated, persistent confirmation screen instead -- see the
  // early return near the bottom of this component.
  const [completedVendorId, setCompletedVendorId] = useState<number | null>(null);
  const REDIRECT_DELAY_SECONDS = 8;
  const [redirectSeconds, setRedirectSeconds] = useState(REDIRECT_DELAY_SECONDS);
  const formRef = useRef<HTMLFormElement>(null);
  const step1Ref = useRef<HTMLFieldSetElement>(null);
  const step2Ref = useRef<HTMLDivElement>(null);
  const otherDocsRef = useRef<OtherDocsHandle>(null);
  const ADDRESS_MAX = 250;
  const registeredAddressCounterRef = useRef<HTMLSpanElement>(null);
  const alternateAddressCounterRef = useRef<HTMLSpanElement>(null);

  const cities = CITIES_BY_STATE[stateValue] || [];
  const cityIsOther = cityValue === OTHER_CITY;

  // Registration recovery (2026-10-21): if VendorLoginPage sent us here
  // (still Draft), prefill every Step 1 field from what's already saved and
  // immediately run the same save+continue logic a fresh Continue click
  // would -- "the save as draft flow runs automatically, and if the code's
  // already verified, Step 2 opens" (user-directed). If it's NOT verified
  // yet, saveStep1 below falls through to sending a fresh code and staying
  // on Step 1, prefilled and now editable, exactly where they left off.
  useEffect(() => {
    const resume = takePendingRegistrationResume();
    if (!resume) return;
    setVendorId(resume.id);
    setRegistrationToken(resume.registration_token);
    setEmailVerified(resume.email_verified);
    setResuming(true);
    setStateValue(resume.state || "");
    const knownCities = CITIES_BY_STATE[resume.state || ""] || [];
    const cityIsKnown = !!resume.city && knownCities.includes(resume.city);
    setCityValue(resume.city ? (cityIsKnown ? resume.city : OTHER_CITY) : "");
    if (resume.city && !cityIsKnown) resumeCityRef.current = resume.city; // city_other doesn't exist in the DOM yet -- see the effect below
    prefillStep1(resume);
    // Fields are in the DOM now (synchronous writes above); run the normal
    // save+continue flow with what's already there, unedited.
    saveStep1();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // city_other only renders once cityIsOther is true, which the effect
  // above triggers via setCityValue but can't write into synchronously
  // (the input doesn't exist until this render lands) -- a second pass.
  useEffect(() => {
    if (cityIsOther && resumeCityRef.current) {
      const el = step1Ref.current?.querySelector<HTMLInputElement>(`[name="city_other"]`);
      if (el) el.value = resumeCityRef.current;
      resumeCityRef.current = null;
    }
  }, [cityIsOther]);

  function prefillStep1(v: VendorDetail) {
    const set = (name: string, value: string | number | null | undefined) => {
      const el = step1Ref.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (el && value != null) el.value = String(value);
    };
    set("legal_name", v.legal_name);
    set("trade_name", v.trade_name);
    set("entity_type", v.entity_type);
    set("year_of_incorporation", v.year_of_incorporation);
    set("website", v.website);
    set("registered_address", v.registered_address);
    set("pincode", v.pincode);
    set("alternate_address", v.alternate_address);
    set("branch_locations", v.branch_locations);
    set("gstin", v.gstin);
    set("pan", v.pan);
    set("bank_name", v.bank_name);
    set("bank_account_number", v.bank_account_number);
    set("bank_ifsc", v.bank_ifsc);
    set("contact_person", v.contact_person);
    set("contact_designation", v.contact_designation);
    set("phone", v.phone);
    set("email", v.email);
    set("escalation_contact_name", v.escalation_contact_name);
    set("escalation_contact_phone", v.escalation_contact_phone);
    set("escalation_contact_email", v.escalation_contact_email);
    // The live "N/250" counters (onStep1Input) only update on a real input
    // event, which setting .value directly doesn't fire -- set them to match.
    if (registeredAddressCounterRef.current) registeredAddressCounterRef.current.textContent = `${(v.registered_address || "").length}/${ADDRESS_MAX}`;
    if (alternateAddressCounterRef.current) alternateAddressCounterRef.current.textContent = `${(v.alternate_address || "").length}/${ADDRESS_MAX}`;
  }

  // Ticks the confirmation screen's countdown and redirects once it reaches
  // zero -- a real delay the vendor can watch and read against, not an
  // invisible timer backing a message that might already be gone by the
  // time it fires. Cleaned up automatically on unmount (e.g. once
  // switchView navigates away, or if the vendor clicks "Go to vendor
  // login" manually before it finishes).
  useEffect(() => {
    if (completedVendorId === null) return;
    setRedirectSeconds(REDIRECT_DELAY_SECONDS);
    let remaining = REDIRECT_DELAY_SECONDS;
    const interval = setInterval(() => {
      remaining -= 1;
      setRedirectSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        switchView("vendor-login");
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedVendorId]);

  // Runs one field's validator (registerValidation.ts) and records the
  // result -- shared by the on-blur check below and validateStep1()'s
  // final sweep, so "leave the field" and "click Continue without ever
  // touching it" both go through the same rule per field.
  function checkField(name: string, value: string) {
    const validator = FIELD_VALIDATORS[name];
    if (!validator) return null;
    const err = validator(value);
    setFieldErrors((prev) => (prev[name] === (err ?? "") ? prev : { ...prev, [name]: err ?? "" }));
    return err;
  }

  // Delegated on the whole step-1 pane rather than one handler per field
  // (~20 of them) -- React's onBlur bubbles through a parent like any other
  // synthetic event, so this fires for whichever field was actually left.
  const onStep1Blur = (e: React.FocusEvent<HTMLFieldSetElement>) => {
    const t = e.target as unknown as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (t.name) checkField(t.name, t.value);
  };
  // Clears the red border + inline message live, the moment what's typed
  // becomes valid again -- without this, fixing a flagged field would still
  // look wrong until the user blurred it a second time.
  const onStep1Input = (e: React.FormEvent<HTMLFieldSetElement>) => {
    const t = e.target as unknown as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if ((t.name === "gstin" || t.name === "pan" || t.name === "bank_ifsc") && t.value !== t.value.toUpperCase()) t.value = t.value.toUpperCase();
    // Real bug, found 2026-10-15: escalation_contact_phone had none of the
    // phone field's own digits-only/10-char capping, live or otherwise --
    // matched it exactly rather than duplicating a second, divergent rule.
    if ((t.name === "phone" || t.name === "escalation_contact_phone") && t.value !== t.value.replace(/\D/g, "").slice(0, 10))
      t.value = t.value.replace(/\D/g, "").slice(0, 10);
    // Real bug, found 2026-10-13: Pincode took letters -- `pattern`/`maxLength`
    // alone don't block invalid characters from being typed, only flag the
    // field invalid afterward. Digits-only and capped at 6, live, same as phone.
    if (t.name === "pincode" && t.value !== t.value.replace(/\D/g, "").slice(0, 6)) t.value = t.value.replace(/\D/g, "").slice(0, 6);
    // Real bug, found 2026-10-15: `maxLength` is silently ignored on
    // type="number" inputs by every browser -- it only ever worked on the
    // text-like fields above (phone/pincode). Capped live instead, same
    // pattern, since min/max alone only flag the field invalid afterward,
    // they don't stop someone from typing a 5th+ digit in the first place.
    if (t.name === "year_of_incorporation" && t.value.length > 4) t.value = t.value.slice(0, 4);
    // Live "N/250" counter + a hard stop at the max -- native `maxLength`
    // already blocks typing/paste past it, this is just the visible readout.
    if (t.name === "registered_address" || t.name === "alternate_address") {
      if (t.value.length > ADDRESS_MAX) t.value = t.value.slice(0, ADDRESS_MAX);
      const counterRef = t.name === "registered_address" ? registeredAddressCounterRef : alternateAddressCounterRef;
      if (counterRef.current) counterRef.current.textContent = `${t.value.length}/${ADDRESS_MAX}`;
    }
    t.classList?.remove("invalid");
    if (t.name && fieldErrors[t.name]) checkField(t.name, t.value);
  };

  function validateStep1(): boolean {
    // Held in an object, not a plain `let` -- TS's control-flow narrowing
    // doesn't track a reassignment made inside a .forEach() callback against
    // the outer binding, so a plain `let firstBad = null` reads back as
    // statically `null` right after the loop. A property access doesn't hit
    // that limitation.
    const found: { el: HTMLElement | null } = { el: null };
    step1Ref.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=file]), select, textarea").forEach((input) => {
      const ruleErr = checkField(input.name, input.value);
      const bad = ruleErr !== null && ruleErr !== undefined ? true : !input.checkValidity();
      input.classList.toggle("invalid", bad);
      if (bad && !found.el) found.el = input;
    });
    found.el?.scrollIntoView({ block: "center", behavior: "smooth" });
    return !found.el;
  }

  function step1Value(name: string): string {
    return step1Ref.current?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? "";
  }

  // User-directed (2026-10-13): GSTIN/PAN/email/phone duplicate checks used
  // to only ever run at the final "Submit for verification" (POST /vendors
  // itself 409s on a match) -- by then Step 2's documents are already
  // attached, so a vendor who's, say, already registered found out only
  // after doing all of that work. Continue now calls the lightweight
  // /vendors/check-duplicates first (same uniqueness rule, same wording --
  // backend/app/routers/vendors.py's shared _duplicate_check()) -- an
  // "already registered" error shows up right on Step 1, inline on the
  // field it's actually about, before the user ever sees Step 2.
  //
  // Once that passes, Continue also creates the draft vendor
  // (POST /vendors/draft) that Step 2's per-document uploads attach to. If
  // a draft already exists (the user went Step 2 -> back -> Continue again
  // without anything to recheck), it's reused rather than creating a second
  // one -- Step 1's fields are locked by then anyway (see the fieldset
  // below), so nothing could have changed.
  //
  // Also what the registration-recovery effect above calls automatically
  // on mount. `resuming` (set only by that recovery path) is what tells
  // this to PUT .../draft (update the existing row) instead of POST
  // .../draft (create) -- the two are otherwise identical. No separate
  // "Save as Draft" -- Continue already saves, and a vendor stuck on a bad
  // email is covered by that same recovery path (logging back in), so a
  // second, dedicated save button would just duplicate what this already does.
  async function saveStep1() {
    if (checkingDuplicates) return;
    if (!validateStep1()) return;
    if (vendorId && registrationToken && !resuming) {
      // Reusing an existing draft (Step 2 -> Back -> Continue again): if
      // email verification somehow still isn't done, stay here and let the
      // code panel below render instead of skipping ahead to Step 2.
      if (emailVerified) goToStep(2);
      return;
    }
    setCheckingDuplicates(true);
    try {
      let draft: { id: number; registration_token: string; email_verified: boolean };
      if (resuming && vendorId && registrationToken) {
        draft = await api(`/vendors/${vendorId}/draft`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legal_name: step1Value("legal_name"),
            gstin: step1Value("gstin"),
            pan: step1Value("pan"),
            trade_name: step1Value("trade_name") || null,
            entity_type: step1Value("entity_type"),
            year_of_incorporation: Number(step1Value("year_of_incorporation")),
            registered_address: step1Value("registered_address"),
            city: cityIsOther ? step1Value("city_other") : cityValue,
            state: stateValue,
            pincode: step1Value("pincode"),
            branch_locations: step1Value("branch_locations") || null,
            alternate_address: step1Value("alternate_address") || null,
            website: step1Value("website") || null,
            bank_name: step1Value("bank_name"),
            bank_account_number: step1Value("bank_account_number"),
            bank_ifsc: step1Value("bank_ifsc"),
            contact_person: step1Value("contact_person"),
            contact_designation: step1Value("contact_designation"),
            email: step1Value("email"),
            phone: step1Value("phone"),
            escalation_contact_name: step1Value("escalation_contact_name"),
            escalation_contact_phone: step1Value("escalation_contact_phone"),
            escalation_contact_email: step1Value("escalation_contact_email") || null,
            registration_token: registrationToken,
          }),
        });
      } else {
        const dup = await api<{ gstin: string | null; pan: string | null; email: string | null; phone: string | null }>("/vendors/check-duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gstin: step1Value("gstin"), pan: step1Value("pan"), email: step1Value("email"), phone: step1Value("phone") }),
        });
        const dupErrors = (["gstin", "pan", "email", "phone"] as const).filter((k) => dup[k]);
        if (dupErrors.length) {
          setFieldErrors((prev) => {
            const next = { ...prev };
            for (const k of dupErrors) next[k] = dup[k]!;
            return next;
          });
          const first: { el: HTMLElement | null } = { el: null };
          for (const k of dupErrors) {
            const el = step1Ref.current?.querySelector<HTMLElement>(`[name="${k}"]`);
            el?.classList.add("invalid");
            if (!first.el) first.el = el ?? null;
          }
          first.el?.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
        const openLinkToken = sessionStorage.getItem("openLinkToken");
        draft = await api("/vendors/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legal_name: step1Value("legal_name"),
            gstin: step1Value("gstin"),
            pan: step1Value("pan"),
            trade_name: step1Value("trade_name") || null,
            entity_type: step1Value("entity_type"),
            year_of_incorporation: Number(step1Value("year_of_incorporation")),
            registered_address: step1Value("registered_address"),
            city: cityIsOther ? step1Value("city_other") : cityValue,
            state: stateValue,
            pincode: step1Value("pincode"),
            branch_locations: step1Value("branch_locations") || null,
            alternate_address: step1Value("alternate_address") || null,
            website: step1Value("website") || null,
            bank_name: step1Value("bank_name"),
            bank_account_number: step1Value("bank_account_number"),
            bank_ifsc: step1Value("bank_ifsc"),
            contact_person: step1Value("contact_person"),
            contact_designation: step1Value("contact_designation"),
            email: step1Value("email"),
            phone: step1Value("phone"),
            escalation_contact_name: step1Value("escalation_contact_name"),
            escalation_contact_phone: step1Value("escalation_contact_phone"),
            escalation_contact_email: step1Value("escalation_contact_email") || null,
            password: step1Value("password"),
            open_link_token: openLinkToken || null,
          }),
        });
      }
      setVendorId(draft.id);
      setRegistrationToken(draft.registration_token);
      if (draft.email_verified) {
        setEmailVerified(true);
        goToStep(2);
      } else {
        await sendCode(draft.id, draft.registration_token);
      }
    } catch (err) {
      setResult({ message: "Could not save: " + (err instanceof Error ? err.message : String(err)), ok: false });
    } finally {
      setCheckingDuplicates(false);
    }
  }

  const checkDuplicatesAndContinue = () => saveStep1();

  // Shared by the automatic first send (right after the draft is created)
  // and the "Resend code" button -- each call overwrites any previous code
  // server-side, so only the most recently sent one is ever valid.
  async function sendCode(id: number, token: string) {
    setSendingCode(true);
    setCodeError("");
    try {
      await api(`/vendors/${id}/send-verification-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_token: token }),
      });
      setCodeSent(true);
    } catch (err) {
      setCodeError("Could not send the code: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyCode() {
    if (!vendorId || !registrationToken || verifyingCode) return;
    if (!emailCode.trim()) {
      setCodeError("Enter the code from your email.");
      return;
    }
    setVerifyingCode(true);
    setCodeError("");
    try {
      await api(`/vendors/${vendorId}/verify-email-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_token: registrationToken, code: emailCode.trim() }),
      });
      setEmailVerified(true);
      goToStep(2);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyingCode(false);
    }
  }

  function validTillFor(docType: string): string | null {
    const el = step2Ref.current?.querySelector<HTMLInputElement>(`[data-valid-till="${docType}"]`);
    return el?.value || null;
  }

  // Registration recovery (2026-10-21): reaching Step 2 while resuming
  // means some mandatory types may already be uploaded from before the
  // vendor got stuck -- fetch them once so the dropzones show "done"
  // instead of demanding a re-upload of something already on file.
  // "other" documents are handled separately by OtherDocsSection, which
  // has its own listing -- skipped here on purpose.
  useEffect(() => {
    if (step !== 2 || !resuming || !vendorId || !registrationToken) return;
    (async () => {
      try {
        const docs = await api<{ doc_type: string; original_filename: string; size_bytes: number }[]>(
          `/vendors/${vendorId}/draft-documents?registration_token=${encodeURIComponent(registrationToken)}`
        );
        setDocState((prev) => {
          const next = { ...prev };
          for (const d of docs) {
            if (d.doc_type === "other") continue;
            next[d.doc_type] = { uploading: false, progress: 1, error: null, uploaded: { filename: d.original_filename, sizeBytes: d.size_bytes } };
          }
          return next;
        });
      } catch {
        // Best-effort prefill -- a failure here just leaves the dropzones
        // blank, same as before this recovery flow existed.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, resuming, vendorId, registrationToken]);

  // Each dropzone (registerDocuments.tsx) calls this the moment a valid
  // file is picked/dropped -- uploads it immediately against the draft
  // vendor, with its own progress ring, rather than staging it for a later
  // bundled submit.
  async function uploadDoc(docType: string, file: File) {
    if (!vendorId || !registrationToken) return;
    setDocState((prev) => ({ ...prev, [docType]: { uploading: true, progress: 0, error: null, uploaded: prev[docType]?.uploaded ?? null } }));
    setInvalidTypes((s) => {
      if (!s.has(docType)) return s;
      const next = new Set(s);
      next.delete(docType);
      return next;
    });
    const fd = new FormData();
    fd.append("registration_token", registrationToken);
    fd.append("doc_type", docType);
    const validTill = validTillFor(docType);
    if (validTill) fd.append("valid_till", validTill);
    fd.append("file", file);
    try {
      await uploadWithProgress(`/vendors/${vendorId}/documents`, fd, (p) => setDocState((prev) => ({ ...prev, [docType]: { ...prev[docType], progress: p } })));
      setDocState((prev) => ({ ...prev, [docType]: { uploading: false, progress: 1, error: null, uploaded: { filename: file.name, sizeBytes: file.size } } }));
    } catch (err) {
      setDocState((prev) => ({ ...prev, [docType]: { uploading: false, progress: 0, error: err instanceof Error ? err.message : String(err), uploaded: prev[docType]?.uploaded ?? null } }));
    }
  }

  function validateStep2(): boolean {
    const missing = new Set<string>();
    for (const t of MANDATORY_DOC_TYPES) if (!docState[t]?.uploaded) missing.add(t);
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

  // All documents are already on the server by the time this runs -- this
  // is now just the "mark the registration complete" call, not an upload.
  // On success, `completedVendorId` takes over the whole render (see the
  // early return below) -- there's nothing left on this form worth
  // resetting, since it's about to stop being shown at all.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!validateStep2()) return;
    if (!vendorId || !registrationToken) return;
    if (Object.values(docState).some((d) => d.uploading)) return; // a document's still mid-upload -- wait for it
    setSubmitting(true);
    try {
      await api(`/vendors/${vendorId}/complete-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_token: registrationToken }),
      });
      sessionStorage.removeItem("openLinkToken");
      setCompletedVendorId(vendorId);
    } catch (err) {
      setResult({ message: "Could not complete registration: " + (err instanceof Error ? err.message : String(err)), ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  // Bug report, 2026-10-13 -- expected behaviour: "A confirmation screen
  // stays visible with a message such as 'Registration submitted', a
  // reference number, and the status 'Pending Verification'... a button
  // such as 'Go to vendor login'. Any automatic redirect happens only
  // after a clear delay." This replaces the whole form the moment
  // registration completes, rather than a transient message sitting
  // alongside it.
  if (completedVendorId !== null) {
    return (
      <div className="ep-pane ep-pane-pad d-flex flex-col gap-14px maxw-460px">
        <div className="fs-24px fw-800">Registration submitted</div>
        <div className="d-flex items-center gap-10px flex-wrap">
          <span className="ep-k">Reference</span>
          <span className="fw-700">Vendor #{completedVendorId}</span>
          <StateTag state="pending_verification" />
        </div>
        <p className="hint">
          Your registration has been submitted for review. Category Manager will verify your documents before your
          account is Active and you can bid on tenders — log in any time to check its status, with the email and
          password you just set.
        </p>
        <div className="d-flex items-center gap-14px flex-wrap">
          <button type="button" className="ep-b" data-v="p" onClick={() => switchView("vendor-login")}>
            Go to vendor login
          </button>
          <span className="ep-sub">Redirecting automatically in {redirectSeconds}s…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="back-link" onClick={() => switchView("vendor-login")}>
        ← Back to vendor login
      </button>
      <div>
        <div className="ep-k">Module 1</div>
        <div className="fs-24px fw-800">Register as a vendor</div>
        <p className="hint mt-4px">Submissions are reviewed by Category Manager before you can bid on anything.</p>
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
        <fieldset disabled={vendorId !== null && !resuming} className="fieldset-reset d-flex flex-col gap-18px" hidden={step !== 1} ref={step1Ref} onBlur={onStep1Blur} onInput={onStep1Input}>
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Company Details</span>
            </div>
            <div className="ep-pane-pad">
              <div className="ep-form-grid">
                <div className="ep-field col-span-2">
                  <div className="ep-k">
                    Legal name
                    <Req />
                  </div>
                  <input className="input" name="legal_name" required minLength={2} maxLength={100} />
                  <FieldError errors={fieldErrors} name="legal_name" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Trade name</div>
                  <input className="input" name="trade_name" minLength={2} maxLength={100} />
                  <FieldError errors={fieldErrors} name="trade_name" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Entity type
                    <Req />
                  </div>
                  <select className="input" name="entity_type" required defaultValue="">
                    <option value="">— select —</option>
                    {ENTITY_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <FieldError errors={fieldErrors} name="entity_type" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Year of incorporation
                    <Req />
                  </div>
                  {/* Real bug, found 2026-10-15: a number input changes its value on scroll
                      whenever it's focused -- surprising if the page itself is scrolled with
                      the cursor sitting over this field. Blur on wheel so scrolling the page
                      just scrolls the page. */}
                  <input
                    className="input no-spinner"
                    name="year_of_incorporation"
                    type="number"
                    min={1800}
                    max={2100}
                    required
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                  <FieldError errors={fieldErrors} name="year_of_incorporation" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Website</div>
                  <input className="input" name="website" type="text" placeholder="https://example.com" />
                </div>
                <div className="ep-field col-span-4">
                  <div className="d-flex justify-between items-center">
                    <div className="ep-k">
                      Address line
                      <Req />
                    </div>
                    <span className="char-counter" ref={registeredAddressCounterRef}>
                      0/{ADDRESS_MAX}
                    </span>
                  </div>
                  <textarea className="input" name="registered_address" rows={2} required minLength={10} maxLength={ADDRESS_MAX} />
                  <FieldError errors={fieldErrors} name="registered_address" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    State
                    <Req />
                  </div>
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
                  <FieldError errors={fieldErrors} name="state" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    City
                    <Req />
                  </div>
                  <select className="input" name="city" required disabled={!stateValue} value={cityValue} onChange={(e) => setCityValue(e.target.value)}>
                    <option value="">{stateValue ? "— select —" : "— select state first —"}</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={OTHER_CITY}>Other (type it in)</option>
                  </select>
                  <FieldError errors={fieldErrors} name="city" />
                </div>
                {cityIsOther && (
                  <div className="ep-field">
                    <div className="ep-k">
                      City (type it in)
                      <Req />
                    </div>
                    <input className="input" name="city_other" required />
                    <FieldError errors={fieldErrors} name="city_other" />
                  </div>
                )}
                <div className="ep-field">
                  <div className="ep-k">
                    Pincode
                    <Req />
                  </div>
                  <input className="input" name="pincode" inputMode="numeric" maxLength={6} pattern="\d{6}" title="6 digits" placeholder="6 digits" required />
                  <FieldError errors={fieldErrors} name="pincode" />
                </div>
                <div className="ep-field col-span-4">
                  <div className="d-flex justify-between items-center">
                    <div className="ep-k">Alternate / correspondence address</div>
                    <span className="char-counter" ref={alternateAddressCounterRef}>
                      0/{ADDRESS_MAX}
                    </span>
                  </div>
                  <textarea className="input" name="alternate_address" rows={2} maxLength={ADDRESS_MAX} placeholder="Only if different from the address above" />
                  <FieldError errors={fieldErrors} name="alternate_address" />
                </div>
                <div className="ep-field col-span-4">
                  <div className="ep-k">Branch locations</div>
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
                  <div className="ep-k">
                    GSTIN (15 characters)
                    <Req />
                  </div>
                  <input className="input" name="gstin" required maxLength={15} minLength={15} />
                  <FieldError errors={fieldErrors} name="gstin" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    PAN
                    <Req />
                  </div>
                  <input className="input" name="pan" required maxLength={10} />
                  <FieldError errors={fieldErrors} name="pan" />
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
                  <div className="ep-k">
                    Bank name
                    <Req />
                  </div>
                  <input className="input" name="bank_name" required />
                  <FieldError errors={fieldErrors} name="bank_name" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Account number
                    <Req />
                  </div>
                  <input className="input" name="bank_account_number" required inputMode="numeric" />
                  <FieldError errors={fieldErrors} name="bank_account_number" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    IFSC
                    <Req />
                  </div>
                  <input className="input" name="bank_ifsc" required maxLength={11} />
                  <FieldError errors={fieldErrors} name="bank_ifsc" />
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
                  <div className="ep-k">
                    Primary contact person
                    <Req />
                  </div>
                  <input className="input" name="contact_person" required minLength={2} maxLength={50} />
                  <FieldError errors={fieldErrors} name="contact_person" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Designation
                    <Req />
                  </div>
                  <input className="input" name="contact_designation" required minLength={2} maxLength={50} />
                  <FieldError errors={fieldErrors} name="contact_designation" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Phone
                    <Req />
                  </div>
                  <input className="input" name="phone" required inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" />
                  <FieldError errors={fieldErrors} name="phone" />
                </div>
                <div className="ep-field col-span-4">
                  <div className="ep-k">
                    Email (your login)
                    <Req />
                  </div>
                  <input className="input" name="email" type="email" required />
                  <FieldError errors={fieldErrors} name="email" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Escalation contact name
                    <Req />
                  </div>
                  <input className="input" name="escalation_contact_name" required minLength={2} maxLength={50} />
                  <FieldError errors={fieldErrors} name="escalation_contact_name" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">
                    Escalation phone
                    <Req />
                  </div>
                  <input className="input" name="escalation_contact_phone" required inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" />
                  <FieldError errors={fieldErrors} name="escalation_contact_phone" />
                </div>
                <div className="ep-field">
                  <div className="ep-k">Escalation email</div>
                  <input className="input" name="escalation_contact_email" type="email" />
                  <FieldError errors={fieldErrors} name="escalation_contact_email" />
                </div>
              </div>
            </div>
          </div>
          {/* Not rendered at all while resuming -- there's no plaintext
              password to prefill, and this update path never touches it
              (VendorDraftUpdate has no password field; a vendor changes
              their password by actually typing a new one in, which this
              recovery flow isn't for). Not in the DOM also means
              validateStep1()'s querySelectorAll skips it cleanly. */}
          {!resuming && (
            <div className="ep-pane">
              <div className="ep-pane-head">
                <span>Login</span>
              </div>
              <div className="ep-pane-pad">
                <div className="ep-form-grid">
                  <div className="ep-field col-span-4">
                    <div className="ep-k">
                      Password (8-20 characters, with at least one digit, lowercase, uppercase and special character)
                      <Req />
                    </div>
                    <PasswordField name="password" required minLength={8} maxLength={20} autoComplete="new-password" />
                    <FieldError errors={fieldErrors} name="password" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </fieldset>
        {/* Hidden only in the one state the verify panel below covers
            (draft exists, not yet verified) -- otherwise this is the same
            Continue button as always, including "already verified, just
            navigating Step 2 -> Back -> Continue again" (checkDuplicatesAndContinue
            already handles that case by going straight to Step 2). */}
        {step === 1 && !(vendorId && !emailVerified) && (
          <div>
            <button type="button" className="ep-b" data-v="p" disabled={checkingDuplicates} onClick={checkDuplicatesAndContinue}>
              {checkingDuplicates ? "Checking…" : "Continue"}
            </button>
          </div>
        )}
        {/* Email ownership verification (2026-10-19, user-directed): shown
            once the draft exists but before Step 2, so a wrong/fake email is
            caught before any documents get uploaded against it. */}
        {step === 1 && vendorId && !emailVerified && (
          <div className="ep-pane ep-pane-pad d-flex flex-col gap-10px maxw-380px">
            <div className="ep-k">Verify Your Email</div>
            <p className="hint margin-0">
              {sendingCode ? "Sending a code to " : codeSent ? "We sent a code to " : "Sending a code to "}
              <b>{step1Value("email")}</b>
              {!sendingCode && ". Enter it below to continue."}
            </p>
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={emailCode}
              onChange={(e) => {
                setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                if (codeError) setCodeError("");
              }}
            />
            {codeError && <div className="field-error">{codeError}</div>}
            <div className="d-flex gap-10px">
              <button type="button" className="ep-b" data-v="p" disabled={verifyingCode} onClick={verifyCode}>
                {verifyingCode ? "Verifying…" : "Verify"}
              </button>
              <button
                type="button"
                className="ep-b"
                disabled={sendingCode || !vendorId || !registrationToken}
                onClick={() => vendorId && registrationToken && sendCode(vendorId, registrationToken)}
              >
                {sendingCode ? "Sending…" : "Resend Code"}
              </button>
            </div>
          </div>
        )}

        <div className="d-flex flex-col gap-18px" hidden={step !== 2} ref={step2Ref}>
          <div className="ep-k">Documents · PDF, JPG or PNG, max 2 MB each (the catalogue may also be a spreadsheet) · each uploads as soon as you pick it</div>
          <DocumentDropzones docState={docState} invalidTypes={invalidTypes} onPick={uploadDoc} />
          <div className="ep-pane">
            <div className="ep-pane-head">
              <span>Other Documents</span>
            </div>
            <div className="ep-pane-pad">
              <p className="hint margin-0-0-10px">Anything else you'd like to include — name it and attach the file. Add as many as you need.</p>
              <OtherDocsSection ref={otherDocsRef} vendorId={vendorId} registrationToken={registrationToken} />
              <button type="button" className="ep-b mt-10px" onClick={() => otherDocsRef.current?.addRow()}>
                + Add another document
              </button>
            </div>
          </div>
          <div className="d-flex gap-10px">
            <button type="button" className="ep-b" onClick={() => goToStep(1)}>
              ← Back to basic info
            </button>
            <button type="submit" className="ep-b" data-v="p" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit for verification"}
            </button>
          </div>
        </div>
      </form>
      {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
    </>
  );
}
