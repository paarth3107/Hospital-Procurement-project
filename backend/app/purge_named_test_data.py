"""One-shot cleanup: removes specific, by-name-identified test vendors,
test tenders and test products from a live database (2026-10-29, user-
directed: "to delete- tenders- koko, koko, blank / vendors- test47, Test47,
test, Paarth PVT.Ltd / Products- Self, test, test2, test3").

Unlike seed_test_*.py (additive, dev-only), this is DESTRUCTIVE and meant to
run against a specific, named set of rows on a live database. Nothing here
guesses or pattern-matches -- every target is matched by an exact name you
pass in below, and the script always prints the full deletion plan (every
row that matched, and a per-table count of everything that would cascade)
before touching anything. It is a DRY RUN by default; nothing is deleted
until you pass --commit, after reading that plan.

No FK in this schema has ON DELETE CASCADE (confirmed by reading every
model), so every dependent table is deleted here explicitly, children
before parents -- see the comment above each block for why that table is
in scope and why it's positioned where it is. audit_log is deliberately
NEVER touched (CLAUDE.md: "Immutable from normal app workflows").

Run from the backend folder (always dry-run first):
    venv\\Scripts\\python.exe -m app.purge_named_test_data --database-url "mysql+pymysql://user:pass@host:3306/dbname"
    venv\\Scripts\\python.exe -m app.purge_named_test_data --database-url "..." --commit
"""

import argparse
import os
import sys

sys.path.insert(0, os.getcwd())

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

# ---- exact targets (2026-10-29, as given) ----------------------------------
TENDER_TITLES = ["koko", ""]  # "koko" appears twice -- IN-match handles duplicates on its own
VENDOR_NAMES = ["test47", "Test47", "test", "Paarth PVT.Ltd"]  # case-sensitive -- see resolve_vendors()
PRODUCT_NAMES = ["Self", "test", "test2", "test3"]


def _in_names(db, sql_prefix: str, names: list[str], select_col: str):
    """A plain `text()` bind can't expand a tuple into IN (...) without
    `bindparam(expanding=True)`, which varies by SQLAlchemy version -- an
    explicit per-item placeholder list is the same thing done by hand, with
    no version-dependent surprise."""
    placeholders = ", ".join(f":n{i}" for i in range(len(names)))
    params = {f"n{i}": v for i, v in enumerate(names)}
    rows = db.execute(text(f"{sql_prefix} IN ({placeholders})"), params).fetchall()
    found = {getattr(r, select_col) for r in rows}
    return rows, found


def resolve_tenders(db) -> list[int]:
    rows, found_titles = _in_names(db, "SELECT id, title FROM tenders WHERE title", TENDER_TITLES, "title")
    print(f"Tenders matched ({len(rows)}):")
    for r in rows:
        print(f"  #{r.id}  title={r.title!r}")
    for t in set(TENDER_TITLES):
        if t not in found_titles:
            print(f"  WARNING: no tender titled {t!r} found")
    return [r.id for r in rows]


def resolve_vendors(db) -> list[int]:
    # Matched in Python, not SQL -- MySQL's default collation is
    # case-insensitive, so a SQL `legal_name IN (...)` would silently treat
    # "test47" and "Test47" as the same row and could match the wrong one.
    all_vendors = db.execute(text("SELECT id, legal_name, email, status FROM vendors")).fetchall()
    rows = [r for r in all_vendors if r.legal_name in VENDOR_NAMES]
    print(f"Vendors matched ({len(rows)}):")
    for r in rows:
        print(f"  #{r.id}  {r.legal_name!r}  {r.email}  status={r.status}")
    found_names = {r.legal_name for r in rows}
    for n in VENDOR_NAMES:
        if n not in found_names:
            print(f"  WARNING: no vendor named {n!r} found (exact, case-sensitive)")
    return [r.id for r in rows]


def resolve_products(db) -> list[int]:
    rows, found_names = _in_names(db, "SELECT id, name FROM product_master WHERE name", PRODUCT_NAMES, "name")
    print(f"Products matched ({len(rows)}):")
    for r in rows:
        print(f"  #{r.id}  {r.name!r}")
    for n in set(PRODUCT_NAMES):
        if n not in found_names:
            print(f"  WARNING: no product named {n!r} found")
    return [r.id for r in rows]


