import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { refreshChrome } from "../../lib/bridge";
import { StateTag } from "../../components/Tag";
import { ImgPlaceholder } from "../../components/ImgPlaceholder";
import type { VendorDetail } from "../../lib/types";
import { DocumentVaultPanel } from "./DocumentVaultPanel";

// Ported 1:1 from frontend/js/pages/vendorProfilePage.js -- company profile
// & documents: read-only company details on the left, the document vault
// on the right. Category declaration is its own tab -- a different concern
// from KYC document review. Commercial terms are the one editable bit of
// an otherwise read-only profile (optional, spec §3.2 -- not collected at
// registration, so this is the only place a vendor can ever set it).
function Field({ label, value, span = 1 }: { label: string; value: string | number | null | undefined; span?: number }) {
  return (
    <div className={`col-span-${span}`}>
      <div className="ep-k mb-4px">{label}</div>
      <div className="ep-box">{value || "—"}</div>
    </div>
  );
}

function CommercialTermsForm({ vendor, onSaved }: { vendor: VendorDetail; onSaved: (v: VendorDetail) => void }) {
  const [paymentTerms, setPaymentTerms] = useState(vendor.payment_terms || "");
  const [leadTime, setLeadTime] = useState(vendor.delivery_lead_time_days != null ? String(vendor.delivery_lead_time_days) : "");
  const [minOrder, setMinOrder] = useState(vendor.min_order_value != null ? String(vendor.min_order_value) : "");
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null);

  const save = async () => {
    const num = (v: string) => (v === "" ? null : Number(v));
    const body = { payment_terms: paymentTerms.trim() || null, delivery_lead_time_days: num(leadTime), min_order_value: num(minOrder) };
    try {
      const v = await api<VendorDetail>("/vendor-portal/commercial-terms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      onSaved(v);
      setResult({ message: "Saved.", ok: true });
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : String(err), ok: false });
    }
  };

  return (
    <div className="ep-pane ep-pane-pad">
      <div className="fs-14px fw-800 mb-4px">Commercial terms (optional)</div>
      <p className="hint margin-0-0-12px">Shown to staff for reference; nothing here gates your bidding.</p>
      <div className="d-grid grid-cols-1fr-1fr gap-13px-16px">
        <div>
          <div className="ep-k mb-4px">Standard payment terms</div>
          <input className="input" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
        </div>
        <div>
          <div className="ep-k mb-4px">Delivery lead time (days)</div>
          <input className="input" type="number" min={0} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
        </div>
        <div className="col-span-2">
          <div className="ep-k mb-4px">Minimum order value (₹)</div>
          <input className="input" type="number" min={0} step="any" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
        </div>
      </div>
      <div className="mt-12px d-flex items-center gap-12px">
        <button className="ep-b" data-v="p" onClick={save}>
          Save commercial terms
        </button>
        {result && <div className={`result ${result.ok ? "ok" : "err"}`}>{result.message}</div>}
      </div>
    </div>
  );
}

export function VendorProfilePage() {
  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setVendor(await api<VendorDetail>("/vendor-auth/me"));
      setError("");
    } catch (err) {
      setError("Could not load profile: " + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="result err">{error}</div>;
  if (!vendor) return null;

  return (
    <div className="ep-grid grid-cols-1fr-1fr">
      <div className="d-flex flex-col gap-18px">
        <div className="ep-pane ep-pane-pad">
          <div className="fs-14px fw-800 mb-14px d-flex justify-between items-center">
            Company &amp; statutory details <StateTag state={vendor.status} />
          </div>
          <div className="d-flex items-center gap-14px mb-16px">
            <ImgPlaceholder iconName="image" size="md" />
            <div className="ep-sub">Company logo — reserved for later, no upload yet</div>
          </div>
          <div className="d-grid grid-cols-1fr-1fr gap-13px-16px">
            <Field label="Legal name" value={vendor.legal_name} span={2} />
            <Field label="Trade name" value={vendor.trade_name} />
            <Field label="Entity type" value={vendor.entity_type} />
            <Field label="Year of incorporation" value={vendor.year_of_incorporation} />
            <Field label="GSTIN" value={vendor.gstin} />
            <Field label="PAN" value={vendor.pan} />
            <Field label="Website" value={vendor.website} />
            <Field label="Address line" value={vendor.registered_address} span={2} />
            <Field label="City" value={vendor.city} />
            <Field label="State" value={vendor.state} />
            <Field label="Pincode" value={vendor.pincode} />
            <Field label="Alternate / correspondence address" value={vendor.alternate_address} span={2} />
            <Field label="Branch locations" value={vendor.branch_locations} span={2} />
            <Field label="Bank" value={[vendor.bank_name, vendor.bank_ifsc].filter(Boolean).join(" · ")} />
            <Field label="Account number" value={vendor.bank_account_number} />
            <Field label="Primary contact" value={[vendor.contact_person, vendor.contact_designation].filter(Boolean).join(", ")} />
            <Field label="Phone" value={vendor.phone} />
            <Field label="Email (login)" value={vendor.email} span={2} />
            <Field
              label="Escalation contact"
              value={[vendor.escalation_contact_name, vendor.escalation_contact_phone, vendor.escalation_contact_email].filter(Boolean).join(" · ")}
              span={2}
            />
            {vendor.rejection_reason && <Field label="Note on file" value={vendor.rejection_reason} span={2} />}
          </div>
        </div>
        <CommercialTermsForm vendor={vendor} onSaved={setVendor} />
      </div>
      <div className="d-flex flex-col gap-18px">
        <DocumentVaultPanel onChanged={refreshChrome} />
      </div>
    </div>
  );
}
