from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.award import AwardRound
from app.models.bid import Bid, BidStatus
from app.models.bid_evaluation import BidAttachmentView, BidEvaluation, BidTechnicalResult, TechnicalDecision
from app.models.override import OverrideRequest, OverrideStatus, OverrideType
from app.models.tender import Tender, TenderStatus
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import Role, UserAccount
from app.models.vendor_rating import PriceCompetitivenessRecord
from app.schemas.evaluation import (
    AttachmentMetaOut,
    BidReviewOut,
    ReviewAttachmentOut,
    CommercialRowOut,
    CommercialStatementOut,
    CriterionOut,
    EvaluationCorrectionIn,
    EvaluationOut,
    EvaluationSave,
    LineDetailOut,
    LineSummaryOut,
    ResultOut,
    VendorBidRow,
)
from app.schemas.override import OverrideDecision
from app.security import get_current_user, require_role
from app.services import commercial_evaluation as commercial
from app.services import overrides
from app.services import technical_evaluation as tech
from app.services.audit import record
from app.services.notifier import notify_vendor
from app.services.bids import KIND_LABELS
from app.services.ratings import rating_score, record_price_competitiveness, refresh_price_competitiveness

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
    if not line or line.tender.status not in (TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD) or not line.published:
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
        .filter(Tender.status.in_([TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD]), TenderLineItem.published.is_(True))
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
    if payload.decision == TechnicalDecision.QUALIFIED and tech.is_scored(line):
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


def _update_price_competitiveness(db: Session, line: TenderLineItem, results: list) -> None:
    """Spec §5.2/§5.3: the only rating sub-score the system computes itself,
    from this system's own historical bid data. Fires right here because this
    is the first moment a line's prices are unsealed at all (spec §9.6) --
    nothing before this point can legitimately be compared. Needs at least
    two technically qualified bids on the line; with only one there is no
    "vs. the field" to measure (an unchallenged bid isn't "competitive",
    it's just unopposed), so a single-bid line contributes nothing."""

    qualified = [r for r in results if r.outcome == TechnicalDecision.QUALIFIED]
    if len(qualified) < 2:
        return
    bids = {b.id: b for b in db.query(Bid).filter(Bid.id.in_([r.bid_id for r in qualified])).all()}
    landed = {bid_id: commercial.landed_unit_price(bids[bid_id]) for bid_id in bids}
    lowest = min(landed.values())
    touched: dict[int, str] = {}
    for r in qualified:
        bid = bids[r.bid_id]
        price_score = round(lowest / landed[bid.id] * 100, 2)
        record_price_competitiveness(db, bid.vendor_id, line.procurement_type, bid.id, line.id, price_score)
        touched[bid.vendor_id] = bid.vendor.legal_name
    db.flush()
    for vendor_id in touched:
        refresh_price_competitiveness(db, vendor_id, line.procurement_type)
    t = line.tender
    record(
        db, "rating.price_competitiveness_updated", "tender", t.id, actor=None, entity_label=f"#{t.id} {t.title} - {line.product.name}",
        facility_id=t.facility_id, after={"vendors": list(touched.values())}, meta={"line_item_id": line.id, "procurement_type": line.procurement_type.value},
    )


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
    _update_price_competitiveness(db, line, rows)
    for r in rows:
        if r.outcome == TechnicalDecision.DISQUALIFIED:
            bid = db.get(Bid, r.bid_id)
            notify_vendor(
                db, bid.vendor_id, "technical_disqualified", f"Technical evaluation: {t.title}",
                f"Your bid for {line.product.name} on tender #{t.id} ({t.title}) was not technically qualified. Reason: {r.reason or 'not stated'}. Its price was not opened.",
                t.id,
            )
    db.commit()
    return line_detail(line_id, db, user)


def _pending_correction(db: Session, evaluation_id: int) -> OverrideRequest | None:
    return (
        db.query(OverrideRequest)
        .filter(
            OverrideRequest.override_type == OverrideType.TECHNICAL_SCORE_CORRECTION,
            OverrideRequest.entity_type == "bid_evaluation",
            OverrideRequest.entity_id == evaluation_id,
            OverrideRequest.status.in_([OverrideStatus.PENDING_APPROVAL, OverrideStatus.ESCALATED]),
        )
        .order_by(OverrideRequest.created_at.desc())
        .first()
    )


def _get_correction(db: Session, override_id: int) -> OverrideRequest:
    override = overrides.get_override(db, override_id)
    if override.override_type != OverrideType.TECHNICAL_SCORE_CORRECTION:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a technical score correction")
    return override


