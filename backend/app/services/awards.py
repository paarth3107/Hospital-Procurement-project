"""L1 recommendation and L1 approval rules (spec §9.5, §10.2, §7.3 point 9).

Officer: for each line, confirm the system's L1/C1, recommend a different
qualified vendor (a reason is mandatory), propose a split (Split-Award lines),
or exclude the line from the award (reason mandatory); then submit the whole
tender for L1 approval. Approving Authority: per line, approve the Officer's
recommendation, award the system's L1/C1 instead when the Officer chose someone
else, adjust a split, or reject with comments (the line returns to the Officer
as the next round; repeated rejections escalate the required tier).
When every line is decided the tender is Awarded, PO data files are generated
and vendors are notified."""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.award import (
    APPROVED, APPROVED_ADJUSTED, APPROVED_RECOMMENDATION, AWARD, AWARDED_SYSTEM_L1, DRAFT, EXCLUDE, FINAL, PENDING, PROPOSED, REJECTED,
    REJECTED_DECISION, AwardAllocation, AwardRound,
)
from app.models.bid import Bid, BidStatus
from app.models.bid_evaluation import BidTechnicalResult, TechnicalDecision
from app.models.tender import Tender, TenderStatus
from app.models.tender_line_item import TenderLineItem
from app.models.user_account import UserAccount
from app.services import commercial_evaluation as commercial
from app.services import po_files
from app.services.approval_matrix import MAX_ROUNDS_BEFORE_ESCALATION, can_approve_tier, escalate, resolve_required_tier
from app.services.audit import record
from app.services.notifier import notify_vendor

# Spec 9.5: "a hospital-configured floor so a split isn't proposed as, say, a
# meaningless 99%/1%". Illustrative default; OPEN QUESTION for the hospital.
MIN_SPLIT_PCT = 10.0


def published_lines(tender: Tender) -> list[TenderLineItem]:
    return sorted((li for li in tender.line_items if li.published), key=lambda l: l.id)


def latest_round(db: Session, line: TenderLineItem) -> AwardRound | None:
    return db.query(AwardRound).filter(AwardRound.line_item_id == line.id).order_by(AwardRound.round_number.desc()).first()


def rounds_for(db: Session, line: TenderLineItem) -> list[AwardRound]:
    return db.query(AwardRound).filter(AwardRound.line_item_id == line.id).order_by(AwardRound.round_number).all()


def consecutive_rejections(db: Session, line: TenderLineItem) -> int:
    n = 0
    for r in reversed(rounds_for(db, line)):
        if r.status == REJECTED:
            n += 1
        elif r.status != DRAFT:
            break
    return n


def line_state(rnd: AwardRound | None) -> str:
    """none | draft | pending | approved | excluded | returned (rejected, awaiting a new recommendation)"""
    if rnd is None:
        return "none"
    if rnd.status == APPROVED:
        return "excluded" if rnd.kind == EXCLUDE else "approved"
    return "returned" if rnd.status == REJECTED else rnd.status


# ---------- Officer: recommendation ----------
def qualified_rows(line: TenderLineItem, db: Session) -> list:
    _, rows = commercial.build_statement(line, db)  # 409s until technical evaluation is closed
    return [r for r in rows if r.rank is not None]


def _editable_round(db: Session, line: TenderLineItem, user: UserAccount) -> AwardRound:
    rnd = latest_round(db, line)
    if rnd is None:
        rnd = AwardRound(line_item_id=line.id, round_number=1, status=DRAFT, recommended_by_id=user.id)
        db.add(rnd)
        db.flush()
        return rnd
    if rnd.status == DRAFT:
        return rnd
    if rnd.status == REJECTED:  # returned by the Approving Authority: the next round starts as a draft
        new = AwardRound(line_item_id=line.id, round_number=rnd.round_number + 1, status=DRAFT, recommended_by_id=user.id)
        db.add(new)
        db.flush()
        return new
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This line's recommendation is {rnd.status} and can't be changed")


def validate_allocations(line: TenderLineItem, allocations: list[dict], qualified: dict[int, object]) -> list[dict]:
    """Shares must total 100, use only technically qualified bids, and (when more
    than one vendor) each meet the minimum split threshold on Split-Award lines."""
    if not allocations:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose at least one vendor")
    ids = [a["bid_id"] for a in allocations]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A vendor can only appear once in a split")
    for a in allocations:
        if a["bid_id"] not in qualified:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only technically qualified bids on this line can be awarded")
        if not 0 < a["share_pct"] <= 100:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Each share must be between 0 and 100")
    if abs(sum(a["share_pct"] for a in allocations) - 100.0) > 0.01:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The shares must add up to 100%")
    if len(allocations) > 1:
        if not line.split_award_allowed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line was not flagged Split-Award allowed, so it can only go to one vendor")
        small = [a for a in allocations if a["share_pct"] < MIN_SPLIT_PCT]
        if small:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Each share of a split must be at least {MIN_SPLIT_PCT:g}%")
    return [{"bid_id": a["bid_id"], "share_pct": float(a["share_pct"])} for a in allocations]


