from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    gcp_project: str = "personal-projects-473219"
    firestore_database: str = "fitness-tracker-dev"
    jwt_secret_key: str = "dev-only-secret"
    jwt_expiry_hours: int = 24 * 30
    google_oauth_client_id: str = ""
    allowed_emails: str = "iamdhishan@gmail.com"
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"extra": "ignore", "env_file": ".env"}

    @property
    def allowed_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
