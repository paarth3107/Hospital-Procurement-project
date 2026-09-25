from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid, BidStatus
from app.models.bid_evaluation import BidAttachmentView, BidEvaluation, BidTechnicalResult, TechnicalDecision
from app.models.tender import Tender, TenderStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import Role, UserAccount
from app.schemas.evaluation import (
    AttachmentMetaOut,
    BidReviewOut,
    ReviewAttachmentOut,
    CommercialRowOut,
    CommercialStatementOut,
    CriterionOut,
    EvaluationOut,
    EvaluationSave,
    LineDetailOut,
    LineSummaryOut,
    ResultOut,
    VendorBidRow,
)
from app.security import require_role
from app.services import commercial_evaluation as commercial
from app.services import technical_evaluation as tech
from app.services.audit import record
from app.services.bids import KIND_LABELS
from app.services.ratings import rating_score

router = APIRouter(prefix="/api/v1/evaluation", tags=["evaluation"])

# Everyone who follows a tender's bidding can see submission status; scoring
# is the Category Manager / Procurement Admin's job (spec 9.2.3).
VIEWERS = (Role.PROCUREMENT_OFFICER, Role.CATEGORY_MANAGER, Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)
EVALUATORS = (Role.CATEGORY_MANAGER, Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)
# Prices are opened to the Procurement Officer (who reviews the comparative
# statement and confirms L1, spec 9.5) and System Admin -- not to the technical
# evaluators. The Approving Authority gets them at L1 approval (not built yet).
PRICE_VIEWERS = (Role.PROCUREMENT_OFFICER, Role.SYSTEM_ADMIN)


def _line(db: Session, line_id: int) -> TenderLineItem:
    line = db.get(TenderLineItem, line_id)
    if not line or line.tender.status != TenderStatus.PUBLISHED or not line.published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found")
    return line


def _phase(line: TenderLineItem) -> str:
    if line.technical_closed_at is not None:
        return "technical_closed"
    return "technical_evaluation" if tech.deadline_passed(line) else "bidding_open"


def _summary(line: TenderLineItem, db: Session) -> LineSummaryOut:
    t = line.tender
    bids = tech.submitted_bids(line, db)
    evaluated = 0
    for b in bids:
        if db.query(BidEvaluation).filter(BidEvaluation.bid_id == b.id).first():
            evaluated += 1
    return LineSummaryOut(
        line_item_id=line.id, tender_id=t.id, tender_title=t.title, tender_type=t.tender_type, product_name=line.product.name,
        procurement_type=line.procurement_type, qty=line.qty, bid_due_date=t.bid_due_date,
        technical_eval_method=line.technical_eval_method, phase=_phase(line),
        invited_count=db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id).count(),
        submitted_count=len(bids), evaluated_count=evaluated,
    )


@router.get("/lines", response_model=list[LineSummaryOut])
def list_lines(db: Session = Depends(get_db), _user: UserAccount = Depends(require_role(*VIEWERS))):
    lines = (
        db.query(TenderLineItem)
        .join(Tender, TenderLineItem.tender_id == Tender.id)
        .filter(Tender.status == TenderStatus.PUBLISHED, TenderLineItem.published.is_(True))
        .order_by(Tender.bid_due_date, TenderLineItem.id)
        .all()
    )
    return [_summary(l, db) for l in lines]


