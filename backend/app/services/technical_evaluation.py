"""Technical evaluation rules (spec §9.2): the scoring criteria, how several
evaluators' scores are consolidated, who qualifies, and the T-ranking. Prices
are never touched here -- they open only after a line's technical evaluation
is closed (spec §9.6), and that step belongs to commercial evaluation."""

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.bid import Bid, BidStatus
from app.models.bid_evaluation import BidEvaluation, BidTechnicalResult, TechnicalDecision
from app.models.product_master import ProcurementType
from app.models.tender_line_item import TechnicalEvalMethod, TenderLineItem
from app.services.ratings import rating_score

# Spec 9.2.5: minimum qualifying technical score (e.g. 60/100), "configurable per
# line item". There is no per-line field yet, so this default applies to all.
# Evaluators score every criterion 0-100 on every line type (spec 100-point scale).
DEFAULT_MIN_TECHNICAL_SCORE = 60.0  # out of 100


@dataclass(frozen=True)
class Criterion:
    key: str
    label: str
    weight: float
    auto: bool = False  # filled from the vendor's Module 3 rating, not typed by an evaluator
    optional: bool = False  # e.g. past performance, "if history exists"


# Spec 9.2.2's illustrative weights per procurement type. They don't add to 100
# for every type, so the weighted score is normalised over the criteria that
# apply (score = sum(w*s) / sum(w)). OPEN QUESTION: final weights per category.
CRITERIA: dict[ProcurementType, list[Criterion]] = {
    ProcurementType.ITEM: [
        Criterion("spec_compliance", "Compliance to technical specification", 35),
        Criterion("vendor_rating", "Vendor's current rating", 15, auto=True),
        Criterion("past_performance", "Past performance on similar items", 15, optional=True),
    ],
    ProcurementType.ASSET: [
        Criterion("spec_compliance", "Compliance to technical specification", 35),
        Criterion("vendor_rating", "Vendor's current rating", 15, auto=True),
        Criterion("warranty_serviceability", "Warranty, spares / serviceability commitment, training plan", 20),
        Criterion("manufacturer_authorization", "Manufacturer authorization / brand certification", 10),
        Criterion("past_performance", "Past performance on similar assets", 15, optional=True),
    ],
    ProcurementType.SERVICE: [
        Criterion("spec_compliance", "Compliance to technical specification", 35),
        Criterion("vendor_rating", "Vendor's current rating", 15, auto=True),
        Criterion("sow_sla_quality", "Proposed SOW / method statement and SLA commitment", 20),
        Criterion("manpower_compliance", "Manpower deployment plan and statutory compliance readiness", 15),
        Criterion("past_performance", "Past performance on similar services", 15, optional=True),
    ],
}


def is_scored(line: TenderLineItem) -> bool:
    return line.technical_eval_method != TechnicalEvalMethod.QUALIFY_DISQUALIFY


def manual_criteria(ptype: ProcurementType) -> list[Criterion]:
    return [c for c in CRITERIA[ptype] if not c.auto]


def clean_scores(ptype: ProcurementType, raw: dict) -> dict:
    """Validates an evaluator's typed scores: only known criteria, 0 to 100, and
    every non-optional manual criterion present."""
    allowed = {c.key: c for c in manual_criteria(ptype)}
    out = {}
    for key, value in (raw or {}).items():
        if key not in allowed:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown criterion '{key}'")
        if value is None or value == "":
            continue
        if not 0 <= float(value) <= 100:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"'{allowed[key].label}' must be scored 0 to 100")
        out[key] = float(value)
    missing = [c.label for c in allowed.values() if not c.optional and c.key not in out]
    if missing:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Score every criterion — missing: " + "; ".join(missing))
    return out