def save_recommendation(db: Session, line: TenderLineItem, user: UserAccount, mode: str, bid_id: int | None, allocations: list[dict] | None, reason: str | None) -> AwardRound:
    if line.technical_closed_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Recommend only after the line's technical evaluation is closed")
    if line.tender.status in (TenderStatus.AWARDED, TenderStatus.NO_AWARD):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This tender is already awarded")
    reason = (reason or "").strip() or None
    rows = qualified_rows(line, db)
    by_bid = {r.bid.id: r for r in rows}
    top = rows[0] if rows else None
    rnd = _editable_round(db, line, user)
    before = {"kind": rnd.kind, "is_override": rnd.is_override, "allocations": [(a.bid_id, a.share_pct) for a in rnd.allocations if a.stage == PROPOSED]}

    if mode == "exclude":
        if not reason:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to leave a line out of the award")
        kind, allocs, override = EXCLUDE, [], False
    else:
        if top is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No technically qualified bid on this line: leave it out of the award (with a reason)")
        kind = AWARD
        if mode == "confirm_top":
            allocs = [{"bid_id": top.bid.id, "share_pct": 100.0}]
        elif mode == "other_vendor":
            if bid_id is None:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Choose the vendor you recommend")
            allocs = validate_allocations(line, [{"bid_id": bid_id, "share_pct": 100.0}], by_bid)
        elif mode == "split":
            allocs = validate_allocations(line, allocations or [], by_bid)
            if len(allocs) < 2:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A split needs at least two vendors")
        else:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown recommendation type")
        main = max(allocs, key=lambda a: a["share_pct"])
        override = main["bid_id"] != top.bid.id
        if override and not reason:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is mandatory when you recommend a vendor other than the system's L1/C1")

    rnd.kind, rnd.is_override, rnd.officer_reason = kind, override, reason
    rnd.system_top_bid_id = top.bid.id if top else None
    rnd.recommended_by_id = user.id
    rnd.recommended_at = datetime.now(timezone.utc)
    for a in [a for a in rnd.allocations if a.stage == PROPOSED]:
        rnd.allocations.remove(a)
    db.flush()
    for a in allocs:
        rnd.allocations.append(AwardAllocation(bid_id=a["bid_id"], share_pct=a["share_pct"], stage=PROPOSED))
    db.flush()
    t = line.tender
    record(
        db, "award.recommendation_saved", "tender", t.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name}", facility_id=t.facility_id,
        before=before, after={"kind": kind, "is_override": override, "allocations": [(a["bid_id"], a["share_pct"]) for a in allocs]}, reason=reason,
        meta={"line_item_id": line.id, "round_number": rnd.round_number, "mode": mode},
    )
    return rnd


def award_value(rnd: AwardRound) -> float:
    total = 0.0
    if rnd.kind != AWARD:
        return total
    for a in rnd.allocations:
        if a.stage == PROPOSED:
            b = a.bid
            landed = b.unit_price * (1 + (b.gst_percent or 0) / 100.0) + (b.other_duties or 0)
            total += landed * rnd.line_item.qty * a.share_pct / 100.0
    return total