@router.get("/lines/{line_id}", response_model=LineDetailOut)
def line_detail(line_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*VIEWERS))):
    line = _line(db, line_id)
    passed = tech.deadline_passed(line)
    closed = line.technical_closed_at is not None
    invites = db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id).all()
    bids = {b.vendor_id: b for b in tech.submitted_bids(line, db)}
    rows = []
    for inv in invites:
        bid = bids.get(inv.vendor_id)
        evals, result = [], None
        if bid is not None and passed and user.role in EVALUATORS:
            all_evals = db.query(BidEvaluation).filter(BidEvaluation.bid_id == bid.id).all()
            # Evaluators score independently: until the line is closed each sees only their own.
            shown = all_evals if closed else [e for e in all_evals if e.evaluator_id == user.id]
            evals = [
                EvaluationOut(evaluator=e.evaluator.full_name, mine=e.evaluator_id == user.id, decision=e.decision, scores=e.scores or {}, weighted_score=e.weighted_score, comments=e.comments)
                for e in shown
            ]
        if bid is not None and closed:  # the recorded outcome is visible to every viewer once the line is closed
            res = db.query(BidTechnicalResult).filter(BidTechnicalResult.bid_id == bid.id).first()
            if res:
                result = ResultOut(outcome=res.outcome, consolidated_score=res.consolidated_score, t_rank=res.t_rank, reason=res.reason)
        rows.append(
            VendorBidRow(
                vendor_id=inv.vendor_id, vendor_name=inv.vendor.legal_name, rating=rating_score(inv.vendor_id, line.procurement_type, db),
                submitted=bid is not None, submitted_at=bid.submitted_at if bid else None, bid_id=bid.id if bid else None,
                evaluations=evals,
                evaluation_count=db.query(BidEvaluation).filter(BidEvaluation.bid_id == bid.id).count() if bid is not None and passed else 0,
                result=result,
            )
        )
    rows.sort(key=lambda r: (r.result.t_rank if r.result and r.result.t_rank else 999, r.vendor_name))
    return LineDetailOut(
        summary=_summary(line, db),
        criteria=[CriterionOut(key=c.key, label=c.label, weight=c.weight, auto=c.auto, optional=c.optional) for c in tech.CRITERIA[line.procurement_type]],
        min_technical_score=tech.DEFAULT_MIN_TECHNICAL_SCORE,
        scored=tech.is_scored(line),
        can_evaluate=user.role in EVALUATORS and passed and not closed,
        can_see_evaluations=user.role in EVALUATORS,
        technical_closed_at=line.technical_closed_at,
        vendors=rows,
    )


def _unopened_attachments(db: Session, bid: Bid, user: UserAccount) -> list[str]:
    ids = [a.id for a in bid.attachments]
    if not ids:
        return []
    opened = {v.attachment_id for v in db.query(BidAttachmentView).filter(BidAttachmentView.viewer_id == user.id, BidAttachmentView.attachment_id.in_(ids))}
    return [a.original_filename for a in bid.attachments if a.id not in opened]


@router.get("/bids/{bid_id}/review", response_model=BidReviewOut)
def review_bid(bid_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*EVALUATORS))):
    """What an evaluator sees when they click Evaluate: the bid's technical
    envelope (brand, statement, type answers, attachments with whether they
    have opened each) and the scoring criteria. Not shown to the Procurement
    Officer or anyone else, and only after the bid due date."""
    bid = db.get(Bid, bid_id)
    if not bid or bid.status != BidStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submitted bid not found")
    line = bid.line_item
    _line(db, line.id)
    if not tech.deadline_passed(line):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bid content stays sealed until the bid due date")
    opened = {v.attachment_id for v in db.query(BidAttachmentView).filter(BidAttachmentView.viewer_id == user.id)}
    mine = db.query(BidEvaluation).filter(BidEvaluation.bid_id == bid.id, BidEvaluation.evaluator_id == user.id).first()
    attachments = [
        ReviewAttachmentOut(
            id=a.id, kind=a.kind, label=KIND_LABELS[a.kind], original_filename=a.original_filename, size_bytes=a.size_bytes,
            description=a.description, opened=a.id in opened,
        )
        for a in bid.attachments
    ]
    return BidReviewOut(
        bid_id=bid.id, vendor_name=bid.vendor.legal_name, rating=rating_score(bid.vendor_id, line.procurement_type, db),
        brand_offered=bid.brand_offered, technical_compliance=bid.technical_compliance, details=bid.details or {},
        attachments=attachments, all_opened=all(a.opened for a in attachments),
        criteria=[CriterionOut(key=c.key, label=c.label, weight=c.weight, auto=c.auto, optional=c.optional) for c in tech.CRITERIA[line.procurement_type]],
        min_technical_score=tech.DEFAULT_MIN_TECHNICAL_SCORE, scored=tech.is_scored(line),
        my_evaluation=EvaluationOut(evaluator=user.full_name, mine=True, decision=mine.decision, scores=mine.scores or {}, weighted_score=mine.weighted_score, comments=mine.comments) if mine else None,
    )


