"""Spec 4.2.1 / 4.2.2 type-specific attribute sets. One model per
procurement type, all fields optional (a hospital fills what applies), and
extra="forbid" so an Item can't be saved carrying Asset-only keys."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.product_master import ProcurementType


class _Attrs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ItemAttrs(_Attrs):
    pack_size: str | None = None
    shelf_life_tracking: bool | None = None
    storage_condition: str | None = None  # e.g. "Cold chain 2-8 C"
    hsn_sac_code: str | None = None  # spec §6.3.3: "auto-populated from Master, editable" -- lives here, not per tender line
    # 2026-10-01, user-directed: whether generic/equivalent substitution is
    # acceptable is a formulary/classification judgment about the item itself
    # (e.g. any brand is fine for a given salt) -- fixed once, not per tender.
    alternate_brand_allowed: bool | None = None


class AssetAttrs(_Attrs):
    asset_category: str | None = None
    expected_useful_life_years: float | None = None
    warranty_months: float | None = None
    installation_required: bool | None = None
    compliance_certifications: list[str] | None = None  # CE, BIS, ISO, FDA...
    site_readiness: str | None = None  # power, space, civil work prerequisites
    # 2026-10-01, user-directed: these were asked per tender line, but they're
    # properties of the asset itself (does this equipment need training to
    # operate, how long must spares stay available) -- fixed once, not per deal.
    training_required: bool | None = None
    training_details: str | None = None  # sessions, duration
    spares_commitment_months: float | None = None
    insurance_requirement: str | None = None  # transit/installation liability etc., if any
    # Replaces the old bare amc_cmc_applicable bool (2026-10-01, user-directed):
    # which maintenance arrangement an asset needs is a judgment about its own
    # failure profile (equipment that wears/breaks often -> CMC; stable
    # equipment that still needs regular servicing, e.g. an MRI -> AMC) --
    # fixed once on the asset, not re-decided per tender. Change it here if a
    # asset turns out to need more/less attention than first assumed.
    amc_cmc_type: Literal["none", "amc", "cmc"] | None = None
    amc_cmc_procurement: Literal["bundled_with_purchase", "separate_service_tender"] | None = None  # only meaningful when amc_cmc_type isn't "none"


class ServiceAttrs(_Attrs):
    sow_template: str | None = None
    default_tenure_months: float | None = None
    renewal_terms: str | None = None
    sla_response_time_hours: float | None = None
    sla_uptime_pct: float | None = None
    sla_resolution_time_hours: float | None = None
    sla_penalty_clauses: str | None = None
    billing_basis: Literal["fixed", "consumption", "milestone"] | None = None
    manpower_deployment_norms: str | None = None
    insurance_requirement: str | None = None  # vendor liability/indemnity, if any
    exit_transition_clause: str | None = None
    # 2026-10-01, user-directed: standing policy for this service category
    # (e.g. housekeeping/security always needs background-verified staff),
    # not a per-contract decision -- moved here from the tender line.
    background_verification_required: bool | None = None
    statutory_compliance_notes: str | None = None  # police verification, PF/ESI...

    # 4.2.2 -- software sub-categories of Service.
    software_kind: Literal["development", "licensing"] | None = None
    # Software Development / Custom Build
    deliverables_sow: str | None = None
    source_code_ownership_escrow: str | None = None
    ip_assignment: str | None = None
    acceptance_testing_criteria: str | None = None
    warranty_defect_fix_period: str | None = None
    post_go_live_support: str | None = None
    technology_stack_constraints: str | None = None
    # Software Licensing (COTS/SaaS)
    license_type: Literal["perpetual", "subscription", "saas"] | None = None
    license_tenure_renewal: str | None = None
    seats_or_usage_tier: str | None = None
    deployment_model: Literal["on_prem", "cloud", "hybrid"] | None = None
    data_residency_dpdp: str | None = None
    support_sla_tier: str | None = None
    upgrade_patch_policy: str | None = None
    exit_data_portability: str | None = None


ATTRS_BY_TYPE: dict[ProcurementType, type[_Attrs]] = {
    ProcurementType.ITEM: ItemAttrs,
    ProcurementType.ASSET: AssetAttrs,
    ProcurementType.SERVICE: ServiceAttrs,
}
