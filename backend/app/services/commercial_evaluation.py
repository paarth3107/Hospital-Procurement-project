"""Commercial (price) evaluation (spec §9.3, §9.4): runs only among the bids
that were recorded technically qualified, ranks them by landed price (L1, L2,
...) or, on QCBS lines, by combined technical + price score (C1, C2, ...).
Technically disqualified bids are listed but their prices are never opened.
Nothing here runs until a line's technical evaluation is closed (spec §9.6)."""

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.bid import Bid
from app.models.bid_evaluation import BidTechnicalResult, TechnicalDecision
from app.models.tender_line_item import TechnicalEvalMethod, TenderLineItem
from app.services.ratings import rating_score
from app.services.technical_evaluation import submitted_bids


def landed_unit_price(bid: Bid) -> float:
    """Unit price + GST + other duties (spec 9.3 point 2). A normalised
    freight/logistics adder is the spec's optional extra; none is configured."""
    return bid.unit_price * (1 + (bid.gst_percent or 0) / 100) + (bid.other_duties or 0)


@dataclass
class Row:
    bid: Bid
    result: BidTechnicalResult
    rating: float
    landed: float | None = None
    price_score: float | None = None
    combined: float | None = None
    rank: int | None = None
    tie_note: str | None = None


def _qcbs_weights(line: TenderLineItem) -> tuple[float, float]:
    tw, pw = line.technical_weight, line.price_weight
    if tw is None or pw is None or (tw + pw) <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This QCBS line has no technical / price weights set")
    total = tw + pw
    return tw / total, pw / total  # accepts 70/30 or 0.7/0.3


def build_statement(line: TenderLineItem, db: Session) -> tuple[str, list[Row]]:
    """Returns (method label, rows). Qualified rows come first in rank order,
    disqualified rows after them with no price fields set."""
    if line.technical_closed_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prices open only after technical evaluation is closed for this line")

    rows: list[Row] = []
    for bid in submitted_bids(line, db):
        result = db.query(BidTechnicalResult).filter(BidTechnicalResult.bid_id == bid.id).first()
        if result is None:  # a bid submitted but never evaluated can't happen once closed; skip defensively
            continue
        rows.append(Row(bid=bid, result=result, rating=rating_score(bid.vendor_id, line.procurement_type, db)))

    qualified = [r for r in rows if r.result.outcome == TechnicalDecision.QUALIFIED]
    for r in qualified:
        r.landed = landed_unit_price(r.bid)

    if line.technical_eval_method == TechnicalEvalMethod.QCBS and qualified:
        method = "QCBS"
        tw, pw = _qcbs_weights(line)
        lowest = min(r.landed for r in qualified)
        for r in qualified:
            r.price_score = round(lowest / r.landed * 100, 2)  # lowest bid scores 100 (spec 9.4)
            r.combined = round((r.result.consolidated_score or 0) * tw + r.price_score * pw, 2)  # technical score and price score are both out of 100 (spec 9.4)
        qualified.sort(key=lambda r: (-r.combined, -r.rating, r.bid.submitted_at))
        key = lambda r: r.combined
    else:
        method = "QCBS" if line.technical_eval_method == TechnicalEvalMethod.QCBS else "L1"
        # Tie-break (spec 9.3 point 4): higher current rating, then higher technical score, then earliest submission.
        qualified.sort(key=lambda r: (r.landed, -r.rating, -(r.result.consolidated_score or 0), r.bid.submitted_at))
        key = lambda r: r.landed

    for i, r in enumerate(qualified):
        r.rank = i + 1
        if i > 0 and key(qualified[i - 1]) == key(r):
            r.tie_note = "Tied with the bid above on the ranking value; the tie-break (rating, technical score, earliest submission) was applied"
        elif i == 0 and len(qualified) > 1 and key(qualified[1]) == key(r):
            r.tie_note = "Tied for first; the tie-break (rating, technical score, earliest submission) placed this bid ahead"
    disqualified = [r for r in rows if r.result.outcome != TechnicalDecision.QUALIFIED]
    return method, qualified + disqualified


def statement_out(line: TenderLineItem, db: Session):
    """(method, raw rows, API rows) for a line's comparative statement: qualified bids
    ranked with prices and sanity checks, disqualified bids without prices.
    Shared by the price comparison and the L1 award screens."""
    from app.schemas.evaluation import CommercialRowOut

    method, rows = build_statement(line, db)
    product = line.product
    est = line.estimated_price
    out = []
    for r in rows:
        b = r.bid
        qualified = r.rank is not None
        flags = []
        variance = None
        if qualified and est:
            variance = round((b.unit_price - est) / est * 100, 1)
        if qualified and product.price_band_min is not None and b.unit_price < product.price_band_min:
            flags.append("Below the catalog price band")
        if qualified and product.price_band_max is not None and b.unit_price > product.price_band_max:
            flags.append("Above the catalog price band")
        if variance is not None and variance > 20:
            flags.append(f"{variance:g}% above the estimated price")
        if variance is not None and variance < -30:
            flags.append(f"{abs(variance):g}% below the estimated price (check for an error)")
        landed = r.landed
        out.append(
            CommercialRowOut(
                vendor_id=b.vendor_id, vendor_name=b.vendor.legal_name, bid_id=b.id, technical_outcome=r.result.outcome,
                technical_score=r.result.consolidated_score, t_rank=r.result.t_rank, technical_reason=r.result.reason, rating=r.rating,
                rank=r.rank, rank_label=(f"{'C' if method == 'QCBS' else 'L'}{r.rank}" if qualified else None), recommended=r.rank == 1,
                unit_price=b.unit_price if qualified else None, gst_percent=b.gst_percent if qualified else None,
                other_duties=b.other_duties if qualified else None, landed_unit_price=round(landed, 2) if qualified else None,
                total_price=round(b.unit_price * line.qty, 2) if qualified else None, landed_total=round(landed * line.qty, 2) if qualified else None,
                delivery_lead_days=b.delivery_lead_days if qualified else None, quote_validity_days=b.quote_validity_days if qualified else None,
                payment_terms=b.payment_terms if qualified else None, price_score=r.price_score, combined_score=r.combined,
                variance_pct=variance, price_flags=flags, tie_note=r.tie_note, submitted_at=b.submitted_at,
            )
        )
    return method, rows, out
