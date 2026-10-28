"""ADDITIVE test-tender seed for manual QA. Run AFTER app.seed_test_vendors,
app.seed_test_catalog and app.seed_test_mappings. Never deletes anything; a
tender whose title already exists is skipped, so it is safe to re-run.

Creates 13 tenders titled "[TEST] ..." covering every stage of the lifecycle
(draft, returned, pending approval, scheduled, live bidding, closing soon, open
tender, rate contract, bid window closed, awaiting award approval, awarded with
PO files, no award, withdrawn). Invites come from the REAL eligibility
resolver, so they reflect the vendor mappings and statuses seeded earlier.

No real email is sent: vendor notifications are written as plain rows.

Run from the backend folder:
    venv\\Scripts\\python.exe -m app.seed_test_tenders
"""

import os
import secrets
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())

from app import models  # noqa: E402,F401
from app.database import SessionLocal  # noqa: E402
from app.models.award import AWARD, EXCLUDE, FINAL, PENDING as R_PENDING, PROPOSED, AwardAllocation, AwardRound, Notification  # noqa: E402
from app.models.award import APPROVED as R_APPROVED  # noqa: E402
from app.models.bid import Bid, BidAttachment, BidAttachmentKind, BidStatus  # noqa: E402
from app.models.bid_evaluation import BidEvaluation, BidTechnicalResult, TechnicalDecision  # noqa: E402
from app.models.product_master import ProductMaster  # noqa: E402
from app.models.tender import Tender, TenderStatus, TenderType  # noqa: E402
from app.models.tender_approval_round import RoundDecision, TenderApprovalRound  # noqa: E402
from app.models.tender_attachment import TenderLineAttachment, TenderLineAttachmentKind  # noqa: E402
from app.models.tender_invite import TenderInvite  # noqa: E402
from app.models.tender_line_exclusion import TenderLineExclusion  # noqa: E402
from app.models.tender_line_item import TenderLineItem  # noqa: E402
from app.models.user_account import UserAccount  # noqa: E402
from app.models.vendor import Vendor  # noqa: E402
from app.seed import pdf_bytes  # noqa: E402
from app.services.approval_matrix import resolve_required_tier  # noqa: E402
from app.services.audit import record  # noqa: E402
from app.services.eligibility import resolve_eligible_vendors  # noqa: E402
from app.services.po_files import generate_for_tender  # noqa: E402

NOW = datetime.now(timezone.utc).replace(microsecond=0)
FACILITY_ID = 1
S, D, W, L = BidStatus.SUBMITTED, BidStatus.DRAFT, BidStatus.WITHDRAWN, BidStatus.PENDING_LATE_EXCEPTION
Q, DQ = TechnicalDecision.QUALIFIED, TechnicalDecision.DISQUALIFIED


def ago(days=0, hours=0):
    return NOW - timedelta(days=days, hours=hours)


def ahead(days=0, hours=0):
    return NOW + timedelta(days=days, hours=hours)


