from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Defaults to a local SQLite file so the app runs with zero setup.
    # Point this at a real Postgres instance for anything beyond local dev:
    #   postgresql+psycopg2://user:password@host:5432/hospital_procurement
    database_url: str = "sqlite:///./dev.db"

    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 8

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
