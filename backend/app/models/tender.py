import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, Enum, Float, ForeignKey, Integer, LargeBinary, String, Text, false
from sqlalchemy.orm import relationship

from app.database import Base, UTCDateTime


class TenderType(str, enum.Enum):
    """Spec §6.2. Neither Open Tender nor Rate Contract is a type here: each is
    a flag on a tender (`open_tender` 2026-10-06, `is_rate_contract` 2026-10-07),
    because each changes one thing about how the tender runs -- who's invited,
    or how long the agreed price binds -- not RFQ/RFP's actual difference
    (price-only vs technical + commercial)."""

    RFQ = "rfq"
    RFP = "rfp"


class TenderStatus(str, enum.Enum):
    """Spec §7.3/§7.4 state machine. Only Draft/Pending/Published/Withdrawn
    are reachable in this phase — Bid Window Closed onward belongs to
    Bidding/Evaluation/Award (Phases 4-6, IMPLEMENTATION-SPEC.md §11).

    SCHEDULED added 2026-10-16 -- real bug: Publish Date (spec §6.3 "Bid
    submission window opens per the tender's Publish Date/Bid Due Date") was
    captured at tender creation and shown on the approval screen, but
    nothing ever read it -- approve_tender() always flipped straight to
    PUBLISHED regardless. A tender approved with a future publish date now
    lands here instead; every status check elsewhere in the app that gates
    vendor visibility/bidding on `status == PUBLISHED` (bids.py's
    lock_reason, evaluation.py/awards.py/vendor_portal.py's filters) already
    excludes this by construction, with no changes needed there --
    services/tender_publish.py's sweep is the only thing that moves a tender
    out of this state, once its publish_date arrives."""

    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    SCHEDULED = "scheduled"
    PUBLISHED = "published"
    WITHDRAWN = "withdrawn"
    NO_AWARD = "no_award"  # every line was left out of the award: closed with nothing awarded, no PO files
    AWARDED = "awarded"  # spec 10.2 point 6: every line approved (or excluded); PO data files generated


class Tender(Base):
    __tablename__ = "tenders"

    id = Column(Integer, primary_key=True)
    # Nullable (2026-10-01, user-directed): a Draft tolerates an unset
    # facility -- required only by the time it's actually submitted for
    # approval (app/routers/tenders.py's submit_for_approval), since
    # everything downstream of that point (approval matrix, PO facility
    # code) genuinely needs a real one.
    facility_id = Column(Integer, ForeignKey("facilities.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    tender_type = Column(Enum(TenderType), nullable=False)
    status = Column(Enum(TenderStatus), nullable=False, default=TenderStatus.DRAFT)
    department = Column(String(255), nullable=True)
    awarded_at = Column(UTCDateTime(), nullable=True)
    # Spec §6.2: payment terms, delivery terms, penalty clauses, validity period.
    # A mandatory uploaded document (2026-10-07, user-directed), not free text --
    # vendors and approvers read the actual document rather than a typed summary.
    # Required before submission (tenders.py), same split as facility_id/title: a
    # Draft tolerates it unset. Uploading again replaces whatever was there, so
    # there's only ever one -- one row embedded on Tender, not a child table,
    # since a tender never has more than one.
    terms_document_filename = Column(String(255), nullable=True)
    terms_document_content_type = Column(String(255), nullable=True)
    terms_document_size = Column(Integer, nullable=True)
    # length hint (2026-10-08) -- MySQL maps a bare LargeBinary to BLOB, a 64KB
    # cap; the hint picks MEDIUMBLOB (16MB) instead, matching document_store's
    # own 10MB upload limit. Postgres/sqlite ignore the hint (BYTEA/BLOB already
    # unbounded), so this is MySQL-only in effect.
    terms_document_content = Column(LargeBinary(length=16_777_215), nullable=True)
    terms_document_uploaded_at = Column(UTCDateTime(), nullable=True)
    terms_document_uploaded_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)

    # Spec §6.2 — tender-wide defaults, overridable per line item.
    min_rating_threshold = Column(Float, nullable=False, default=0.0)
    min_invites = Column(Integer, nullable=True)
    max_invites = Column(Integer, nullable=True)
    # Open Tender (2026-10-06): every Active vendor is invited, with no mapping or
    # rating filter and no cap. Activation status is still required.
    open_tender = Column(Boolean, nullable=False, default=False, server_default=false())
    # The link a new vendor registers through to bid on this Open Tender (2026-10-06).
    open_link_token = Column(String(255), unique=True, nullable=True)
    # Rate Contract (2026-10-07): the vendor who wins a line commits to supply at
    # that price for this window, and the hospital buys against it for that long
    # -- a flag, not a tender type, same reasoning as open_tender above. Both
    # dates are required before submission (tenders.py), same split as
    # facility_id/title: a Draft tolerates them unset.
    is_rate_contract = Column(Boolean, nullable=False, default=False, server_default=false())
    contract_start_date = Column(Date, nullable=True)
    contract_end_date = Column(Date, nullable=True)
    # The signed rate contract agreement document (2026-10-07, user-directed) --
    # same single-document pattern as terms_document_* above. Required before
    # submission only when is_rate_contract is set (tenders.py).
    rate_contract_document_filename = Column(String(255), nullable=True)
    rate_contract_document_content_type = Column(String(255), nullable=True)
    rate_contract_document_size = Column(Integer, nullable=True)
    rate_contract_document_content = Column(LargeBinary(length=16_777_215), nullable=True)
    rate_contract_document_uploaded_at = Column(UTCDateTime(), nullable=True)
    rate_contract_document_uploaded_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)

    publish_date = Column(UTCDateTime(), nullable=True)
    bid_due_date = Column(UTCDateTime(), nullable=True)
    published_at = Column(UTCDateTime(), nullable=True)

    # Spec §7.3 — increments on every (re)submission; Round 1 on first.
    round_number = Column(Integer, nullable=False, default=0)
    # Spec §7.3 point 5 — consecutive rejections drive auto-escalation to
    # the next approval tier (app/services/approval_matrix.py); reset on
    # approval. Count, not a bool, so MAX_ROUNDS_BEFORE_ESCALATION is a
    # single comparison at submit time.
    consecutive_rejections = Column(Integer, nullable=False, default=0)

    created_by_id = Column(Integer, ForeignKey("user_accounts.id"), nullable=True)
    # Real bug, found 2026-10-16 -- see audit_log.py's AuditLog.occurred_at
    # for the full explanation (server_default=func.now() used the DB
    # server's own local timezone instead of true UTC).
    created_at = Column(UTCDateTime(), default=lambda: datetime.now(timezone.utc))

    facility = relationship("Facility")
    line_items = relationship("TenderLineItem", back_populates="tender", cascade="all, delete-orphan")
    approval_rounds = relationship(
        "TenderApprovalRound", back_populates="tender", cascade="all, delete-orphan", order_by="TenderApprovalRound.round_number"
    )