@router.put("/bids/{bid_id}/evaluation", response_model=EvaluationOut)
def save_evaluation(bid_id: int, payload: EvaluationSave, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*EVALUATORS))):
    bid = db.get(Bid, bid_id)
    if not bid or bid.status != BidStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submitted bid not found")
    line = bid.line_item
    _line(db, line.id)
    if not tech.deadline_passed(line):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Technical evaluation opens only after the bid due date")
    if line.technical_closed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Technical evaluation is closed for this line; a change now is a governed override")
    if payload.decision == TechnicalDecision.DISQUALIFIED and not payload.comments:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to disqualify a bid")

    unopened = _unopened_attachments(db, bid, user)
    if unopened:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Open every attachment before evaluating — not yet opened: " + ", ".join(unopened))

    scores, weighted = {}, None
    if payload.decision == TechnicalDecision.QUALIFIED:
        scores = tech.clean_scores(line.procurement_type, payload.scores)
        weighted = tech.weighted_score(line.procurement_type, scores, rating_score(bid.vendor_id, line.procurement_type, db))

    ev = db.query(BidEvaluation).filter(BidEvaluation.bid_id == bid.id, BidEvaluation.evaluator_id == user.id).first()
    before = {"decision": ev.decision, "weighted_score": ev.weighted_score} if ev else None
    if ev is None:
        ev = BidEvaluation(bid_id=bid.id, evaluator_id=user.id)
        db.add(ev)
    ev.decision, ev.scores, ev.weighted_score, ev.comments = payload.decision, scores, weighted, payload.comments
    db.flush()
    t = line.tender
    record(
        db, "evaluation.saved", "bid", bid.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name} - {bid.vendor.legal_name}",
        facility_id=t.facility_id, before=before, after={"decision": ev.decision, "weighted_score": weighted, "scores": scores}, reason=payload.comments,
        meta={"tender_id": t.id, "line_item_id": line.id},
    )
    db.commit()
    return EvaluationOut(evaluator=user.full_name, mine=True, decision=ev.decision, scores=ev.scores or {}, weighted_score=ev.weighted_score, comments=ev.comments)


@router.post("/lines/{line_id}/close-technical", response_model=LineDetailOut)
def close_technical_evaluation(line_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*EVALUATORS))):
    """Records qualification and T-ranks for the line. Only after this do
    qualified bids' prices become eligible to open (commercial evaluation)."""
    line = _line(db, line_id)
    rows = tech.close_technical(line, user.id, db)
    db.flush()
    t = line.tender
    record(
        db, "evaluation.technical_closed", "tender", t.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name}", facility_id=t.facility_id,
        after={
            "results": [
                {"vendor": db.get(Bid, r.bid_id).vendor.legal_name, "outcome": r.outcome, "score": r.consolidated_score, "t_rank": r.t_rank, "reason": r.reason}
                for r in rows
            ]
        },
        meta={"line_item_id": line.id, "scored": tech.is_scored(line)},
    )
    db.commit()
    return line_detail(line_id, db, user)


@router.get("/bids/{bid_id}/attachments/{attachment_id}/download")
def view_bid_attachment(bid_id: int, attachment_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*EVALUATORS))):
    """Staff open a vendor's attachment only after the deadline, and every
    view is logged (spec 8.3.3: viewer and timestamp)."""
    bid = db.get(Bid, bid_id)
    att = next((a for a in bid.attachments if a.id == attachment_id), None) if bid else None
    if not bid or not att or bid.status != BidStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    line = bid.line_item
    if not tech.deadline_passed(line):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bid attachments stay sealed until the bid due date")
    if not db.query(BidAttachmentView).filter(BidAttachmentView.attachment_id == att.id, BidAttachmentView.viewer_id == user.id).first():
        db.add(BidAttachmentView(attachment_id=att.id, viewer_id=user.id))
    t = line.tender
    record(
        db, "bid.attachment_viewed", "bid", bid.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name} - {bid.vendor.legal_name}",
        facility_id=t.facility_id, meta={"attachment_id": att.id, "kind": att.kind.value, "file": att.original_filename},
    )
    db.commit()
    return Response(content=att.content, media_type=att.content_type, headers={"Content-Disposition": f'inline; filename="{att.original_filename}"'})


@router.get("/lines/{line_id}/commercial", response_model=CommercialStatementOut)
def commercial_statement(line_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*PRICE_VIEWERS))):
    """The comparative statement: qualified bids ranked L1, L2... (or C1, C2...
    on QCBS lines) with their prices, disqualified bids without prices. Opens
    only once the line's technical evaluation is closed, and every opening is
    logged (spec 8.3.3 / 9.6: an audit trail covering bid price access)."""
    line = _line(db, line_id)
    method, rows = commercial.build_statement(line, db)
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
    t = line.tender
    record(
        db, "evaluation.prices_viewed", "tender", t.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name}", facility_id=t.facility_id,
        meta={"line_item_id": line.id, "method": method, "bids_opened": sum(1 for r in rows if r.rank is not None)},
    )
    db.commit()
    return CommercialStatementOut(
        summary=_summary(line, db), method=method, technical_weight=line.technical_weight, price_weight=line.price_weight,
        estimated_price=est, rows=out,
    )
