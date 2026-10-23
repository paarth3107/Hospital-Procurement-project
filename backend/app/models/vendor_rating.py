from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base, UTCDateTime
from app.models.product_master import ProcurementType

# Spec §5.2 — illustrative seed weights, explicitly "to be finalized with
# hospital procurement policy" (spec §15, and IMPLEMENTATION-SPEC.md open
# question 4). Centralized here rather than hardcoded inline at each call
# site, so moving this to a per-hospital config table later is a one-place
# change, not a hunt-and-replace.
RATING_WEIGHTS = {
    "on_time_pct": 0.25,
    "quality_pct": 0.25,
    "price_competitiveness": 0.20,
    "compliance_pct": 0.15,
    "responsiveness": 0.15,
}

# Spec §5.3.1 point 2: a manual entry that changes "materially" from its
# prior value needs a mandatory comment. The spec doesn't define "material"
# numerically — this is a placeholder threshold, not a spec value.
MATERIAL_CHANGE_THRESHOLD = 5.0

# Spec §5.3.1 point 5: flag staleness after an overdue window. Not spec'd
# numerically either.
STALE_AFTER_DAYS = 90

# Spec §5.3: "New vendors with no transaction history receive a provisional/
# default score and are flagged 'Unrated'" -- the spec names this concept but
# never gives it a number (confirmed 2026-10-23 by reading the whole
# document: no default rating value is specified anywhere). 50.0 is a
# stand-in, user-directed, pending real figures from hospital policy --
# flagged in CLAUDE.md and .claude-notes/GAPS.md, do not treat as settled.
# Purely a display/placeholder value: `is_unrated` (not this number) is what
# actually drives eligibility gating and ranking (services/eligibility.py).
UNRATED_DEFAULT_SCORE = 50.0


class VendorRating(Base):
    """One rating per (vendor, procurement type): a vendor can be excellent
    at supplying Items and mediocre at Services (spec §4.3: "hold different
    ratings across each Procurement Type")."""

    __tablename__ = "vendor_ratings"
    __table_args__ = (UniqueConstraint("vendor_id", "procurement_type", name="uq_vendor_rating_type"),)

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False)
    procurement_type = Column(Enum(ProcurementType), nullable=False)

    # System-computed (spec §5.3) — the only auto sub-score, from this
    # system's own bid history (rolling 12-month window). Nullable like the
    # 4 manual fields below (2026-10-23, user-directed -- previously
    # defaulted to 50.0 and could never be null, which meant a brand-new
    # vendor with zero real history still got a 100%-weighted, fabricated
    # "50" instead of recompute_overall()'s existing missing-field handling
    # applying to it the way it already does for the other 4). Null until a
    # real PriceCompetitivenessRecord exists for this vendor/type.
    price_competitiveness = Column(Float, nullable=True)

    # Manually entered by Category Manager (spec §5.3.1) — not overrides,
    # ordinary data entry, still logged to history.
    on_time_pct = Column(Float, nullable=True)
    quality_pct = Column(Float, nullable=True)
    compliance_pct = Column(Float, nullable=True)
    responsiveness = Column(Float, nullable=True)

    overall_score = Column(Float, nullable=False, default=0.0)
    # There is no separate "Provisional" state (2026-10-23, user-directed,
    # matching spec exactly -- an earlier is_provisional column/UI tier was
    # removed). A vendor is either Unrated, or rated on whatever real data
    # currently exists -- no in-between label. Spec §5.3 point 5: "New
    # vendors... receive a provisional/default score and are flagged
    # 'Unrated' until a minimum number of POs are completed AND at least one
    # manual entry cycle has occurred" -- both conditions, not "any single
    # field present" (the looser rule this used to use). Eligibility
    # filtering (services/eligibility.py) treats Unrated as not meeting any
    # rating minimum above 0, rather than silently scoring them as average.
    is_unrated = Column(Boolean, nullable=False, default=True)

    last_manual_update_at = Column(UTCDateTime(), nullable=True)
    # Real bug, found 2026-10-16 -- see audit_log.py's AuditLog.occurred_at
    # for the full explanation (server_default=func.now() used the DB
    # server's own local timezone instead of true UTC).
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))

    vendor = relationship("Vendor")
    history = relationship("RatingHistory", back_populates="rating", cascade="all, delete-orphan")

    def recompute_overall(self) -> None:
        """Weighted composite (spec §5.3 point 3). Any sub-score not yet
        entered is excluded and the remaining weights are re-normalized,
        rather than treating a missing manual entry as a zero — a brand-new
        vendor with no manual entries yet shouldn't be scored as if every
        unentered parameter failed. price_competitiveness is just another
        field in this same loop now (2026-10-23) -- it used to be hardcoded
        always-present (see the column comment above for why that was wrong).

        is_unrated (2026-10-23, matching spec exactly -- see the column
        comment) requires BOTH real price history AND at least one manual
        entry, not just "any single field present." While Unrated, the
        stored score is always the UNRATED_DEFAULT_SCORE placeholder, never a
        partial real computation -- showing a half-computed "real" number
        while also flagging the vendor Unrated would contradict the flag."""

        available = {}
        for field in ("price_competitiveness", "on_time_pct", "quality_pct", "compliance_pct", "responsiveness"):
            value = getattr(self, field)
            if value is not None:
                available[field] = value

        has_price_history = self.price_competitiveness is not None
        has_manual_entry = any(f in available for f in ("on_time_pct", "quality_pct", "compliance_pct", "responsiveness"))
        self.is_unrated = not (has_price_history and has_manual_entry)

        if self.is_unrated:
            self.overall_score = UNRATED_DEFAULT_SCORE
            return
        total_weight = sum(RATING_WEIGHTS[f] for f in available)
        self.overall_score = sum(RATING_WEIGHTS[f] * v for f, v in available.items()) / total_weight

    @property
    def is_stale(self) -> bool:
        """Spec §5.3.1 point 5: "Stale — Manual Update Due" once the manual
        parameters haven't been refreshed in STALE_AFTER_DAYS. An Unrated
        vendor can't be Stale either way -- there's nothing to have gone
        overdue yet."""

        if self.last_manual_update_at is None:
            return False
        age = datetime.now(timezone.utc) - self.last_manual_update_at
        return age.days > STALE_AFTER_DAYS