# status key, title, type, department, publish/due, flags, lines
# line = (product code, qty, estimated price, [bids]) ; bid = (vendor id, status, unit price, gst %, lead days, brand, submitted days ago)
# Vendor ids below are real ids in the current DB: 1 MedEquip, 2 SurgiCare, 3 PharmaLink, 4 CleanTech, 8 Arogya Pharma,
# 9 Apex Surgical, 10 LifeLine Pharma, 11 TechMed IT, 12 PureClean, 16 QuickServe (suspended).
TENDERS = [
    dict(key="draft", title="[TEST] Draft - Surgical Instruments Set", ttype=TenderType.RFQ, status=TenderStatus.DRAFT, dept="Operation Theatre",
         created=ago(2), lines=[("SURG-FORC-001", 100, 600, []), ("SURG-SCIS-001", 50, 900, [])]),
    dict(key="returned", title="[TEST] Returned for Changes - IT Desktops", ttype=TenderType.RFQ, status=TenderStatus.DRAFT, dept="IT",
         created=ago(5), round=("rejected", "Estimated price is too high against recent purchases, please revise and resubmit."),
         lines=[("IT-DESKTOP-001", 20, 65000, [])]),
    dict(key="pending", title="[TEST] Awaiting Approval - ICU Beds", ttype=TenderType.RFP, status=TenderStatus.PENDING_APPROVAL, dept="Critical Care",
         created=ago(1), round=("pending", None), due=ahead(15),
         lines=[("ICU-BED-001", 5, 190000, [])]),
    dict(key="scheduled", title="[TEST] Scheduled - Masks & Gowns Supply", ttype=TenderType.RFQ, status=TenderStatus.SCHEDULED, dept="Central Stores",
         created=ago(2), publish=ahead(3), due=ahead(14), round=("approved", "Approved"),
         lines=[("SURG-MASK-001", 40000, 180, []), ("SURG-GOWN-001", 6000, 250, [])]),
    dict(key="live", title="[TEST] Live Bidding - Surgical Consumables", ttype=TenderType.RFQ, status=TenderStatus.PUBLISHED, dept="Central Stores",
         created=ago(6), publish=ago(4), due=ahead(5), round=("approved", "Approved"),
         lines=[
             ("SURG-GLOVES-001", 10000, 900, [(10, S, 870, 12, 5, "Supermax", 2), (1, S, 885, 12, 6, "Ansell", 1), (3, D, 890, 12, 7, "Ansell", None)]),
             ("MED-SYRINGE-001", 20000, 600, [(10, S, 575, 12, 4, "Dispovan", 1)]),
             ("SURG-MASK-001", 30000, 180, []),
         ],
         exclusions=[("SURG-MASK-001", 3, "Quality concern on last PPE delivery - excluded from masks pending resolution")]),
    dict(key="closing", title="[TEST] Closing Soon - Patient Monitors", ttype=TenderType.RFP, status=TenderStatus.PUBLISHED, dept="Critical Care",
         created=ago(8), publish=ago(7), due=ahead(1, 4), round=("approved", "Approved"),
         lines=[("PT-MONITOR-001", 6, 140000, [(9, S, 132000, 18, 30, "Mindray", 1), (8, D, 138000, 18, 25, "Philips", None)])]),
    dict(key="open", title="[TEST] Open Tender - Surgical Forceps", ttype=TenderType.RFQ, status=TenderStatus.PUBLISHED, dept="Operation Theatre", open_tender=True,
         created=ago(3), publish=ago(2), due=ahead(9), round=("approved", "Approved"),
         lines=[("SURG-FORC-001", 200, 600, [(9, S, 560, 12, 7, "Aesculap", 1)])]),
    dict(key="ratecontract", title="[TEST] Rate Contract - Annual Syringes", ttype=TenderType.RFQ, status=TenderStatus.PUBLISHED, dept="Central Stores", rate_contract=True,
         created=ago(4), publish=ago(3), due=ahead(7), round=("approved", "Approved"),
         lines=[("MED-SYRINGE-001", 50000, 600, [(3, S, 590, 12, 5, "Dispovan", 1)])]),
    dict(key="closed", title="[TEST] Bid Window Closed - Gloves & Bandages", ttype=TenderType.RFQ, status=TenderStatus.PUBLISHED, dept="Central Stores",
         created=ago(15), publish=ago(12), due=ago(2), round=("approved", "Approved"),
         lines=[
             ("SURG-GLOVES-001", 8000, 900, [(1, S, 880, 12, 6, "Ansell", 5), (10, S, 860, 12, 5, "Supermax", 4), (3, L, 840, 12, 4, "Ansell", 0)]),
             ("MED-BANDAGE-001", 12000, 85, [(3, S, 80, 12, 4, "Dynaplast", 6), (10, S, 78, 12, 5, "Dynaplast", 5)]),
         ]),
    dict(key="award_pending", title="[TEST] Award Pending Approval - Masks & Gowns", ttype=TenderType.RFQ, status=TenderStatus.PUBLISHED, dept="Central Stores",
         created=ago(20), publish=ago(16), due=ago(6), round=("approved", "Approved"), technical=True,
         lines=[
             ("SURG-MASK-001", 40000, 180, [(3, S, 175, 12, 5, "3M", 8, Q), (10, S, 168, 12, 6, "Medline", 8, Q)]),
             ("SURG-GOWN-001", 6000, 250, [(3, S, 245, 12, 5, "Medline", 8, Q), (10, S, 238, 12, 7, "Medline", 8, DQ)]),
         ],
         recommend={0: 10, 1: 3}),
    dict(key="awarded", title="[TEST] Awarded - ICU Beds & Monitors", ttype=TenderType.RFP, status=TenderStatus.AWARDED, dept="Critical Care",
         created=ago(40), publish=ago(34), due=ago(25), round=("approved", "Approved"), technical=True, awarded=True,
         lines=[
             ("ICU-BED-001", 10, 190000, [(3, S, 182000, 18, 30, "Hillrom", 28, Q), (9, S, 188000, 18, 21, "Linet", 28, Q)]),
             ("PT-MONITOR-001", 6, 140000, [(8, S, 138000, 18, 25, "Philips", 28, Q), (9, S, 131000, 18, 30, "Mindray", 28, Q)]),
         ],
         award={0: [(3, 60), (9, 40)], 1: [(9, 100)]}),  # line 0 is a split award
    dict(key="noaward", title="[TEST] No Award - Bandage Spot Purchase", ttype=TenderType.RFQ, status=TenderStatus.NO_AWARD, dept="Central Stores",
         created=ago(30), publish=ago(24), due=ago(18), round=("approved", "Approved"), no_award=True,
         lines=[("MED-BANDAGE-001", 200, 85, [])]),
    dict(key="withdrawn", title="[TEST] Withdrawn - Syringes Spot Buy", ttype=TenderType.RFQ, status=TenderStatus.WITHDRAWN, dept="Central Stores",
         created=ago(12), publish=ago(10), due=ago(3), round=("approved", "Approved"),
         lines=[("MED-SYRINGE-001", 1000, 600, [])]),
]


