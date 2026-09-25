from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.tender import Tender, TenderStatus
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound
from app.models.user_account import UserAccount
from app.models.vendor import requirement_label
from app.schemas.tender_review import ReviewLineOut, ReviewRoundOut, ReviewVendorOut, TenderReviewOut
from app.security import get_current_user
from app.services.approval_matrix import MAX_ROUNDS_BEFORE_ESCALATION, can_approve_tier, resolve_required_tier
from app.services.eligibility import resolve_eligible_vendors
from app.services.mappings import required_document_types

router = APIRouter(prefix="/api/v1/tenders", tags=["tender-review"])


@router.get("/{tender_id}/approval-review", response_model=TenderReviewOut)
def approval_review(tender_id: int, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Everything an approver needs to decide a tender in one place (spec 7.2
    point 1: header terms, line items by procurement type, the resolved
    eligible-vendor list per line, the approval history), with warnings for
    anything that looks off. Read-only; the decision endpoints are unchanged."""

    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tender not found")

    lines, total, unpriced = [], 0.0, 0
    for li in sorted(tender.line_items, key=lambda x: x.id):
        p = li.product
        value = li.estimated_price * li.qty if li.estimated_price is not None else None
        total += value or 0.0
        unpriced += 0 if li.estimated_price is not None else 1
        eligible = resolve_eligible_vendors(li, db)
        minimum = li.min_rating_threshold_override if li.min_rating_threshold_override is not None else tender.min_rating_threshold
        lines.append(
            ReviewLineOut(
                line_item_id=li.id, product_code=p.code, product_name=p.name, category=p.category_ref.name, procurement_type=li.procurement_type,
                regulatory_class=p.regulatory_class, uom=p.unit_of_measure, qty=li.qty, estimated_price=li.estimated_price, line_value=value,
                split_award_allowed=li.split_award_allowed, technical_eval_method=li.technical_eval_method, technical_weight=li.technical_weight,
                price_weight=li.price_weight, min_rating_applied=minimum, line_details=li.line_details or {}, catalog_attrs=p.type_specific_attrs or {},
                required_documents=[requirement_label(e) for e in required_document_types(p, p.category_ref)],
                eligible_vendors=[ReviewVendorOut(vendor_id=e.vendor.id, legal_name=e.vendor.legal_name, rating_score=e.rating_score) for e in eligible],
                held_back=not eligible,
            )
        )

    rounds = db.query(TenderApprovalRound).filter(TenderApprovalRound.tender_id == tender.id).order_by(TenderApprovalRound.round_number).all()
    user_ids = {x for r in rounds for x in (r.submitted_by_id, r.reviewer_id) if x}
    if tender.created_by_id:
        user_ids.add(tender.created_by_id)
    names = {u.id: u.full_name for u in db.query(UserAccount).filter(UserAccount.id.in_(user_ids))} if user_ids else {}
    current = next((r for r in rounds if r.round_number == tender.round_number), None)
    pending = current is not None and current.decision == RoundDecision.PENDING and tender.status == TenderStatus.PENDING_APPROVAL

    tier_label = None
    try:
        tier_label = resolve_required_tier(total, tender.facility_id, db).label
    except ValueError:
        pass
    required_tier = current.required_tier if current else None
    escalated = tender.consecutive_rejections >= MAX_ROUNDS_BEFORE_ESCALATION

    warnings = []
    held = [l.product_name for l in lines if l.held_back]
    if held:
        head = "Every line has" if len(held) == len(lines) else f"{len(held)} line(s) have"
        warnings.append(f"{head} no eligible vendor and would not be published: " + ", ".join(held))
    if unpriced:
        warnings.append(f"{unpriced} line(s) have no estimated price, so the total value used for the approval tier may be understated")
    if tender.bid_due_date is None:
        warnings.append("No bid due date is set")
    elif tender.bid_due_date < datetime.now(timezone.utc):
        warnings.append("The bid due date has already passed")
    if escalated:
        warnings.append(f"Escalated to a higher tier after {tender.consecutive_rejections} consecutive rejections")

    facility = tender.facility
    return TenderReviewOut(
        id=tender.id, title=tender.title, description=tender.description, tender_type=tender.tender_type, status=tender.status,
        department=tender.department, facility_name=facility.name, facility_code=getattr(facility, "legal_entity_code", None),
        min_rating_threshold=tender.min_rating_threshold, min_invites=tender.min_invites, max_invites=tender.max_invites,
        publish_date=tender.publish_date, bid_due_date=tender.bid_due_date, created_by=names.get(tender.created_by_id), created_at=tender.created_at,
        round_number=tender.round_number, consecutive_rejections=tender.consecutive_rejections, total_estimated_value=total, lines_without_price=unpriced,
        required_tier=required_tier, tier_label=tier_label, escalated=escalated,
        can_decide=bool(pending and can_approve_tier(user, required_tier)), warnings=warnings,
        rounds=[
            ReviewRoundOut(
                round_number=r.round_number, decision=r.decision, required_tier=r.required_tier, submitted_by=names.get(r.submitted_by_id),
                submitted_at=r.submitted_at, reviewer=names.get(r.reviewer_id), decided_at=r.decided_at, comments=r.comments,
            )
            for r in rounds
        ],
        lines=lines,
    )