def weighted_score(ptype: ProcurementType, scores: dict, vendor_rating: float) -> float:
    """Weighted average out of 100; the vendor's Module 3 rating (0-100) is the
    automatic criterion's score."""
    total_w = total = 0.0
    for c in CRITERIA[ptype]:
        s = vendor_rating if c.auto else scores.get(c.key)
        if s is None:
            continue
        total_w += c.weight
        total += c.weight * s
    return round(total / total_w, 2) if total_w else 0.0


@dataclass
class Consolidated:
    bid: Bid
    outcome: TechnicalDecision
    score: float | None
    reason: str | None
    rating: float


def consolidate(line: TenderLineItem, bid: Bid, evals: list[BidEvaluation], db: Session) -> Consolidated:
    """Spec 9.2.3 steps 3-5. Any evaluator disqualifying disqualifies the bid.
    On every line the consolidated score is the simple average of the
    evaluators' weighted scores (out of 100) and must reach the minimum. Only
    technically scored lines (scored / QCBS) then get T1, T2... ranks; on a
    standard line all qualified bids stand on equal footing (spec 9.2.1). (Exclude-outlier
    averaging is the spec's other method; not built.)"""
    rating = rating_score(bid.vendor_id, line.procurement_type, db)
    disq = [e for e in evals if e.decision == TechnicalDecision.DISQUALIFIED]
    if disq:
        return Consolidated(bid, TechnicalDecision.DISQUALIFIED, None, "; ".join(e.comments for e in disq if e.comments) or "Disqualified by evaluator", rating)
    score = round(sum(e.weighted_score or 0 for e in evals) / len(evals), 2)
    if score < DEFAULT_MIN_TECHNICAL_SCORE:
        return Consolidated(bid, TechnicalDecision.DISQUALIFIED, score, f"Score {score:g} out of 100 is below the minimum qualifying score of {DEFAULT_MIN_TECHNICAL_SCORE:g}", rating)
    return Consolidated(bid, TechnicalDecision.QUALIFIED, score, None, rating)


def submitted_bids(line: TenderLineItem, db: Session) -> list[Bid]:
    return db.query(Bid).filter(Bid.tender_line_item_id == line.id, Bid.status == BidStatus.SUBMITTED).order_by(Bid.submitted_at).all()


def deadline_passed(line: TenderLineItem) -> bool:
    due = line.tender.bid_due_date
    return due is not None and datetime.now(timezone.utc) > due


def close_technical(line: TenderLineItem, closer_id: int, db: Session) -> list[BidTechnicalResult]:
    """Records qualification for every submitted bid, T-ranks the qualified
    ones (scored lines), and marks the line's technical evaluation closed.
    Tie-break (spec 9.2.3 step 6): higher current rating, then earliest
    submission."""
    if line.technical_closed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Technical evaluation is already closed for this line")
    if not deadline_passed(line):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Technical evaluation opens only after the bid due date")
    bids = submitted_bids(line, db)
    results: list[Consolidated] = []
    unevaluated = []
    for bid in bids:
        evals = db.query(BidEvaluation).filter(BidEvaluation.bid_id == bid.id).all()
        if not evals:
            unevaluated.append(bid.vendor.legal_name)
            continue
        results.append(consolidate(line, bid, evals, db))
    if unevaluated:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Evaluate every submitted bid first — not yet evaluated: " + ", ".join(unevaluated))

    ranked = []
    if is_scored(line):
        qualified = [r for r in results if r.outcome == TechnicalDecision.QUALIFIED]
        qualified.sort(key=lambda r: (-(r.score or 0), -r.rating, r.bid.submitted_at))
        ranked = {r.bid.id: i + 1 for i, r in enumerate(qualified)}
    rows = []
    for r in results:
        rows.append(
            BidTechnicalResult(bid_id=r.bid.id, outcome=r.outcome, consolidated_score=r.score, t_rank=(ranked or {}).get(r.bid.id) if ranked else None, reason=r.reason)
        )
    db.add_all(rows)
    line.technical_closed_at = datetime.now(timezone.utc)
    line.technical_closed_by_id = closer_id
    return rows
