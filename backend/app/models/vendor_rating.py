from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.database import Base

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


class VendorRating(Base):
    __tablename__ = "vendor_ratings"

    id = Column(Integer, primary_key=True)
    vendor_id = Column(Integer, ForeignKey("vendors.id"), nullable=False, unique=True)

    # System-computed (spec §5.3) — the only auto sub-score. With no bid
    # history yet (tenders/bidding are a later phase), this stays at a
    # provisional default rather than being fabricated; recompute() is a
    # real function, just has nothing to compute from yet.
    price_competitiveness = Column(Float, nullable=False, default=50.0)

    # Manually entered by Procurement Admin (spec §5.3.1) — not overrides,
    # ordinary data entry, still logged to history.
    on_time_pct = Column(Float, nullable=True)
    quality_pct = Column(Float, nullable=True)
    compliance_pct = Column(Float, nullable=True)
    responsiveness = Column(Float, nullable=True)

    overall_score = Column(Float, nullable=False, default=0.0)
    is_provisional = Column(Boolean, nullable=False, default=True)

    last_manual_update_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    vendor = relationship("Vendor")
    history = relationship("RatingHistory", back_populates="rating", cascade="all, delete-orphan")

    def recompute_overall(self) -> None:
        """Weighted composite (spec §5.3 point 3). Any sub-score not yet
        entered is excluded and the remaining weights are re-normalized,
        rather than treating a missing manual entry as a zero — a brand-new
        vendor with no manual entries yet shouldn't be scored as if every
        unentered parameter failed."""

        available = {"price_competitiveness": self.price_competitiveness}
        for field in ("on_time_pct", "quality_pct", "compliance_pct", "responsiveness"):
            value = getattr(self, field)
            if value is not None:
                available[field] = value

        total_weight = sum(RATING_WEIGHTS[f] for f in available)
        if total_weight == 0:
            self.overall_score = 0.0
            return
        self.overall_score = sum(RATING_WEIGHTS[f] * v for f, v in available.items()) / total_weight
        self.is_provisional = len(available) < len(RATING_WEIGHTS)

    @property
    def is_stale(self) -> bool:
        """Spec §5.3.1 point 5: "Stale — Manual Update Due" once the manual
        parameters haven't been refreshed in STALE_AFTER_DAYS. A vendor that
        has never been manually rated is Provisional (a different flag,
        above) rather than Stale — there's nothing to have gone overdue."""

        if self.last_manual_update_at is None:
            return False
        age = datetime.now(timezone.utc) - self.last_manual_update_at
        return age.days > STALE_AFTER_DAYS


class RatingHistory(Base):
    """Spec §5.3.1 point 3: prior values are retained, never overwritten."""

    __tablename__ = "rating_history"

    id = Column(Integer, primary_key=True)
    rating_id = Column(Integer, ForeignKey("vendor_ratings.id"), nullable=False)
    field = Column(String, nullable=False)
    old_value = Column(Float, nullable=True)
    new_value = Column(Float, nullable=False)
    comment = Column(Text, nullable=True)
    entered_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    entered_at = Column(DateTime(timezone=True), server_default=func.now())

    rating = relationship("VendorRating", back_populates="history")
