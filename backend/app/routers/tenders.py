from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.bid import Bid
from app.models.product_master import ProductMaster
from app.models.tender import Tender, TenderStatus
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.tender_invite import TenderInvite
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import Role, UserAccount
from app.schemas.tender import (
    ApprovalRoundOut,
    EligibleVendorOut,
    LineItemCreate,
    LineItemEligibilityOut,
    LineItemOut,
    RejectionPayload,
    TenderCreate,
    TenderInviteOut,
    TenderOut,
)
from app.security import get_current_user, require_role
from app.services.approval_matrix import MAX_ROUNDS_BEFORE_ESCALATION, can_approve_tier, escalate, resolve_required_tier
from app.services.eligibility import resolve_eligible_vendors

router = APIRouter(prefix="/api/v1/tenders", tags=["tenders"])

TENDER_AUTHORS = (Role.PROCUREMENT_OFFICER, Role.PROCUREMENT_ADMIN, Role.SYSTEM_ADMIN)


def _load_tender(tender_id: int, db: Session) -> Tender:
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender not found")
    return tender


def _total_estimated_value(tender: Tender) -> float:
    """Spec §11.2 — the approval matrix resolves off the tender's total
    estimated value. A line item with no estimated price contributes 0 to
    the total (spec calls the field "reference only"; treating an unset
    reference price as a hard error would block drafting a tender before
    procurement has firmed up every line's budget number)."""

    return sum((li.estimated_price or 0.0) * li.qty for li in tender.line_items)


@router.post("", response_model=TenderOut, status_code=status.HTTP_201_CREATED)
def create_tender(
    payload: TenderCreate,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = Tender(**payload.model_dump(exclude={"line_items"}), created_by_id=user.id)
    db.add(tender)
    db.flush()
    _set_line_items(tender, payload.line_items, db)
    db.commit()
    db.refresh(tender)
    return tender


@router.get("", response_model=list[TenderOut])
def list_tenders(
    status_filter: TenderStatus | None = None,
    facility_id: int | None = None,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(get_current_user),
):
    query = db.query(Tender)
    if status_filter is not None:
        query = query.filter(Tender.status == status_filter)
    if facility_id is not None:
        query = query.filter(Tender.facility_id == facility_id)
    return query.order_by(Tender.created_at.desc()).all()


@router.get("/{tender_id}", response_model=TenderOut)
def get_tender(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    return _load_tender(tender_id, db)


def _require_draft(tender: Tender) -> None:
    if tender.status != TenderStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tender is in status '{tender.status.value}'; line items can only be edited while Draft",
        )


def _validate_line_item(payload: LineItemCreate, db: Session) -> None:
    product = db.get(ProductMaster, payload.product_master_id)
    if not product or not product.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    if product.procurement_type != payload.procurement_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Catalog entry #{product.id} is a '{product.procurement_type.value}', not '{payload.procurement_type.value}'",
        )


def _set_line_items(tender: Tender, items: list[LineItemCreate], db: Session) -> None:
    """Replaces the tender's whole line-item list (Draft only -- callers
    check). Old rows go through the ORM so their persisted invites cascade
    away too; invites are recomputed at submit anyway."""

    for item in items:
        _validate_line_item(item, db)
    for old in list(tender.line_items):
        db.delete(old)
    db.flush()
    for item in items:
        db.add(TenderLineItem(tender_id=tender.id, **item.model_dump()))
    db.flush()
    db.expire(tender, ["line_items"])


