import { useState } from "react";
import { fmtDate } from "../../lib/format";
import type { VendorDetail } from "../../lib/types";
import { ImgPlaceholder } from "../../components/ImgPlaceholder";
import { StateTag } from "../../components/Tag";
import { RevealPasswordDialog } from "./RevealPasswordDialog";

// Ported 1:1 from frontend/js/pages/vendorViewPage.js's identityPane().
const money = (n: number | null) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN"));

type Fact = [string, string | number | null | undefined, number?, string?]; // label, value, colSpan, secretField

export function IdentityPane({ v }: { v: VendorDetail }) {
  const [revealing, setRevealing] = useState<{ field: string; label: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const groups: [string, Fact[]][] = [
    [
      "Company",
      [
        ["Trade name", v.trade_name],
        ["Entity type", v.entity_type],
        ["Incorporated", v.year_of_incorporation],
        ["Vendor ID", `V-${v.id}`],
        ["Website", v.website],
        ["Address line", v.registered_address, 2],
        ["City", v.city],
        ["State", v.state],
        ["Pincode", v.pincode],
        ["Alternate / correspondence address", v.alternate_address, 2],
        ["Branch locations", v.branch_locations, 2],
      ],
    ],
    [
      "Statutory & banking",
      [
        ["GSTIN", v.gstin, 1, "gstin"],
        ["PAN", v.pan, 1, "pan"],
        ["Bank", v.bank_name],
        ["IFSC", v.bank_ifsc, 1, "bank_ifsc"],
        ["Account number", v.bank_account_number, 2, "bank_account_number"],
      ],
    ],
    [
      "Contact",
      [
        ["Primary contact", v.contact_person],
        ["Designation", v.contact_designation],
        ["Phone", v.phone, 1, "phone"],
        ["Email", v.email],
        ["Escalation contact", [v.escalation_contact_name, v.escalation_contact_email].filter(Boolean).join(" · ") || null, 1],
        ["Escalation phone", v.escalation_contact_phone, 1, "escalation_contact_phone"],
      ],
    ],
    [
      "Commercial terms",
      [
        ["Payment terms", v.payment_terms],
        ["Lead time", v.delivery_lead_time_days != null ? `${v.delivery_lead_time_days} days` : null],
        ["Min. order value", v.min_order_value != null ? money(v.min_order_value) : null],
        ["Note on file", v.rejection_reason],
      ],
    ],
  ];

  return (
    <div className="ep-pane ep-pane-pad">
      <div className="d-flex items-start gap-16px">
        <ImgPlaceholder size="md" />
        <div className="flex-1">
          <div className="ep-k">
            V-{v.id} · applied {fmtDate(v.created_at)}
          </div>
          <h4 className="margin-4px-0-3px fs-22px">{v.legal_name}</h4>
        </div>
        <div className="text-right">
          <div className="ep-k">Current status</div>
          <div className="mt-5px">
            <StateTag state={v.status} />
          </div>
        </div>
      </div>
      {groups.map(([title, facts]) => (
        <div key={title}>
          <div className="h-2px bg-ink-40 margin-16px-0-12px"></div>
          <div className="ep-k">{title}</div>
          <div className="d-grid grid-cols-repeat41fr gap-14px-16px mt-8px">
            {facts.map(([k, val, span, secret]) => {
              const revealedValue = secret ? revealed[secret] : undefined;
              const displayVal = revealedValue ?? val;
              return (
                <div className={`col-span-${span || 1}`} key={k}>
                  <div className="ep-k">{k}</div>
                  <div className="fs-13px fw-600 mt-3px break-word">
                    {secret && val != null ? (
                      <>
                        <span>{displayVal}</span>{" "}
                        {revealedValue === undefined && (
                          <button
                            type="button"
                            className="ep-b padding-0-7px italic font-serif"
                            title="Show (asks for your password)"
                            aria-label={`Show ${k}`}
                            onClick={() => setRevealing({ field: secret, label: k })}
                          >
                            i
                          </button>
                        )}
                      </>
                    ) : (
                      (displayVal ?? "—")
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {revealing && (
        <RevealPasswordDialog
          vendorId={v.id}
          field={revealing.field}
          label={revealing.label}
          onClose={() => setRevealing(null)}
          onRevealed={(value) => setRevealed((r) => ({ ...r, [revealing.field]: value }))}
        />
      )}
    </div>
  );
}
