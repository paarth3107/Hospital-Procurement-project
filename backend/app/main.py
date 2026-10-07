import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import SessionLocal
from app.services.awards import sweep_no_bid_lines
from app.services.expiry import sweep_all

from app.routers import (
    audit_log,
    awards,
    auth,
    categories,
    dashboard,
    evaluation,
    facilities,
    health,
    mappings,
    overrides,
    products,
    open_links,
    po_files,
    ratings,
    search,
    staff,
    subcategories,
    tender_review,
    tenders,
    vendor_auth,
    vendor_bids,
    vendor_notifications,
    vendor_documents,
    vendor_portal,
    vendors,
)

app = FastAPI(title="Hospital E-Procurement API")


async def _expiry_sweep_loop() -> None:
    """Spec 3.5: suspend vendors whose statutory documents have expired. There
    is no scheduler in this app, so run the sweep at startup and then daily
    (expiry is a date, so a daily check is enough). Bid submission and tender
    eligibility also check expiry directly."""

    while True:
        try:
            await asyncio.to_thread(_run_sweep)
        except Exception:  # never let a sweep failure kill the loop
            logging.getLogger(__name__).exception("document-expiry sweep failed")
        await asyncio.sleep(24 * 3600)


def _run_sweep() -> None:
    db = SessionLocal()
    try:
        sweep_all(db)
    finally:
        db.close()


async def _no_bid_sweep_loop() -> None:
    """User-directed (2026-09-30): a published line whose deadline passed
    with zero bids goes straight to "no award" -- there's no vendor to
    evaluate or approve, so waiting on a human to walk it through the full
    ceremony would be pure overhead. Checked far more often than the
    document-expiry sweep since a bid deadline is a specific moment (and can
    be moved up on demand via the System Admin's force-close-bidding demo
    utility) rather than a slow-moving date; the dashboard and evaluation
    screens also sweep synchronously on read, so this loop is only the
    fallback for when nobody's looking at either."""

    while True:
        try:
            await asyncio.to_thread(_run_no_bid_sweep)
        except Exception:
            logging.getLogger(__name__).exception("no-bid tender sweep failed")
        await asyncio.sleep(300)


def _run_no_bid_sweep() -> None:
    db = SessionLocal()
    try:
        sweep_no_bid_lines(db)
    finally:
        db.close()


@app.on_event("startup")
async def _start_expiry_sweep() -> None:
    asyncio.create_task(_expiry_sweep_loop())
    asyncio.create_task(_no_bid_sweep_loop())

# Dev-time convenience: the frontend is served separately in production,
# but allowing localhost origins means `frontend/` can also be opened via
# a plain static server during development without CORS friction.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _no_cache_frontend(request, call_next):
    """The frontend (plain ES modules, no build step, no cache-busted
    filenames) is served straight off disk below -- without this, a browser's
    default heuristic caching can keep serving an old .js file after it's
    changed on disk, with no visible sign anything is stale. Forces
    revalidation on every load; ETag/Last-Modified still make that a cheap
    304 when the file hasn't actually changed. Never applied to /api/*."""

    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache"
    return response

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(audit_log.router)
app.include_router(staff.router)
app.include_router(vendors.router)
app.include_router(facilities.router)
app.include_router(categories.router)
app.include_router(subcategories.router)
app.include_router(search.router)
app.include_router(open_links.router)
app.include_router(products.router)
app.include_router(mappings.router)
app.include_router(ratings.router)
app.include_router(tenders.router)
app.include_router(tender_review.router)
app.include_router(vendor_auth.router)
app.include_router(vendor_portal.router)
app.include_router(vendor_bids.router)
app.include_router(evaluation.router)
app.include_router(awards.router)
app.include_router(po_files.router)
app.include_router(vendor_notifications.router)
app.include_router(vendor_documents.router)
app.include_router(dashboard.router)
app.include_router(overrides.router)

frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