@router.put("/{tender_id}", response_model=TenderOut)
def update_draft_tender(
    tender_id: int,
    payload: TenderCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """"Save as Draft" on an existing tender: every header field and the
    full line-item list are editable, but only while Draft."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tender is in status '{tender.status.value}'; it can only be edited while Draft",
        )
    for field, value in payload.model_dump(exclude={"line_items"}).items():
        setattr(tender, field, value)
    _set_line_items(tender, payload.line_items, db)
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/line-items", response_model=LineItemOut, status_code=status.HTTP_201_CREATED)
def add_line_item(
    tender_id: int,
    payload: LineItemCreate,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)

    product = db.get(ProductMaster, payload.product_master_id)
    if not product or not product.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entry not found")
    if product.procurement_type != payload.procurement_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Catalog entry #{product.id} is a '{product.procurement_type.value}', not '{payload.procurement_type.value}'",
        )

    line_item = TenderLineItem(tender_id=tender_id, **payload.model_dump())
    db.add(line_item)
    db.commit()
    db.refresh(line_item)
    return line_item


@router.get("/{tender_id}/line-items", response_model=list[LineItemOut])
def list_line_items(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    _load_tender(tender_id, db)
    return db.query(TenderLineItem).filter(TenderLineItem.tender_id == tender_id).all()


@router.get("/{tender_id}/eligibility-preview", response_model=list[LineItemEligibilityOut])
def eligibility_preview(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """Spec §6.5 — computed on demand, doesn't persist anything. Persisting
    the resolved list as `TenderInvite` rows only happens at submit/approve
    time (`_persist_invites` below), since that's what §6.5 calls "what the
    Approving Authority reviews" and "what actual publish notifies" — a
    stable snapshot, not a live query re-run on every page view."""

    tender = _load_tender(tender_id, db)
    results = []
    for li in tender.line_items:
        threshold = li.min_rating_threshold_override if li.min_rating_threshold_override is not None else tender.min_rating_threshold
        eligible = resolve_eligible_vendors(li, db)
        results.append(
            LineItemEligibilityOut(
                line_item_id=li.id,
                product_name=li.product.name,
                product_master_id=li.product_master_id,
                threshold_applied=threshold,
                eligible_vendors=[
                    EligibleVendorOut(vendor_id=e.vendor.id, legal_name=e.vendor.legal_name, rating_score=e.rating_score)
                    for e in eligible
                ],
            )
        )
    return results


def _persist_invites(tender: Tender, db: Session) -> list[str]:
    """Recomputes and overwrites the system-resolved invite list for every
    line item. Returns the ids of any line item left with zero eligible
    vendors, per spec §6.5: "the system blocks that line from moving to
    approval" — there's no manual-override escape hatch yet (deferred to
    Phase 7's override engine), so this phase's block is unconditional."""

    zero_eligible: list[str] = []
    for li in tender.line_items:
        db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == li.id).delete()
        eligible = resolve_eligible_vendors(li, db)
        if not eligible:
            zero_eligible.append(li.product.name)
            continue
        for e in eligible:
            db.add(TenderInvite(tender_line_item_id=li.id, vendor_id=e.vendor.id, rating_at_resolution=e.rating_score))
    return zero_eligible


@router.post("/{tender_id}/submit-for-approval", response_model=TenderOut)
def submit_for_approval(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    tender = _load_tender(tender_id, db)
    _require_draft(tender)

    if not tender.line_items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A tender needs at least one line item before submission")
    if not tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bid Due Date must be set before submission")

    # A line with zero eligible vendors doesn't block the tender: it is held
    # back (not published) while the other lines proceed. Only a tender where
    # NO line has an eligible vendor is refused.
    zero_eligible = _persist_invites(tender, db)
    if len(zero_eligible) == len(tender.line_items):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No line item has an eligible vendor — relax the rating threshold or map more vendors before submitting",
        )

    total_value = _total_estimated_value(tender)
    escalated = tender.consecutive_rejections >= MAX_ROUNDS_BEFORE_ESCALATION
    resolved = resolve_required_tier(total_value, tender.facility_id, db)
    required_tier = escalate(resolved.tier) if escalated else resolved.tier

    tender.round_number += 1
    tender.status = TenderStatus.PENDING_APPROVAL
    db.add(
        TenderApprovalRound(
            tender_id=tender.id,
            round_number=tender.round_number,
            decision=RoundDecision.PENDING,
            required_tier=required_tier,
            submitted_by_id=user.id,
        )
    )
    db.commit()
    db.refresh(tender)
    return tender


def _current_round(tender: Tender, db: Session) -> TenderApprovalRound:
    round_ = (
        db.query(TenderApprovalRound)
        .filter(TenderApprovalRound.tender_id == tender.id, TenderApprovalRound.round_number == tender.round_number)
        .first()
    )
    if not round_ or round_.decision != RoundDecision.PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tender has no pending approval round")
    return round_


def _authorize_approver(user: UserAccount, required_tier: int) -> None:
    """Spec §11.2's illustrative bands, reframed onto this system's roles
    (CLAUDE.md open question 2 — exact bands/roles still to be finalized):
    tier 1 (<=Rs.1,00,000) self-attested by Procurement Admin; tier 2/3
    (Department Head, and Department Head + Finance/Management Committee)
    both resolve to the Approving Authority role, disambiguated by
    UserAccount.approval_tier since this system has one Approving Authority
    role, not three. The actual predicate lives in
    app/services/approval_matrix.py's can_approve_tier() so the Dashboard's
    "Pending Your Approval" list can use the exact same rule."""

    if not can_approve_tier(user, required_tier):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This tender requires an Approving Authority at tier {required_tier} or above",
        )


@router.post("/{tender_id}/approve", response_model=TenderOut)
def approve_tender(
    tender_id: int,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not pending approval")

    round_ = _current_round(tender, db)
    _authorize_approver(user, round_.required_tier)

    # Spec §5.9 "approval-time re-check" — vendor/mapping/rating state may
    # have moved since submission.
    zero_eligible = _persist_invites(tender, db)
    if len(zero_eligible) == len(tender.line_items):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No line item has an eligible vendor any more — cannot approve as-is",
        )
    # Publish the lines that have invites; hold back the rest. (The session does
    # not autoflush, so push the freshly added invites before querying them.)
    db.flush()
    invited_line_ids = {
        row[0]
        for row in db.query(TenderInvite.tender_line_item_id)
        .filter(TenderInvite.tender_line_item_id.in_([li.id for li in tender.line_items]))
        .all()
    }
    for li in tender.line_items:
        li.published = li.id in invited_line_ids

    round_.decision = RoundDecision.APPROVED
    round_.reviewer_id = user.id
    round_.decided_at = datetime.now(timezone.utc)
    tender.status = TenderStatus.PUBLISHED
    tender.published_at = datetime.now(timezone.utc)
    tender.consecutive_rejections = 0
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/reject", response_model=TenderOut)
def reject_tender(
    tender_id: int,
    payload: RejectionPayload,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not pending approval")

    round_ = _current_round(tender, db)
    _authorize_approver(user, round_.required_tier)

    round_.decision = RoundDecision.REJECTED
    round_.reviewer_id = user.id
    round_.comments = payload.comments
    round_.decided_at = datetime.now(timezone.utc)
    tender.status = TenderStatus.DRAFT
    tender.consecutive_rejections += 1
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/withdraw-to-draft", response_model=TenderOut)
def withdraw_to_draft(
    tender_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Lets a Published tender be pulled back to Draft for editing --
    line items can only be added/changed while Draft (see
    add_line_item/_require_draft above). Refused once any vendor has
    already bid on it: reopening line items after real bids exist would
    silently invalidate what those vendors bid against, with nothing here
    to notify them. A tender with no bids yet has nothing to protect, so
    it's a plain revert, not a governed override -- there's no separate
    approval step for undoing your own not-yet-acted-on publish."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Tender is in status '{tender.status.value}', not Published")

    line_item_ids = [li.id for li in tender.line_items]
    bid_count = db.query(Bid).filter(Bid.tender_line_item_id.in_(line_item_ids)).count() if line_item_ids else 0
    if bid_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot revert to Draft: {bid_count} bid(s) have already been submitted against this tender",
        )

    tender.status = TenderStatus.DRAFT
    tender.published_at = None
    for li in tender.line_items:
        li.published = False
    db.commit()
    db.refresh(tender)
    return tender


@router.post("/{tender_id}/line-items/{line_item_id}/publish", response_model=LineItemOut)
def publish_held_line(
    tender_id: int,
    line_item_id: int,
    db: Session = Depends(get_db),
    _user: UserAccount = Depends(require_role(*TENDER_AUTHORS)),
):
    """Publishes a line that was held back at approval time (it had no
    eligible vendor then) once vendors qualify. The tender itself was already
    approved; only this line's eligibility is re-resolved."""

    tender = _load_tender(tender_id, db)
    if tender.status != TenderStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a Published tender can have a held line published")
    if tender.bid_due_date is not None and datetime.now(timezone.utc) > tender.bid_due_date:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The bid deadline for this tender has passed")
    line = next((li for li in tender.line_items if li.id == line_item_id), None)
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line item not found on this tender")
    if line.published:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line is already published")

    eligible = resolve_eligible_vendors(line, db)
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Still no eligible vendor for {line.product.name} — relax the rating threshold or map more vendors",
        )
    db.query(TenderInvite).filter(TenderInvite.tender_line_item_id == line.id).delete()
    for e in eligible:
        db.add(TenderInvite(tender_line_item_id=line.id, vendor_id=e.vendor.id, rating_at_resolution=e.rating_score))
    line.published = True
    db.commit()
    db.refresh(line)
    return line


@router.get("/{tender_id}/invites", response_model=list[TenderInviteOut])
def list_invites(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    """The persisted snapshot from the last submit/approve (spec §6.5:
    "what the Approving Authority reviews... and what actual publish
    notifies") — distinct from `eligibility-preview`, which recomputes live
    and can drift from this once vendor/mapping/rating state moves on."""

    tender = _load_tender(tender_id, db)
    line_item_ids = [li.id for li in tender.line_items]
    if not line_item_ids:
        return []
    return db.query(TenderInvite).filter(TenderInvite.tender_line_item_id.in_(line_item_ids)).all()


@router.get("/{tender_id}/approval-rounds", response_model=list[ApprovalRoundOut])
def list_approval_rounds(tender_id: int, db: Session = Depends(get_db), _user: UserAccount = Depends(get_current_user)):
    _load_tender(tender_id, db)
    return (
        db.query(TenderApprovalRound)
        .filter(TenderApprovalRound.tender_id == tender_id)
        .order_by(TenderApprovalRound.round_number)
        .all()
    )
