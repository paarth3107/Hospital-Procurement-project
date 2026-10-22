from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Defaults to a local SQLite file so the app runs with zero setup.
    # Point this at a real Postgres instance for anything beyond local dev:
    #   postgresql+psycopg2://user:password@host:5432/hospital_procurement
    database_url: str = "sqlite:///./dev.db"

    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 8

    # Email adapter (2026-10-19) -- "console" (default) just logs every email
    # instead of sending it, so local dev/CI never needs real credentials and
    # never risks mailing a real vendor by accident. Set email_backend=smtp
    # and fill in the rest to actually send, against whatever mailbox/relay
    # the hospital already has -- no third-party email API, see
    # app/services/email_adapter.py for why.
    email_backend: str = "console"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = ""
    email_from: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