def _ids(db, sql: str, **params) -> list[int]:
    return [r[0] for r in db.execute(text(sql), params).fetchall()]


def _count_delete(db, label: str, table: str, where: str, commit: bool, **params) -> int:
    n = db.execute(text(f"SELECT COUNT(*) FROM {table} WHERE {where}"), params).scalar()
    print(f"  {label}: {n} row(s) in {table}")
    if commit and n:
        db.execute(text(f"DELETE FROM {table} WHERE {where}"), params)
    return n


def build_plan_and_maybe_execute(db, tender_ids: list[int], vendor_ids: list[int], product_ids: list[int], commit: bool) -> None:
    def in_clause(name: str, ids: list[int]) -> tuple[str, dict]:
        # Every call site writes f"{col} {clause}", so the clause has to stay
        # "IN (...)"-shaped even when empty -- a bare "1=0" here used to
        # produce "WHERE tender_id 1=0", a straight SQL syntax error, not a
        # harmless no-op. "IN (NULL)" is valid IN-syntax that can never match
        # a real integer id, which is what "match nothing" actually needs.
        if not ids:
            return "IN (NULL)", {}
        placeholders = ", ".join(f":{name}{i}" for i in range(len(ids)))
        return f"IN ({placeholders})", {f"{name}{i}": v for i, v in enumerate(ids)}

    def exclude_clause(col: str, name: str, ids: list[int]) -> tuple[str, dict]:
        # A full "AND <col> NOT IN (...)" fragment, or "" when ids is empty --
        # NOT building this from in_clause()'s output on purpose: "col NOT IN
        # (NULL)" is NULL (falsy) for every row via SQL's NULL-propagation,
        # not true, so an empty exclusion set has to omit the condition
        # entirely (exclude nothing) rather than render it as "NOT IN (NULL)"
        # and silently exclude every row instead.
        if not ids:
            return "", {}
        placeholders = ", ".join(f":{name}{i}" for i in range(len(ids)))
        return f" AND {col} NOT IN ({placeholders})", {f"{name}{i}": v for i, v in enumerate(ids)}

    print("\n--- resolving dependent closures ---")
    line_item_ids = _ids(db, f"SELECT id FROM tender_line_items WHERE tender_id {in_clause('t', tender_ids)[0]}", **in_clause("t", tender_ids)[1]) if tender_ids else []
    print(f"  tender_line_items belonging to purged tenders: {len(line_item_ids)}")

    li_clause, li_params = in_clause("li", line_item_ids)
    v_clause, v_params = in_clause("v", vendor_ids)

    bid_where = f"vendor_id {v_clause}" + (f" OR tender_line_item_id {li_clause}" if line_item_ids else "")
    bid_params = {**v_params, **li_params}
    bid_ids = _ids(db, f"SELECT id FROM bids WHERE {bid_where}", **bid_params) if vendor_ids or line_item_ids else []
    print(f"  bids by a purged vendor, or on a purged tender's line: {len(bid_ids)}")

    award_round_ids = _ids(db, f"SELECT id FROM award_rounds WHERE line_item_id {li_clause}", **li_params) if line_item_ids else []
    print(f"  award_rounds belonging to purged tenders' lines: {len(award_round_ids)}")

    b_clause, b_params = in_clause("b", bid_ids)
    ar_clause, ar_params = in_clause("ar", award_round_ids)
    aa_where = f"bid_id {b_clause}" + (f" OR round_id {ar_clause}" if award_round_ids else "")
    aa_params = {**b_params, **ar_params}
    allocation_ids = _ids(db, f"SELECT id FROM award_allocations WHERE {aa_where}", **aa_params) if bid_ids or award_round_ids else []
    print(f"  award_allocations tied to those bids/rounds: {len(allocation_ids)}")

    # Products whose name matched but are still referenced by a KEPT tender's
    # line item are left alone -- forcing that delete would corrupt a tender
    # we are NOT purging. (vendor_mappings referencing it are still removed
    # below regardless, since a mapping has no meaning without its vendor
    # once the vendor side is also gone, or is itself in scope either way.)
    safe_product_ids = []
    excl_sql, excl_params = exclude_clause("tender_id", "ext", tender_ids)
    for pid in product_ids:
        kept_refs = db.execute(
            text(f"SELECT COUNT(*) FROM tender_line_items WHERE product_master_id = :pid{excl_sql}"),
            {"pid": pid, **excl_params},
        ).scalar()
        if kept_refs:
            print(f"  SKIPPING product #{pid}: still referenced by {kept_refs} line item(s) on a tender that is NOT being purged")
        else:
            safe_product_ids.append(pid)
    p_clause, p_params = in_clause("p", safe_product_ids)

    print("\n--- cross-reference cleanup (null out, don't delete the row) ---")
    # award_rounds on a KEPT tender's line may still point at a bid we're about to delete.
    kept_round_ids = [i for i in _ids(db, "SELECT id FROM award_rounds") if i not in award_round_ids] if bid_ids else []
    if bid_ids and kept_round_ids:
        n = db.execute(
            text(f"SELECT COUNT(*) FROM award_rounds WHERE system_top_bid_id {b_clause} AND id {in_clause('kr', kept_round_ids)[0]}"),
            {**b_params, **in_clause("kr", kept_round_ids)[1]},
        ).scalar()
        print(f"  award_rounds.system_top_bid_id to null (round kept, bid purged): {n}")
        if commit and n:
            db.execute(
                text(f"UPDATE award_rounds SET system_top_bid_id = NULL WHERE system_top_bid_id {b_clause} AND id {in_clause('kr', kept_round_ids)[0]}"),
                {**b_params, **in_clause("kr", kept_round_ids)[1]},
            )
    # A KEPT vendor's registered_via_tender_id/expedited_review_tender_id may point at a purged tender.
    if tender_ids:
        t_clause, t_params = in_clause("t", tender_ids)
        v_excl_sql, v_excl_params = exclude_clause("id", "vex", vendor_ids)
        for col in ("registered_via_tender_id", "expedited_review_tender_id"):
            params = {**t_params, **v_excl_params}
            n = db.execute(text(f"SELECT COUNT(*) FROM vendors WHERE {col} {t_clause}{v_excl_sql}"), params).scalar()
            print(f"  vendors.{col} to null (vendor kept, tender purged): {n}")
            if commit and n:
                db.execute(text(f"UPDATE vendors SET {col} = NULL WHERE {col} {t_clause}{v_excl_sql}"), params)

    print("\n--- deletion plan (children first) ---")
    a_clause, a_params = in_clause("a", allocation_ids)

    bid_attachment_ids = _ids(db, f"SELECT id FROM bid_attachments WHERE bid_id {b_clause}", **b_params) if bid_ids else []
    ba_clause, ba_params = in_clause("ba", bid_attachment_ids)
    _count_delete(db, "bid_attachment_views", "bid_attachment_views", f"attachment_id {ba_clause}", commit, **ba_params)
    _count_delete(db, "bid_attachments", "bid_attachments", f"bid_id {b_clause}", commit, **b_params)
    _count_delete(db, "bid_technical_results", "bid_technical_results", f"bid_id {b_clause}", commit, **b_params)
    _count_delete(db, "bid_evaluations", "bid_evaluations", f"bid_id {b_clause}", commit, **b_params)
    _count_delete(db, "price_competitiveness_records", "price_competitiveness_records", f"bid_id {b_clause}", commit, **b_params)

    _count_delete(db, "award_allocations", "award_allocations", f"id {a_clause}", commit, **a_params)
    _count_delete(db, "award_rounds", "award_rounds", f"id {ar_clause}", commit, **ar_params)

    _count_delete(db, "bids", "bids", f"id {b_clause}", commit, **b_params)

    _count_delete(db, "tender_invites", "tender_invites", f"tender_line_item_id {li_clause}" + (f" OR vendor_id {v_clause}" if vendor_ids else ""), commit, **{**li_params, **v_params})
    _count_delete(db, "tender_line_exclusions", "tender_line_exclusions", f"tender_line_item_id {li_clause}" + (f" OR vendor_id {v_clause}" if vendor_ids else ""), commit, **{**li_params, **v_params})
    _count_delete(db, "tender_line_attachments", "tender_line_attachments", f"tender_line_item_id {li_clause}", commit, **li_params)
    _count_delete(db, "tender_line_items", "tender_line_items", f"id {li_clause}", commit, **li_params)
    _count_delete(db, "tender_approval_rounds", "tender_approval_rounds", f"tender_id {in_clause('t', tender_ids)[0]}", commit, **in_clause("t", tender_ids)[1])

    _count_delete(db, "po_data_files", "po_data_files", f"tender_id {in_clause('t', tender_ids)[0]}" + (f" OR vendor_id {v_clause}" if vendor_ids else ""), commit, **{**in_clause("t", tender_ids)[1], **v_params})
    _count_delete(db, "notifications", "notifications", f"tender_id {in_clause('t', tender_ids)[0]}" + (f" OR vendor_id {v_clause}" if vendor_ids else ""), commit, **{**in_clause("t", tender_ids)[1], **v_params})
    # entity_type/entity_id are a recent addition (migration b3f6c8d1a7e2) --
    # this live DB may still be on an older schema that hasn't run it yet.
    # Purely a cosmetic cleanup step either way, so skip rather than abort.
    has_entity_cols = db.execute(text(
        "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'staff_notifications' AND column_name = 'entity_type'"
    )).scalar()
    if has_entity_cols:
        _count_delete(db, "staff_notifications", "staff_notifications", f"entity_type = 'tender' AND entity_id {in_clause('t', tender_ids)[0]}", commit, **in_clause("t", tender_ids)[1])
    else:
        print("  staff_notifications: skipped (this DB's schema predates entity_type/entity_id)")
    if tender_ids:
        tt_clause, tt_params = in_clause("tt", tender_ids)
        _count_delete(db, "override_requests (tender)", "override_requests", f"entity_type = 'tender' AND entity_id {tt_clause}", commit, **tt_params)
    if vendor_ids:
        vv_clause, vv_params = in_clause("vv", vendor_ids)
        _count_delete(db, "override_requests (vendor)", "override_requests", f"entity_type = 'vendor' AND entity_id {vv_clause}", commit, **vv_params)

    mapping_ids = _ids(db, f"SELECT id FROM vendor_mappings WHERE vendor_id {v_clause}" + (f" OR product_master_id {p_clause}" if safe_product_ids else ""), **{**v_params, **p_params}) if vendor_ids or safe_product_ids else []
    m_clause, m_params = in_clause("m", mapping_ids)
    _count_delete(db, "vendor_mapping_history", "vendor_mapping_history", f"mapping_id {m_clause}", commit, **m_params)
    _count_delete(db, "vendor_mappings", "vendor_mappings", f"id {m_clause}", commit, **m_params)

    rating_ids = _ids(db, f"SELECT id FROM vendor_ratings WHERE vendor_id {v_clause}", **v_params) if vendor_ids else []
    r_clause, r_params = in_clause("r", rating_ids)
    _count_delete(db, "rating_history", "rating_history", f"rating_id {r_clause}", commit, **r_params)
    _count_delete(db, "vendor_ratings", "vendor_ratings", f"id {r_clause}", commit, **r_params)

    _count_delete(db, "vendor_documents", "vendor_documents", f"vendor_id {v_clause}", commit, **v_params)
    _count_delete(db, "vendor_status_history", "vendor_status_history", f"vendor_id {v_clause}", commit, **v_params)

    _count_delete(db, "tenders", "tenders", f"id {in_clause('t', tender_ids)[0]}", commit, **in_clause("t", tender_ids)[1])
    _count_delete(db, "vendors", "vendors", f"id {v_clause}", commit, **v_params)
    _count_delete(db, "product_master", "product_master", f"id {p_clause}", commit, **p_params)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True, help="Full SQLAlchemy URL, e.g. mysql+pymysql://user:pass@host:3306/dbname")
    parser.add_argument("--commit", action="store_true", help="Actually delete. Without this flag, prints the plan only.")
    args = parser.parse_args()

    engine = create_engine(args.database_url)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        print(f"Mode: {'COMMIT (will delete)' if args.commit else 'DRY RUN (nothing will be deleted)'}\n")
        tender_ids = resolve_tenders(db)
        vendor_ids = resolve_vendors(db)
        product_ids = resolve_products(db)
        build_plan_and_maybe_execute(db, tender_ids, vendor_ids, product_ids, args.commit)
        if args.commit:
            db.commit()
            print("\nCommitted.")
        else:
            db.rollback()
            print("\nDry run only -- nothing was changed. Re-run with --commit to actually delete.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
