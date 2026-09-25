import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import SessionLocal
from app.services.expiry import sweep_all

from app.routers import (
    audit_log,
    auth,
    categories,
    dashboard,
    evaluation,
    facilities,
    health,
    mappings,
    products,
    ratings,
    staff,
    tenders,
    vendor_auth,
    vendor_bids,
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


@app.on_event("startup")
async def _start_expiry_sweep() -> None:
    asyncio.create_task(_expiry_sweep_loop())

# Dev-time convenience: the frontend is served separately in production,
# but allowing localhost origins means `frontend/` can also be opened via
# a plain static server during development without CORS friction.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(audit_log.router)
app.include_router(staff.router)
app.include_router(vendors.router)
app.include_router(facilities.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(mappings.router)
app.include_router(ratings.router)
app.include_router(tenders.router)
app.include_router(vendor_auth.router)
app.include_router(vendor_portal.router)
app.include_router(vendor_bids.router)
app.include_router(evaluation.router)
app.include_router(vendor_documents.router)
app.include_router(dashboard.router)

frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