def attach_line(db, li, kind, title, uploader_id):
    content = pdf_bytes(title)
    db.add(TenderLineAttachment(tender_line_item_id=li.id, kind=kind, original_filename=title.lower().replace(" ", "_") + ".pdf",
                                content_type="application/pdf", size_bytes=len(content), content=content, uploaded_by_id=uploader_id))


def landed(b):
    return b.unit_price * (1 + (b.gst_percent or 0) / 100.0) + (b.other_duties or 0)


def main() -> None:
    db = SessionLocal()
    try:
        by_email = lambda e: db.query(UserAccount).filter_by(email=e).one()  # noqa: E731
        officer, cm = by_email("officer@medsource.local"), by_email("category@medsource.local")
        auth1, auth3 = by_email("authority1@medsource.local"), by_email("authority3@medsource.local")
        products = {p.code: p for p in db.query(ProductMaster).all()}
        vendors = {v.id: v for v in db.query(Vendor).all()}
        made, warnings = [], []

        for spec in TENDERS:
            if db.query(Tender).filter_by(title=spec["title"]).first():
                continue
            status = spec["status"]
            published_states = {TenderStatus.SCHEDULED, TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD, TenderStatus.WITHDRAWN}
            is_live = status in published_states
            t = Tender(
                facility_id=FACILITY_ID, title=spec["title"], description=f"{spec['title'][7:]}. Delivery to {spec['dept']}, City Central Hospital.",
                tender_type=spec["ttype"], status=status, department=spec["dept"], created_by_id=officer.id, created_at=spec["created"],
                publish_date=spec.get("publish"), bid_due_date=spec.get("due"),
                published_at=spec.get("publish") if status in (TenderStatus.PUBLISHED, TenderStatus.AWARDED, TenderStatus.NO_AWARD, TenderStatus.WITHDRAWN) else None,
                round_number=1 if spec.get("round") else 0,
                consecutive_rejections=1 if spec.get("round", (None,))[0] == "rejected" else 0,
                open_tender=spec.get("open_tender", False), open_link_token=secrets.token_urlsafe(24) if spec.get("open_tender") else None,
                is_rate_contract=spec.get("rate_contract", False),
                contract_start_date=date.today() + timedelta(days=15) if spec.get("rate_contract") else None,
                contract_end_date=date.today() + timedelta(days=380) if spec.get("rate_contract") else None,
                awarded_at=ago(20) if spec.get("awarded") else None,
            )
            db.add(t)
            db.flush()
            record(db, "tender.created", "tender", t.id, actor=officer, entity_label=f"#{t.id} {t.title}", facility_id=FACILITY_ID)

            lines = []
            for idx, (code, qty, est, bids) in enumerate(spec["lines"]):
                p = products[code]
                li = TenderLineItem(tender_id=t.id, product_master_id=p.id, procurement_type=p.procurement_type, qty=qty, estimated_price=est,
                                    published=is_live, line_details={}, created_at=t.created_at)
                if spec.get("technical") or spec.get("no_award"):
                    li.technical_closed_at, li.technical_closed_by_id = (t.bid_due_date or NOW) + timedelta(hours=6), cm.id
                if code == "ICU-BED-001" and spec["key"] == "awarded":
                    li.split_award_allowed = True
                db.add(li)
                db.flush()
                lines.append((li, bids))
                if p.procurement_type.value == "asset":
                    attach_line(db, li, TenderLineAttachmentKind.TECHNICAL_SPEC_SHEET, f"{p.name} Technical Spec", officer.id)

            # approval round
            if spec.get("round"):
                decision, comments = spec["round"]
                total = sum(q * e for _, q, e, _b in spec["lines"])
                tier = resolve_required_tier(total, FACILITY_ID, db).tier
                submitted = (spec.get("publish") or t.created_at) - timedelta(days=1)
                rnd = TenderApprovalRound(tender_id=t.id, round_number=1, decision=RoundDecision(decision), required_tier=tier, submitted_by_id=officer.id, submitted_at=submitted)
                record(db, "tender.submitted_for_approval", "tender", t.id, actor=officer, entity_label=f"#{t.id} {t.title}", facility_id=FACILITY_ID, meta={"required_tier": tier})
                if decision != "pending":
                    rnd.reviewer_id, rnd.comments, rnd.decided_at = (auth3.id if tier >= 3 else auth1.id), comments, submitted + timedelta(hours=20)
                    record(db, f"tender.{'approved' if decision == 'approved' else 'rejected'}", "tender", t.id, actor=auth3 if tier >= 3 else auth1,
                           entity_label=f"#{t.id} {t.title}", facility_id=FACILITY_ID, reason=comments)
                db.add(rnd)

            # invites from the real resolver (skip lines of tenders that are not yet live)
            excluded = {(codes, vid) for codes, vid, _ in spec.get("exclusions", [])}
            for li, bids in lines:
                for codes, vid, reason in spec.get("exclusions", []):
                    if products[codes].id == li.product_master_id:
                        db.add(TenderLineExclusion(tender_line_item_id=li.id, vendor_id=vid, reason=reason, created_at=ago(1)))
                if not is_live:
                    continue
                invited = []
                for ev in resolve_eligible_vendors(li, db):
                    if (li.product.code, ev.vendor.id) in excluded:
                        continue
                    db.add(TenderInvite(tender_line_item_id=li.id, vendor_id=ev.vendor.id, source="open" if t.open_tender else "system",
                                        rating_at_resolution=round(ev.rating_score, 2), is_unrated_at_resolution=ev.is_unrated, created_at=t.published_at or t.created_at))
                    invited.append(ev.vendor.id)
                for b in bids:
                    if b[0] not in invited:
                        warnings.append(f"{spec['key']}: vendor {b[0]} bid on {li.product.code} but is not in the resolved invite list")

            # bids
            bid_rows = {}
            for li, bids in lines:
                for b in bids:
                    vid, bst, price, gst, lead, brand, sub_days = b[:7]
                    bid = Bid(tender_line_item_id=li.id, vendor_id=vid, status=bst, unit_price=price, gst_percent=gst, other_duties=0, delivery_lead_days=lead,
                              quote_validity_days=90, payment_terms=vendors[vid].payment_terms, compliant_full=True, brand_offered=brand,
                              details={"shelf_life_months": 20} if li.procurement_type.value == "item" else {},
                              submitted_at=ago(sub_days) if sub_days is not None and bst != D else None, created_at=ago((sub_days or 1) + 0.5))
                    db.add(bid)
                    db.flush()
                    bid_rows[(li.id, vid)] = (bid, b[7] if len(b) > 7 else None)
                    if bst == S and li.procurement_type.value != "item":
                        content = pdf_bytes(f"{vendors[vid].legal_name} datasheet")
                        db.add(BidAttachment(bid_id=bid.id, kind=BidAttachmentKind.DATASHEET, original_filename="datasheet.pdf", content_type="application/pdf",
                                             size_bytes=len(content), content=content))

            # technical evaluation results
            if spec.get("technical"):
                for (lid, vid), (bid, outcome) in bid_rows.items():
                    if outcome is None:
                        continue
                    db.add(BidEvaluation(bid_id=bid.id, evaluator_id=cm.id, decision=outcome,
                                         comments="Meets specification" if outcome == Q else "Sterility test certificate missing"))
                    db.add(BidTechnicalResult(bid_id=bid.id, outcome=outcome, reason=None if outcome == Q else "Sterility test certificate missing"))
            db.flush()

            # award recommendations / decisions
            rounds = []
            if spec.get("recommend"):  # pending L1 approval: recommend the named vendor per line
                for idx, (li, bids) in enumerate(lines):
                    qualified = [bid_rows[(li.id, b[0])][0] for b in bids if b[7] == Q]
                    low = min(qualified, key=lambda x: x.unit_price)
                    win = bid_rows[(li.id, spec["recommend"][idx])][0]
                    value = landed(win) * li.qty
                    tier = resolve_required_tier(value, FACILITY_ID, db).tier
                    ar = AwardRound(line_item_id=li.id, round_number=1, status=R_PENDING, kind=AWARD, system_top_bid_id=low.id, is_override=win.id != low.id,
                                    officer_reason="L1, qualified", recommended_by_id=officer.id, recommended_at=ago(3), submitted_at=ago(2), required_tier=tier, award_value=value)
                    db.add(ar)
                    db.flush()
                    db.add(AwardAllocation(round_id=ar.id, bid_id=win.id, share_pct=100, stage=PROPOSED))
                record(db, "award.submitted_for_l1_approval", "tender", t.id, actor=officer, entity_label=f"#{t.id} {t.title}", facility_id=FACILITY_ID)
            if spec.get("award"):
                for idx, (li, bids) in enumerate(lines):
                    split = spec["award"][idx]
                    qualified = [bid_rows[(li.id, b[0])][0] for b in bids if b[7] == Q]
                    low = min(qualified, key=lambda x: x.unit_price)
                    value = sum(landed(bid_rows[(li.id, vid)][0]) * li.qty * pct / 100 for vid, pct in split)
                    tier = resolve_required_tier(value, FACILITY_ID, db).tier
                    top = bid_rows[(li.id, split[0][0])][0]
                    ar = AwardRound(line_item_id=li.id, round_number=1, status=R_APPROVED, kind=AWARD, system_top_bid_id=low.id, is_override=top.id != low.id or len(split) > 1,
                                    officer_reason="Split award for supply continuity" if len(split) > 1 else "L1, qualified", recommended_by_id=officer.id,
                                    recommended_at=ago(24), submitted_at=ago(23), required_tier=tier, award_value=value, decision_kind="approved_recommendation",
                                    decided_by_id=auth3.id, decided_at=ago(20), decision_comments="Approved")
                    db.add(ar)
                    db.flush()
                    for vid, pct in split:
                        for stage in (PROPOSED, FINAL):
                            db.add(AwardAllocation(round_id=ar.id, bid_id=bid_rows[(li.id, vid)][0].id, share_pct=pct, stage=stage))
                    rounds.append(ar)
                db.flush()
                for r in rounds:
                    db.refresh(r)
                for f in generate_for_tender(db, t, auth3, rounds):
                    f.generated_at = ago(20)
                for li, _ in lines:
                    for vid in {a.bid.vendor_id for r in rounds if r.line_item_id == li.id for a in r.allocations}:
                        db.add(Notification(vendor_id=vid, kind="awarded", title=f"Awarded: {t.title[7:]}", body=f"Your bid for {li.product.name} was awarded.", tender_id=t.id, created_at=ago(20)))
                    for b in [x for x in db.query(Bid).filter_by(tender_line_item_id=li.id).all() if x.vendor_id not in {a.bid.vendor_id for r in rounds if r.line_item_id == li.id for a in r.allocations}]:
                        db.add(Notification(vendor_id=b.vendor_id, kind="regret", title=f"Not selected: {li.product.name}", body=f"Another bid was selected on tender #{t.id}.", tender_id=t.id, created_at=ago(20)))
            if spec.get("no_award"):
                for li, _ in lines:
                    db.add(AwardRound(line_item_id=li.id, round_number=1, status=R_APPROVED, kind=EXCLUDE, decision_kind="auto_no_bids",
                                      recommended_at=ago(17), decided_at=ago(17), decision_comments="No bids received"))
            if is_live and status in (TenderStatus.PUBLISHED,) and spec["key"] in ("live", "closing", "open"):
                for ev in {i.vendor_id for li, _ in lines for i in db.query(TenderInvite).filter_by(tender_line_item_id=li.id).all()}:
                    db.add(Notification(vendor_id=ev, kind="invited", title=f"Invited: {t.title[7:]}", body="You are invited to bid on this tender.", tender_id=t.id, created_at=t.published_at))
            made.append(t)

        db.commit()
        print(f"Created {len(made)} tenders")
        for t in made:
            print(f"  #{t.id:<3} {t.status.value:17} {t.title}")
        for w in warnings:
            print("WARNING:", w)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
