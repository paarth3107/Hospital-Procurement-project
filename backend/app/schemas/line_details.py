"""Spec §6.3.1-6.3.3 type-specific tender line-item fields. Mirrors
app/schemas/product_attrs.py's pattern (one model per procurement type, all
fields optional, extra="forbid"), but does NOT re-ask anything the catalog
entry (app/schemas/product_attrs.py) already answers -- a hospital fills in
only what's genuinely specific to this tender/engagement, on top of the
catalog's own general spec. Read the catalog entry's type_specific_attrs
for the master data (certifications, warranty, SOW template, SLA terms,
billing basis, manpower norms, AMC/CMC arrangement, brand/substitution
policy, insurance, renewal/exit terms...); this file only has fields with no
catalog equivalent, or ones that legitimately vary per engagement even for
the same catalog entry (2026-10-01, user-directed: "pull everything we can
from the master item data and ask for the tender specific things").

`comments` exists identically on all three types -- a single free-text
"anything else for this line" box, replacing the old Item-only
`technical_spec_override` (2026-10-01, user-directed: a generic notes field
fits better than a fake "technical override" framing, and there's no reason
Asset/Service lines couldn't use the same thing).

`delivery_date`/`delivery_location` are shared verbatim between Item and
Asset (spec calls the Asset version "delivery/installation date & location",
same concept) because app/services/po_files.py already reads
`line_details["delivery_location"]` for the PO data file's "Delivery /
Service Terms" field -- keeping one key name means both types populate it."""

from datetime import date

from pydantic import BaseModel, ConfigDict

from app.models.product_master import ProcurementType


class _LineDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comments: str | None = None


class ItemLineDetails(_LineDetails):
    # hsn_sac_code and alternate_brand_allowed are NOT here -- both are fixed
    # catalog classification facts (tax code; generic-substitution policy for
    # this item), not things that vary per tender (2026-10-01, user-directed).
    delivery_date: date | None = None
    delivery_location: str | None = None


class AssetLineDetails(_LineDetails):
    # required_certifications, warranty_requirement_months, brand_restriction,
    # installation_notes, training_required/details, spares_commitment_months,
    # insurance_requirement, and the AMC/CMC arrangement are NOT here -- they're
    # all fixed facts about the asset itself (its certs, warranty, brand
    # policy, install/training/spares/insurance needs, and which maintenance
    # contract it needs and how it's procured) rather than per-tender choices
    # (app/schemas/product_attrs.py). This tender line only asks for what the
    # catalog entry can't already answer (2026-10-01, user-directed: pull
    # what's on the master item, only ask for the genuinely tender-specific bits).
    exchange_buyback: bool | None = None
    exchange_asset_reference: str | None = None
    delivery_date: date | None = None
    delivery_location: str | None = None


class ServiceLineDetails(_LineDetails):
    # scope_of_work, sla_response_time_hours, sla_uptime_pct, sla_resolution_time_hours,
    # sla_penalty_clauses, billing_basis, manpower_deployment_norms,
    # background_verification_required, statutory_compliance_notes,
    # renewal_terms, insurance_requirement, exit_transition_clause, and
    # license_ip_terms_notes are NOT here -- they're all standing policy for
    # this service category (app/schemas/product_attrs.py), or
    # (license_ip_terms_notes) fully covered by the catalog's software-specific
    # fields plus the vendor's own bid attachments (2026-10-01, user-directed).
    # A Service line's mandatory SOW (spec §6.3.5) is a catalog-completeness
    # check (see tenders.py's submit-for-approval), not a line-item field.
    tenure_months: float | None = None  # catalog's default_tenure_months is a default, not authoritative -- a specific engagement's term legitimately varies
    service_locations: list[str] | None = None


LINE_DETAILS_BY_TYPE: dict[ProcurementType, type[_LineDetails]] = {
    ProcurementType.ITEM: ItemLineDetails,
    ProcurementType.ASSET: AssetLineDetails,
    ProcurementType.SERVICE: ServiceLineDetails,
}
