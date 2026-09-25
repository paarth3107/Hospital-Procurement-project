from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.award import DRAFT, FINAL, PENDING, PROPOSED, PoDataFile
from app.models.bid import Bid
from app.models.tender import Tender, TenderStatus
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import Role, UserAccount
from app.schemas.awards import (
    AllocationOut, AwardLineOut, AwardTenderOut, AwardTenderSummary, DecisionIn, PoFileBrief, RecommendationSave, RoundOut,
)
from app.security import get_current_user, require_role
from app.services import awards as rules
from app.services import commercial_evaluation as commercial
from app.services.approval_matrix import can_approve_tier
from app.services.audit import record

router = APIRouter(prefix="/api/v1/awards", tags=["awards"])

# The Officer recommends (spec 9.5), the Approving Authority decides (spec 10.2).
# System Admin is the usual catch-all. Prices in the comparative statement are
# shown to the Officer and, once a recommendation is submitted to them, to the
# Approving Authority (spec 9.6 lists prices as hidden from everyone only until
# the deadline; the technical evaluators still never see them).
RECOMMENDERS = (Role.PROCUREMENT_OFFICER, Role.SYSTEM_ADMIN)
DECIDERS = (Role.APPROVING_AUTHORITY, Role.SYSTEM_ADMIN)
VIEWERS = (Role.PROCUREMENT_OFFICER, Role.APPROVING_AUTHORITY, Role.SYSTEM_ADMIN)


