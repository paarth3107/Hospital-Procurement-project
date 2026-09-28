"""Spec §6.3.1-6.3.3 type-specific tender line-item fields. Mirrors
app/schemas/product_attrs.py's pattern exactly (one model per procurement
type, all fields optional, extra="forbid"): a hospital fills in what applies
to this tender line, on top of the catalog entry's own general defaults
(app/schemas/product_attrs.py) -- e.g. a catalog Service's `sla_uptime_pct`
is a reference default, this line's `sla_uptime_pct` is what this specific
tender actually requires.

`delivery_date`/`delivery_location` are shared verbatim between Item and
Asset (spec calls the Asset version "delivery/installation date & location",
same concept) because app/services/po_files.py already reads
`line_details["delivery_location"]` for the PO data file's "Delivery /
Service Terms" field -- keeping one key name means both types populate it.

Spec §6.3.3's Service "License / IP Terms (Software lines)" bullet largely
repeats fields the catalog's ServiceAttrs software sub-schema already
captures at the product level (license type/tenure, seats, source-code
escrow, IP assignment, data residency...); re-modeling all of that again per
tender line would be pure duplication for marginal benefit, so it's
collapsed here into one free-text notes field for this tender's own
adjustments, the same "master spec + line-specific override notes" shape as
Item's technical_spec_override."""

from datetime import date

from pydantic import BaseModel, ConfigDict
from typing import Literal

from app.models.product_master import ProcurementType


class _LineDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ItemLineDetails(_LineDetails):
    hsn_sac_code: str | None = None
    alternate_brand_allowed: bool | None = None
    delivery_date: date | None = None
    delivery_location: str | None = None
    technical_spec_override: str | None = None


class AssetLineDetails(_LineDetails):
    required_certifications: list[str] | None = None
    brand_restriction: str | None = None
    warranty_requirement_months: float | None = None
    amc_cmc_arrangement: Literal["this_line", "linked_service_line", "none"] | None = None
    installation_notes: str | None = None
    training_required: bool | None = None
    training_details: str | None = None
    spares_commitment_months: float | None = None
    exchange_buyback: bool | None = None
    exchange_asset_reference: str | None = None
    delivery_date: date | None = None
    delivery_location: str | None = None


class ServiceLineDetails(_LineDetails):
    scope_of_work: str | None = None
    tenure_months: float | None = None
    renewal_terms: str | None = None
    sla_response_time_hours: float | None = None
    sla_uptime_pct: float | None = None
    sla_resolution_time_hours: float | None = None
    sla_penalty_clauses: str | None = None
    billing_basis: Literal["fixed", "consumption", "milestone"] | None = None
    manpower_deployment_norms: str | None = None
    background_verification_required: bool | None = None
    statutory_compliance_notes: str | None = None
    insurance_requirement: str | None = None
    exit_transition_clause: str | None = None
    service_locations: list[str] | None = None
    license_ip_terms_notes: str | None = None


LINE_DETAILS_BY_TYPE: dict[ProcurementType, type[_LineDetails]] = {
    ProcurementType.ITEM: ItemLineDetails,
    ProcurementType.ASSET: AssetLineDetails,
    ProcurementType.SERVICE: ServiceLineDetails,
}
