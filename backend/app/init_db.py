"""Creates the full schema straight from the current models, instead of
replaying the Alembic migration history -- for a FRESH MySQL database only
(2026-10-08, the Postgres -> MySQL port).

The 37 existing migrations are Postgres-specific history: enum
`ALTER TYPE ... ADD VALUE` statements (MySQL has no such thing -- its enums
are just inline column definitions), the audit_log immutability trigger
(written in PL/pgSQL), and a couple of one-time data-fix statements using
Postgres-only syntax (`UPDATE ... FROM`, `::text` casts). Replaying them
against MySQL would fail partway through. Since this port has no real data
to preserve (CLAUDE.md / user-confirmed), the simplest correct path is: skip
the history, build the schema this script describes (which already reflects
every one of those 37 migrations' end state, because it comes straight from
the models they were written to match), then tell Alembic's own bookkeeping
to treat the DB as already being at head -- so every *future* migration
still applies normally on top, to either dialect, same as always.

Postgres keeps using its real migration history as before; this script is
MySQL's equivalent starting point, not a replacement for Alembic going
forward.

Run once, with DATABASE_URL already pointed at an EMPTY MySQL database:
    venv/Scripts/python.exe -m app.init_db
    venv/Scripts/python.exe -m alembic stamp head
"""

from sqlalchemy import text

from app import models  # noqa: F401 -- import side effect populates Base.metadata
from app.database import Base, engine

# Postgres' version (what the old a1d0c7e94b21_audit_log.py migration runs):
# a trigger function in PL/pgSQL, fired on UPDATE/DELETE (per row) and
# TRUNCATE (per statement) alike.
_POSTGRES_FUNCTION = """
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is insert-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
"""
_POSTGRES_TRIGGERS = [
    "CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();",
    "CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();",
]

# MySQL has no combined "BEFORE UPDATE OR DELETE" trigger and no shared
# trigger function -- one trigger per event, each with its own body.
# SIGNALing a generic SQLSTATE is MySQL's equivalent of RAISE EXCEPTION.
_MYSQL_TRIGGERS = [
    """
    CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is insert-only: UPDATE is not allowed';
    """,
    """
    CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is insert-only: DELETE is not allowed';
    """,
]


def _try_execute(sql: str, label: str) -> bool:
    """Runs one DDL statement in its own connection/transaction, so one
    failing (e.g. a privilege a shared-hosting MySQL account doesn't have)
    can't abort the others or crash the whole script -- the trigger is a
    nice-to-have safety net, not something the app depends on to function
    (it only ever inserts into audit_log itself)."""
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
        return True
    except Exception as e:
        print(f"Could not create {label}: {e}")
        return False


def run():
    Base.metadata.create_all(bind=engine)
    print("Schema created (every table).")
    dialect = engine.dialect.name
    if dialect == "postgresql":
        if _try_execute(_POSTGRES_FUNCTION, "the audit_log_immutable() function") and all(
            _try_execute(stmt, "an audit_log trigger") for stmt in _POSTGRES_TRIGGERS
        ):
            print("audit_log is now insert-only (UPDATE, DELETE and TRUNCATE all rejected).")
        else:
            print("Could not set up the audit_log trigger (see the error above) -- the schema itself is still fully created.")
    elif dialect == "mysql":
        if all(_try_execute(stmt, "an audit_log trigger") for stmt in _MYSQL_TRIGGERS):
            print("audit_log is now insert-only for UPDATE and DELETE.")
            print(
                "NOTE: MySQL triggers never fire on TRUNCATE (it's DDL there, unlike Postgres) -- "
                "there is no trigger-based way to block it. If that guarantee matters on MySQL, "
                "revoke DROP privilege on audit_log from the app's own DB user at the GRANT level; "
                "TRUNCATE requires it."
            )
        else:
            print(
                "Could not create the audit_log trigger(s) (see the error(s) above) -- this is usually "
                "a hosting restriction (no SUPER privilege, binary logging on), not something wrong with "
                "your setup. The schema itself is still fully created; the app only loses the extra "
                "DB-level guard against someone editing audit_log directly by hand (the app itself never "
                "does -- it only ever inserts). To enable it later, ask whoever administers the server to "
                "either grant SUPER or set log_bin_trust_function_creators=1, then rerun this script."
            )
    else:
        print(f"No audit_log immutability trigger is defined for dialect {dialect!r} -- add one in app/init_db.py before relying on it.")
    print("Done. Now run: alembic stamp head")


if __name__ == "__main__":
    run()