class RatingHistory(Base):
    """Spec §5.3.1 point 3: prior values are retained, never overwritten."""

    __tablename__ = "rating_history"

    id = Column(Integer, primary_key=True)
    rating_id = Column(Integer, ForeignKey("vendor_ratings.id"), nullable=False)
    field = Column(String(255), nullable=False)
    old_value = Column(Float, nullable=True)
    new_value = Column(Float, nullable=False)
    comment = Column(Text, nullable=True)
    entered_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    entered_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))

    rating = relationship("VendorRating", back_populates="history")


class PriceCompetitivenessRecord(Base):
    """Spec §5.2/§5.3: one row per bid, feeding the *only* rating sub-score
    the system computes itself. Written when a line's technical evaluation is
    closed (spec §9.6 -- prices are sealed until then, so a bid's price can't
    tell us anything about competitiveness before that moment) and at least
    one other bid on the same line was also technically qualified (with only
    one qualified bid there is nothing to compare against). The value is this
    bid's price relative to the lowest qualified bid on its line -- the same
    "lowest scores 100, others scored proportionally against it" formula spec
    §9.4 already uses for QCBS price scoring, reused here for consistency
    rather than inventing a second definition of "price competitive".

    `recorded_at` is what ages a row out of the rolling window (spec §5.3:
    "a rolling window (e.g., trailing 12 months)... so old bid history ages
    out"); rows are never deleted, only excluded from the average once stale,
    so the trail stays auditable."""

    __tablename__ = "price_competitiveness_records"
    __table_args__ = (UniqueConstraint("bid_id", name="uq_price_competitiveness_bid"),)

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False, index=True)
    procurement_type = Column(Enum(ProcurementType), nullable=False)
    bid_id = Column(Integer, ForeignKey("bids.id"), nullable=False)
    tender_line_item_id = Column(Integer, ForeignKey("tender_line_items.id"), nullable=False)
    price_score = Column(Float, nullable=False)  # 0-100: this bid vs. the lowest qualified bid on its line
    recorded_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))
