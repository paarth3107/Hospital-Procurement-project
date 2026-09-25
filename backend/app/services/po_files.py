"""PO data files (spec §10.3-10.5, §10.7): one file per awarded vendor per
tender, built only from the L1-approved allocations. The content is frozen in
`PoDataFile.payload`; CSV / XML are rendered from it, never edited. Column and
element names are illustrative until the hospital ERP's import template is known
(spec §17). This system's responsibility ends at the generated file."""

import csv
import io
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.award import FINAL, PoDataFile
from app.models.tender import Tender
from app.models.user_account import UserAccount

CSV_COLUMNS = [
    "batch_id", "version", "tender_reference", "tender_title", "facility_code", "department", "budget_code",
    "vendor_code", "vendor_gstin", "vendor_name",
    "line_no", "item_code", "description", "procurement_type", "quantity", "uom", "allocation_pct",
    "unit_price", "gst_percent", "other_duties_per_unit", "line_total", "line_total_incl_tax",
    "delivery_lead_days", "delivery_location", "payment_terms",
    "approved_by_id", "approved_by", "approved_at",
]


def _r(x):
    return round(x, 2) if x is not None else None


def build_payload(tender: Tender, vendor, lines: list, batch_id: str, version: int, approver: UserAccount) -> dict:
    """`lines` = [(line_item, bid, share_pct, award_round)] for one vendor."""
    out_lines = []
    for n, (li, bid, share, rnd) in enumerate(sorted(lines, key=lambda x: x[0].id), start=1):
        qty = li.qty * share / 100.0
        gst = bid.gst_percent or 0.0
        duties = bid.other_duties or 0.0
        out_lines.append(
            {
                "line_no": n, "line_item_id": li.id, "item_code": li.product.code, "description": li.product.name,
                "procurement_type": li.procurement_type.value, "quantity": _r(qty), "uom": li.product.unit_of_measure, "allocation_pct": _r(share),
                "split_award": share < 100.0, "unit_price": _r(bid.unit_price), "gst_percent": gst, "other_duties_per_unit": _r(duties),
                "line_total": _r(bid.unit_price * qty), "line_total_incl_tax": _r((bid.unit_price * (1 + gst / 100.0) + duties) * qty),
                "delivery_lead_days": bid.delivery_lead_days, "delivery_location": (li.line_details or {}).get("delivery_location"),
                "payment_terms": bid.payment_terms, "source_bid_id": bid.id,
                "approved_by_id": rnd.decided_by_id, "approved_by": rnd.decided_by.full_name if getattr(rnd, "decided_by", None) else None,
                "approved_at": rnd.decided_at.astimezone(timezone.utc).isoformat() if rnd.decided_at else None,
            }
        )
    return {
        "batch_id": batch_id, "version": version,
        "tender": {"id": tender.id, "reference": f"TND-{tender.id}", "title": tender.title, "department": tender.department},
        "facility_code": tender.facility.legal_entity_code, "facility_name": tender.facility.name, "budget_code": None,
        "vendor": {"code": f"V-{vendor.id}", "name": vendor.legal_name, "gstin": vendor.gstin},
        "approval": {"approver_id": approver.id, "approver_name": approver.full_name, "approved_at": datetime.now(timezone.utc).isoformat()},
        "lines": out_lines,
    }


def render_csv(payload: dict) -> str:
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=CSV_COLUMNS, lineterminator="\n")
    w.writeheader()
    for l in payload["lines"]:
        w.writerow(
            {
                "batch_id": payload["batch_id"], "version": payload["version"], "tender_reference": payload["tender"]["reference"],
                "tender_title": payload["tender"]["title"], "facility_code": payload["facility_code"], "department": payload["tender"]["department"] or "",
                "budget_code": payload["budget_code"] or "", "vendor_code": payload["vendor"]["code"], "vendor_gstin": payload["vendor"]["gstin"], "vendor_name": payload["vendor"]["name"],
                "line_no": l["line_no"], "item_code": l["item_code"], "description": l["description"], "procurement_type": l["procurement_type"],
                "quantity": l["quantity"], "uom": l["uom"] or "", "allocation_pct": l["allocation_pct"], "unit_price": l["unit_price"], "gst_percent": l["gst_percent"],
                "other_duties_per_unit": l["other_duties_per_unit"], "line_total": l["line_total"], "line_total_incl_tax": l["line_total_incl_tax"],
                "delivery_lead_days": "" if l["delivery_lead_days"] is None else l["delivery_lead_days"], "delivery_location": l["delivery_location"] or "",
                "payment_terms": l["payment_terms"] or "", "approved_by_id": l["approved_by_id"], "approved_by": l["approved_by"] or "", "approved_at": l["approved_at"] or "",
            }
        )
    return out.getvalue()