def submit_for_approval(db: Session, tender: Tender, user: UserAccount) -> tuple[int, float, list[AwardRound]]:
    """Officer submits the tender's line recommendations for L1 approval. Every
    published line needs a recommendation (or an approved decision from an
    earlier round); the required tier comes from the total award value, one
    tier higher when any line has been rejected repeatedly (spec 7.3 point 5)."""
    if tender.status in (TenderStatus.AWARDED, TenderStatus.NO_AWARD):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This tender is already awarded")
    lines = published_lines(tender)
    drafts, missing = [], []
    for li in lines:
        rnd = latest_round(db, li)
        if rnd is not None and rnd.status == APPROVED:
            continue
        if rnd is not None and rnd.status == PENDING:
            continue
        if rnd is None or rnd.status != DRAFT:
            missing.append(li.product.name)
        else:
            drafts.append((li, rnd))
    if missing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Recommend (or leave out) every line first — missing: " + ", ".join(missing))
    if not drafts:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nothing to submit: no line has a recommendation waiting")
    total = sum(award_value(r) for _, r in drafts)
    tier = resolve_required_tier(total, tender.facility_id, db).tier
    if any(consecutive_rejections(db, li) >= MAX_ROUNDS_BEFORE_ESCALATION for li, _ in drafts):
        tier = escalate(tier)
    now = datetime.now(timezone.utc)
    for _, r in drafts:
        r.status, r.submitted_at, r.required_tier, r.award_value = PENDING, now, tier, award_value(r)
    db.flush()
    record(
        db, "award.submitted_for_l1_approval", "tender", tender.id, actor=user, entity_label=f"#{tender.id} {tender.title}", facility_id=tender.facility_id,
        after={"lines": [li.product.name for li, _ in drafts]}, meta={"required_tier": tier, "award_value": round(total, 2), "rounds": {li.id: r.round_number for li, r in drafts}},
    )
    return tier, total, [r for _, r in drafts]


# ---------- Approving Authority: decision ----------
def decide(db: Session, line: TenderLineItem, user: UserAccount, decision: str, comments: str | None, allocations: list[dict] | None) -> AwardRound:
    rnd = latest_round(db, line)
    if rnd is None or rnd.status != PENDING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line has no recommendation waiting for L1 approval")
    if not can_approve_tier(user, rnd.required_tier):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"This award needs an Approving Authority at tier {rnd.required_tier} or above")
    comments = (comments or "").strip() or None
    t = line.tender
    now = datetime.now(timezone.utc)

    if decision == "reject":
        if not comments:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Comments are required to reject a recommendation")
        rnd.status, rnd.decision_kind = REJECTED, REJECTED_DECISION
    else:
        if rnd.kind == EXCLUDE:
            if decision != "approve":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This line was recommended to be left out of the award; approve that or reject it")
            rnd.decision_kind = APPROVED_RECOMMENDATION
        else:
            rows = qualified_rows(line, db)
            by_bid = {r.bid.id: r for r in rows}
            proposed = [{"bid_id": a.bid_id, "share_pct": a.share_pct} for a in rnd.allocations if a.stage == PROPOSED]
            if decision == "award_system_l1":
                if not rnd.is_override or rnd.system_top_bid_id not in by_bid:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The Officer already recommended the system's L1/C1 for this line")
                final = [{"bid_id": rnd.system_top_bid_id, "share_pct": 100.0}]
                rnd.decision_kind = AWARDED_SYSTEM_L1
            elif decision == "approve":
                final = validate_allocations(line, allocations, by_bid) if allocations else proposed
                same = sorted((a["bid_id"], round(a["share_pct"], 2)) for a in final) == sorted((a["bid_id"], round(a["share_pct"], 2)) for a in proposed)
                rnd.decision_kind = APPROVED_RECOMMENDATION if same else APPROVED_ADJUSTED
            else:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown decision")
            for a in [a for a in rnd.allocations if a.stage == FINAL]:
                rnd.allocations.remove(a)
            db.flush()
            for a in final:
                rnd.allocations.append(AwardAllocation(bid_id=a["bid_id"], share_pct=a["share_pct"], stage=FINAL))
        rnd.status = APPROVED
    rnd.decided_by_id, rnd.decided_at, rnd.decision_comments = user.id, now, comments
    db.flush()
    record(
        db, "award.rejected" if rnd.status == REJECTED else "award.approved", "tender", t.id, actor=user, entity_label=f"#{t.id} {t.title} - {line.product.name}",
        facility_id=t.facility_id, reason=comments,
        after={"decision": rnd.decision_kind, "final": [(a.bid_id, a.share_pct) for a in rnd.allocations if a.stage == FINAL]},
        meta={"line_item_id": line.id, "round_number": rnd.round_number, "required_tier": rnd.required_tier, "override_recommended": rnd.is_override},
    )
    maybe_finalize(db, t, user)
    return rnd