def _tender(db: Session, tender_id: int) -> Tender:
    t = db.get(Tender, tender_id)
    if not t or t.status not in (TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender not found")
    return t


def _line(db: Session, line_id: int) -> TenderLineItem:
    line = db.get(TenderLineItem, line_id)
    if not line or not line.published or line.tender.status not in (TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found")
    return line


def _alloc_out(a) -> AllocationOut:
    return AllocationOut(bid_id=a.bid_id, vendor_id=a.bid.vendor_id, vendor_name=a.bid.vendor.legal_name, share_pct=a.share_pct, quantity=round(a.round.line_item.qty * a.share_pct / 100.0, 4))


def _round_out(db: Session, r) -> RoundOut:
    top = r.system_top_bid_id
    top_bid = db.get(Bid, top) if top else None  # the system's L1 may not be among the allocations (an override)
    return RoundOut(
        round_number=r.round_number, status=r.status, kind=r.kind, is_override=r.is_override, officer_reason=r.officer_reason,
        system_top_bid_id=top, system_top_vendor=top_bid.vendor.legal_name if top_bid else None,
        proposed=[_alloc_out(a) for a in r.allocations if a.stage == PROPOSED], final=[_alloc_out(a) for a in r.allocations if a.stage == FINAL],
        required_tier=r.required_tier, award_value=r.award_value, recommended_by=r.recommended_by.full_name if r.recommended_by else None,
        recommended_at=r.recommended_at, submitted_at=r.submitted_at, decision_kind=r.decision_kind,
        decided_by=r.decided_by.full_name if r.decided_by else None, decided_at=r.decided_at, decision_comments=r.decision_comments,
    )


def _line_out(db: Session, line: TenderLineItem, user: UserAccount, audit_prices: list) -> AwardLineOut:
    rnd = rules.latest_round(db, line)
    state = rules.line_state(rnd)
    closed = line.technical_closed_at is not None
    awarded = line.tender.status in (TenderStatus.AWARDED, TenderStatus.NO_AWARD)
    statement, method = None, None
    # who may see the prices: the Officer and System Admin once technical is closed; the Approving
    # Authority only for a recommendation that has been submitted to them
    sees = closed and (user.role in RECOMMENDERS or (user.role == Role.APPROVING_AUTHORITY and rnd is not None and rnd.status != DRAFT))
    if sees:
        method, _, statement = commercial.statement_out(line, db)
        audit_prices.append(line)
    return AwardLineOut(
        line_item_id=line.id, product_code=line.product.code, product_name=line.product.name, procurement_type=line.procurement_type, qty=line.qty,
        uom=line.product.unit_of_measure, split_award_allowed=line.split_award_allowed, evaluation_method=line.technical_eval_method.value,
        technical_closed=closed, state=state, method=method, statement=statement,
        current=_round_out(db, rnd) if rnd else None, history=[_round_out(db, r) for r in rules.rounds_for(db, line)],
        can_recommend=user.role in RECOMMENDERS and closed and not awarded and state in ("none", "draft", "returned"),
        can_decide=bool(user.role in DECIDERS and rnd is not None and rnd.status == PENDING and can_approve_tier(user, rnd.required_tier)),
        min_split_pct=rules.MIN_SPLIT_PCT,
    )


def _tender_out(db: Session, tender: Tender, user: UserAccount) -> AwardTenderOut:
    audit_prices: list = []
    lines = [_line_out(db, li, user, audit_prices) for li in rules.published_lines(tender)]
    pending = [l.current for l in lines if l.current and l.current.status == PENDING]
    blockers = []  # everything that stops a submission
    to_do = []  # what the Officer is shown: only lines still needing a recommendation
    if tender.status in (TenderStatus.AWARDED, TenderStatus.NO_AWARD):
        blockers.append("finished")
    else:
        for l in lines:
            if not l.technical_closed:
                blockers.append(f"{l.product_name}: technical evaluation is not closed yet")
            elif l.state in ("none", "returned"):
                blockers.append(f"{l.product_name}: needs a recommendation")
                to_do.append(f"{l.product_name}: needs a recommendation")
        if not any(l.state == "draft" for l in lines):
            blockers.append("nothing to submit")
    if audit_prices:
        record(
            db, "award.prices_viewed", "tender", tender.id, actor=user, entity_label=f"#{tender.id} {tender.title}", facility_id=tender.facility_id,
            meta={"lines": [l.id for l in audit_prices]},
        )
        db.commit()
    files = db.query(PoDataFile).filter(PoDataFile.tender_id == tender.id, PoDataFile.status != "superseded").order_by(PoDataFile.id).all()
    return AwardTenderOut(
        tender_id=tender.id, title=tender.title, status=tender.status, department=tender.department, facility_name=tender.facility.name, lines=lines,
        required_tier=pending[0].required_tier if pending else None, pending_value=round(sum(p.award_value or 0 for p in pending), 2),
        can_submit=user.role in RECOMMENDERS and not blockers, submit_blockers=to_do if user.role in RECOMMENDERS else [],
        po_files=[PoFileBrief(id=f.id, batch_id=f.batch_id, vendor_name=f.vendor.legal_name, version=f.version, status=f.status) for f in files],
        awarded_at=tender.awarded_at,
    )


@router.get("/tenders", response_model=list[AwardTenderSummary])
def list_award_tenders(db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*VIEWERS))):
    """Tenders that have reached the award stage: at least one line's technical
    evaluation is closed (Officer: to recommend) or a recommendation is waiting
    (Approving Authority: to decide)."""
    tenders = db.query(Tender).filter(Tender.status.in_([TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD])).order_by(Tender.id.desc()).all()
    out = []
    for t in tenders:
        lines = rules.published_lines(t)
        if not any(li.technical_closed_at is not None for li in lines):
            continue
        counts: dict[str, int] = {}
        pending_rounds = []
        for li in lines:
            rnd = rules.latest_round(db, li)
            st = rules.line_state(rnd) if li.technical_closed_at is not None else "evaluating"
            counts[st] = counts.get(st, 0) + 1
            if rnd is not None and rnd.status == PENDING:
                pending_rounds.append(rnd)
        if user.role == Role.APPROVING_AUTHORITY and not pending_rounds and t.status not in (TenderStatus.AWARDED, TenderStatus.NO_AWARD):
            continue
        out.append(
            AwardTenderSummary(
                tender_id=t.id, title=t.title, status=t.status, lines_total=len(lines), counts=counts,
                required_tier=pending_rounds[0].required_tier if pending_rounds else None, pending_value=round(sum(r.award_value or 0 for r in pending_rounds), 2),
                waiting_for_you=bool(pending_rounds and user.role in DECIDERS and can_approve_tier(user, pending_rounds[0].required_tier))
                or bool(user.role in RECOMMENDERS and t.status not in (TenderStatus.AWARDED, TenderStatus.NO_AWARD) and counts.get("none", 0) + counts.get("draft", 0) + counts.get("returned", 0) > 0),
            )
        )
    return out


@router.get("/tenders/{tender_id}", response_model=AwardTenderOut)
def award_tender(tender_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*VIEWERS))):
    return _tender_out(db, _tender(db, tender_id), user)


@router.put("/lines/{line_id}/recommendation", response_model=AwardTenderOut)
def save_recommendation(line_id: int, payload: RecommendationSave, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*RECOMMENDERS))):
    line = _line(db, line_id)
    rules.save_recommendation(db, line, user, payload.mode, payload.bid_id, [a.model_dump() for a in payload.allocations] if payload.allocations else None, payload.reason)
    db.commit()
    return _tender_out(db, line.tender, user)


@router.post("/tenders/{tender_id}/submit", response_model=AwardTenderOut)
def submit_for_l1_approval(tender_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*RECOMMENDERS))):
    tender = _tender(db, tender_id)
    rules.submit_for_approval(db, tender, user)
    db.commit()
    return _tender_out(db, tender, user)


@router.post("/lines/{line_id}/decision", response_model=AwardTenderOut)
def decide_line(line_id: int, payload: DecisionIn, db: Session = Depends(get_db), user: UserAccount = Depends(require_role(*DECIDERS))):
    line = _line(db, line_id)
    rules.decide(db, line, user, payload.decision, payload.comments, [a.model_dump() for a in payload.allocations] if payload.allocations else None)
    db.commit()
    return _tender_out(db, line.tender, user)