def render_xml(payload: dict) -> str:
    root = ET.Element("PODataBatch", batchId=payload["batch_id"], version=str(payload["version"]))
    header = ET.SubElement(root, "Header")
    for tag, val in (
        ("TenderReference", payload["tender"]["reference"]), ("TenderTitle", payload["tender"]["title"]), ("FacilityCode", payload["facility_code"]),
        ("Department", payload["tender"]["department"]), ("BudgetCode", payload["budget_code"]), ("VendorCode", payload["vendor"]["code"]),
        ("VendorGSTIN", payload["vendor"]["gstin"]), ("VendorName", payload["vendor"]["name"]), ("ApprovingAuthorityId", payload["approval"]["approver_id"]),
        ("ApprovingAuthority", payload["approval"]["approver_name"]), ("ApprovedAt", payload["approval"]["approved_at"]),
    ):
        ET.SubElement(header, tag).text = "" if val is None else str(val)
    lines = ET.SubElement(root, "Lines")
    for l in payload["lines"]:
        el = ET.SubElement(lines, "Line", no=str(l["line_no"]))
        for tag, key in (
            ("ItemCode", "item_code"), ("Description", "description"), ("ProcurementType", "procurement_type"), ("Quantity", "quantity"), ("UOM", "uom"),
            ("AllocationPct", "allocation_pct"), ("UnitPrice", "unit_price"), ("GSTPercent", "gst_percent"), ("OtherDutiesPerUnit", "other_duties_per_unit"),
            ("LineTotal", "line_total"), ("LineTotalInclTax", "line_total_incl_tax"), ("DeliveryLeadDays", "delivery_lead_days"),
            ("DeliveryLocation", "delivery_location"), ("PaymentTerms", "payment_terms"), ("ApprovedById", "approved_by_id"), ("ApprovedBy", "approved_by"), ("ApprovedAt", "approved_at"),
        ):
            ET.SubElement(el, tag).text = "" if l[key] is None else str(l[key])
    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def generate_for_tender(db: Session, tender: Tender, approver: UserAccount, final_rounds: list) -> list[PoDataFile]:
    """One file per awarded vendor, consolidating every line (or share of a
    line) awarded to them. `final_rounds` are the tender's approved award
    rounds. Every value comes from the approved allocation and the bid it points at."""
    per_vendor: dict[int, list] = defaultdict(list)
    for rnd in final_rounds:
        if rnd.kind != "award":
            continue
        for a in rnd.allocations:
            if a.stage == FINAL:
                per_vendor[a.bid.vendor_id].append((rnd.line_item, a.bid, a.share_pct, rnd))
    files = []
    for vendor_id, lines in sorted(per_vendor.items()):
        vendor = lines[0][1].vendor
        batch_id = f"POB-{tender.id}-{vendor_id}-v1"
        po = PoDataFile(
            batch_id=batch_id, tender_id=tender.id, vendor_id=vendor_id, version=1, status="pending_upload", generated_by_id=approver.id,
            payload=build_payload(tender, vendor, lines, batch_id, 1, approver),
        )
        db.add(po)
        files.append(po)
    db.flush()
    return files


def re_export(db: Session, po: PoDataFile, user: UserAccount, reason: str) -> PoDataFile:
    """A new version of a file whose import failed. The values come from the
    approved award again, so price and quantity cannot change; what may change
    is vendor master data the ERP rejected (name, GSTIN). The old version is
    kept and marked superseded (spec 10.7)."""
    if po.status != "import_failed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a file whose ERP import failed can be re-exported")
    if not reason or not reason.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A reason is required to re-export")
    from app.models.award import AwardRound

    tender, vendor = po.tender, po.vendor
    rounds = (
        db.query(AwardRound)
        .filter(AwardRound.status == "approved", AwardRound.line_item_id.in_([li.id for li in tender.line_items]))
        .order_by(AwardRound.round_number.desc())
        .all()
    )
    latest = {}
    for r in rounds:
        latest.setdefault(r.line_item_id, r)
    lines = []
    for r in latest.values():
        if r.kind != "award":
            continue
        for a in r.allocations:
            if a.stage == FINAL and a.bid.vendor_id == po.vendor_id:
                lines.append((r.line_item, a.bid, a.share_pct, r))
    version = po.version + 1
    base = po.batch_id.rsplit("-v", 1)[0]
    new = PoDataFile(
        batch_id=f"{base}-v{version}", tender_id=tender.id, vendor_id=vendor.id, version=version, status="pending_upload", generated_by_id=po.generated_by_id,
        supersedes_id=po.id, status_reason=f"Re-export: {reason.strip()}", payload=build_payload(tender, vendor, lines, f"{base}-v{version}", version, po.generated_by or user),
    )
    po.status = "superseded"
    po.status_changed_at = datetime.now(timezone.utc)
    po.status_changed_by_id = user.id
    db.add(new)
    db.flush()
    return new