def maybe_finalize(db: Session, tender: Tender, user: UserAccount) -> bool:
    """Every published line approved (or left out) -> Awarded: PO data files are
    generated (one per awarded vendor) and vendors are notified."""
    lines = published_lines(tender)
    rounds = [latest_round(db, li) for li in lines]
    if not lines or any(r is None or r.status != APPROVED for r in rounds):
        return False
    # If every line was left out, nothing was awarded: no PO files, and the tender is closed as such.
    anything_awarded = any(r.kind == AWARD for r in rounds)
    tender.status = TenderStatus.AWARDED if anything_awarded else TenderStatus.NO_AWARD
    tender.awarded_at = datetime.now(timezone.utc)
    files = po_files.generate_for_tender(db, tender, user, rounds)
    _notify_outcome(db, tender, rounds)
    record(
        db, "award.finalized", "tender", tender.id, actor=user, entity_label=f"#{tender.id} {tender.title}", facility_id=tender.facility_id,
        before={"status": TenderStatus.PUBLISHED}, after={"status": tender.status},
        meta={"po_data_files": [f.batch_id for f in files], "lines_awarded": sum(1 for r in rounds if r.kind == AWARD), "lines_left_out": sum(1 for r in rounds if r.kind == EXCLUDE)},
    )
    return True


def _notify_outcome(db: Session, tender: Tender, rounds: list[AwardRound]) -> None:
    """Spec 10.6: awarded vendors, and technically qualified vendors who did not
    win, are told once L1 approval is final (disqualification notices went out
    when technical evaluation closed)."""
    awarded: dict[int, list] = {}
    awarded_bids = set()
    for r in rounds:
        if r.kind != AWARD:
            continue
        for a in r.allocations:
            if a.stage == FINAL:
                awarded.setdefault(a.bid.vendor_id, []).append((r, a))
                awarded_bids.add(a.bid_id)
    for vendor_id, items in awarded.items():
        lines_txt, total = [], 0.0
        for r, a in items:
            b, li = a.bid, r.line_item
            qty = li.qty * a.share_pct / 100.0
            value = b.unit_price * qty
            total += value
            lines_txt.append(f"{li.product.name}: {qty:g} at ₹{b.unit_price:,.2f} per unit (₹{value:,.2f})")
        notify_vendor(
            db, vendor_id, "awarded", f"Awarded: {tender.title}",
            f"Congratulations. You have been awarded the following on tender #{tender.id} ({tender.title}):\n" + "\n".join(lines_txt) + f"\nTotal (before tax): ₹{total:,.2f}. The purchase order will be issued by the hospital.",
            tender.id, {"lines": len(items)},
        )
    regrets: dict[int, list[str]] = {}
    for r in rounds:
        li = r.line_item
        for bid in db.query(Bid).filter(Bid.tender_line_item_id == li.id, Bid.status == BidStatus.SUBMITTED).all():
            res = db.query(BidTechnicalResult).filter(BidTechnicalResult.bid_id == bid.id).first()
            if res and res.outcome == TechnicalDecision.QUALIFIED and bid.id not in awarded_bids:
                regrets.setdefault(bid.vendor_id, []).append(li.product.name)
    for vendor_id, names in regrets.items():
        notify_vendor(
            db, vendor_id, "regret", f"Tender outcome: {tender.title}",
            f"Thank you for bidding on tender #{tender.id} ({tender.title}). Your bid was technically qualified but was not selected for: {', '.join(names)}.",
            tender.id, {"lines": names},
        )


def tasks_for(db: Session, user: UserAccount) -> list[dict]:
    """Award-stage work waiting on this user, for the dashboard's action queue:
    the Officer's lines still needing a recommendation, the Approving
    Authority's submitted recommendations they may decide."""
    from app.models.user_account import Role

    out = []
    tenders = db.query(Tender).filter(Tender.status == TenderStatus.PUBLISHED).order_by(Tender.id).all()
    for t in tenders:
        lines = published_lines(t)
        states = [(li, latest_round(db, li)) for li in lines if li.technical_closed_at is not None]
        if not states:
            continue
        if user.role in (Role.PROCUREMENT_OFFICER, Role.SYSTEM_ADMIN):
            todo = [li for li, r in states if line_state(r) in ("none", "returned")]
            drafts = [li for li, r in states if line_state(r) == "draft"]
            if todo or drafts:
                out.append({"tender_id": t.id, "title": t.title, "kind": "recommend", "lines": len(todo) + len(drafts), "tier": None, "detail": f"{len(todo)} line(s) need a recommendation" + (f", {len(drafts)} ready to submit" if drafts else "")})
        if user.role in (Role.APPROVING_AUTHORITY, Role.SYSTEM_ADMIN):
            pend = [r for _, r in states if r is not None and r.status == PENDING and can_approve_tier(user, r.required_tier)]
            if pend:
                out.append({"tender_id": t.id, "title": t.title, "kind": "decide", "lines": len(pend), "tier": pend[0].required_tier, "detail": f"{len(pend)} line(s) waiting for L1 approval"})
    return out
