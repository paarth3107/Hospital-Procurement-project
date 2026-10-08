from datetime import timezone

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
# pool_pre_ping: MySQL closes idle connections server-side (wait_timeout,
# default 8h) -- without this, a connection that's been sitting in the pool
# past that point fails with "MySQL server has gone away" on its next use.
# A no-op SELECT 1 check on Postgres/SQLite, so safe to leave on always.
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class UTCDateTime(TypeDecorator):
    """A timezone-aware DateTime that round-trips the same way on every
    dialect (2026-10-08, added for the MySQL port). Postgres' TIMESTAMPTZ
    preserves awareness end to end; MySQL's DATETIME (what plain
    DateTime(timezone=True) falls back to there) has no timezone concept at
    all -- values come back from the DB with tzinfo stripped. This app
    always writes datetime.now(timezone.utc) and compares it against what it
    reads back (deadlines, SLA windows, document expiry), so a naive value
    from MySQL would raise "can't compare offset-naive and offset-aware
    datetimes" the moment it's compared. Use this in place of
    DateTime(timezone=True) everywhere -- it strips tzinfo on the way in
    (every value here is already UTC) and reattaches timezone.utc on the way
    out, so application code never has to know the difference."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is None or value.tzinfo is not None:
            return value
        return value.replace(tzinfo=timezone.utc)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
