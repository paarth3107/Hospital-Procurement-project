from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import auth, facilities, health, mappings, products, ratings, tenders, vendor_auth, vendor_portal, vendors

app = FastAPI(title="Hospital E-Procurement API")

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
app.include_router(vendors.router)
app.include_router(facilities.router)
app.include_router(products.router)
app.include_router(mappings.router)
app.include_router(ratings.router)
app.include_router(tenders.router)
app.include_router(vendor_auth.router)
app.include_router(vendor_portal.router)

frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