@router.put("/bids/{bid_id}/evaluation-correction")
def request_evaluation_correction(bid_id: int, payload: EvaluationCorrectionIn, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*EVALUATORS))):
    """Spec §9.2.4: changing a bid's evaluation after the line's technical
    evaluation is closed is a governed override -- this is the path
    save_evaluation()'s 409 ("a change now is a governed override") points
    to. Only usable before the line's L1 recommendation has started (an
    AwardRound already existing means the Officer has begun acting on the
    current outcome; correcting under that isn't supported)."""

    bid = db.get(Bid, bid_id)
    if not bid or bid.status != BidStatus.SUBMITTED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submitted bid not found")
    line = bid.line_item
    _line(db, line.id)
    if line.technical_closed_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Technical evaluation isn't closed yet for this line — save it directly instead")
    if db.query(AwardRound).filter(AwardRound.line_item_id == line.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line's L1 recommendation has already started; a correction this late isn't supported yet")
    ev = db.query(BidEvaluation).filter(BidEvaluation.bid_id == bid.id, BidEvaluation.evaluator_id == user.id).first()
    if not ev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You have no recorded evaluation on this bid to correct")
    if _pending_correction(db, ev.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A correction for this evaluation is already pending approval")
    if payload.decision == TechnicalDecision.DISQUALIFIED and not payload.comments:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to disqualify a bid")
    unopened = _unopened_attachments(db, bid, user)
    if unopened:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Open every attachment before evaluating — not yet opened: " + ", ".join(unopened))

    new_scores, new_weighted = {}, None
    if payload.decision == TechnicalDecision.QUALIFIED and tech.is_scored(line):
        new_scores = tech.clean_scores(line.procurement_type, payload.scores)
        new_weighted = tech.weighted_score(line.procurement_type, new_scores, rating_score(bid.vendor_id, line.procurement_type, db))

    before = {"decision": ev.decision, "scores": ev.scores, "weighted_score": ev.weighted_score, "comments": ev.comments}
    after = {"decision": payload.decision, "scores": new_scores, "weighted_score": new_weighted, "comments": payload.comments}

    # Dry run: temporarily substitute the hypothetical values in memory (this
    # session has autoflush off, so nothing is written) to see whether the
    # correction would change any bid's recorded outcome or T-rank on this
    # line -- spec §12.3's literal escalation trigger for this override type.
    current = {r.bid_id: (r.outcome, r.t_rank) for r in db.query(BidTechnicalResult).filter(BidTechnicalResult.bid_id.in_([b.id for b in tech.submitted_bids(line, db)])).all()}
    ev.decision, ev.scores, ev.weighted_score, ev.comments = after["decision"], after["scores"], after["weighted_score"], after["comments"]
    hypothetical = tech.consolidate_line(line, db)
    ev.decision, ev.scores, ev.weighted_score, ev.comments = before["decision"], before["scores"], before["weighted_score"], before["comments"]
    changes_outcome = any(current.get(r.bid.id) != (r.outcome, r.t_rank) for r in hypothetical)

    override = overrides.create_override(
        db, override_type=OverrideType.TECHNICAL_SCORE_CORRECTION, initiator=user, entity_type="bid_evaluation", entity_id=ev.id,
        entity_label=f"#{line.tender.id} {line.tender.title} - {line.product.name} - {bid.vendor.legal_name}", facility_id=line.tender.facility_id,
        reason_code=payload.reason_code, justification=payload.justification, proposed_change={"before": before, "after": after},
    )
    if changes_outcome:
        overrides.escalate_override(db, override, actor=None, reason="Correction changes the technical qualification/T-rank outcome for this line (spec §12.3)")
    db.commit()
    db.refresh(override)
    return {"override_id": override.id, "status": override.status, "required_approver_role": override.required_approver_role, "escalated": changes_outcome}


@router.post("/evaluation-corrections/{override_id}/approve")
def approve_evaluation_correction(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_correction(db, override_id)
    overrides.approve_override(db, override, user, payload.reason)

    ev = db.get(BidEvaluation, override.entity_id)
    bid = db.get(Bid, ev.bid_id)
    line = bid.line_item
    after = override.proposed_change["after"]
    ev.decision, ev.scores, ev.weighted_score, ev.comments = after["decision"], after["scores"], after["weighted_score"], after["comments"]
    db.flush()

    results = tech.consolidate_line(line, db)
    existing = {r.bid_id: r for r in db.query(BidTechnicalResult).filter(BidTechnicalResult.bid_id.in_([r.bid.id for r in results])).all()}
    for r in results:
        row = existing[r.bid.id]
        row.outcome, row.consolidated_score, row.t_rank, row.reason = r.outcome, r.score, r.t_rank, r.reason
    db.flush()

    t = line.tender
    record(
        db, "evaluation.corrected", "bid", bid.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name} - {bid.vendor.legal_name}",
        facility_id=t.facility_id, before=override.proposed_change["before"], after=after, reason=override.justification,
        meta={"override_id": override.id, "tender_id": t.id, "line_item_id": line.id},
    )

    # The qualified set and/or its relative pricing may have changed --
    # recompute Price Competitiveness for this line from scratch rather than
    # leaving stale records (spec §5.2/§5.3 -- see _update_price_competitiveness).
    old_vendor_ids = {vid for (vid,) in db.query(PriceCompetitivenessRecord.vendor_id).filter(PriceCompetitivenessRecord.tender_line_item_id == line.id).all()}
    db.query(PriceCompetitivenessRecord).filter(PriceCompetitivenessRecord.tender_line_item_id == line.id).delete()
    _update_price_competitiveness(db, line, list(existing.values()))
    new_vendor_ids = {vid for (vid,) in db.query(PriceCompetitivenessRecord.vendor_id).filter(PriceCompetitivenessRecord.tender_line_item_id == line.id).all()}
    for vendor_id in old_vendor_ids - new_vendor_ids:
        refresh_price_competitiveness(db, vendor_id, line.procurement_type)

    db.commit()
    return {"override_id": override.id, "status": override.status}


@router.post("/evaluation-corrections/{override_id}/reject")
def reject_evaluation_correction(override_id: int, payload: OverrideDecision, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    override = _get_correction(db, override_id)
    overrides.reject_override(db, override, user, payload.reason or "")
    db.commit()
    return {"override_id": override.id, "status": override.status}


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
    method, rows, out = commercial.statement_out(line, db)
    t = line.tender
    record(
        db, "evaluation.prices_viewed", "tender", t.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name}", facility_id=t.facility_id,
        meta={"line_item_id": line.id, "method": method, "bids_opened": sum(1 for r in rows if r.rank is not None)},
    )
    db.commit()
    return CommercialStatementOut(
        summary=_summary(line, db), method=method, technical_weight=line.technical_weight, price_weight=line.price_weight,
        estimated_price=line.estimated_price, rows=out,
    )
