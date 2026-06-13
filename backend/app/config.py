from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    gcp_project: str = "personal-projects-473219"
    firestore_database: str = "fitness-tracker-dev"
    jwt_secret_key: str = "dev-only-secret"
    jwt_expiry_hours: int = 24 * 30
    google_oauth_client_id: str = ""
    google_oauth_client_ids: str = ""
    allowed_emails: str = "iamdhishan@gmail.com"
    cors_origins: list[str] = ["http://localhost:5173"]
    openai_api_key: str = ""
    chat_model: str = "openai/gpt-5.5"
    chat_model_cheap: str = "openai/gpt-4o-mini"
    chat_router_enabled: bool = True
    chat_router_model: str = "openai/gpt-4o-mini"
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = ""
    chat_max_events: int = 800
    chat_generation_timeout_s: int = 1800
    cf_access_team_domain: str = ""
    cf_access_aud: str = ""
    nutrition_model: str = "openai/gpt-4o-mini"
    uploads_bucket: str = ""

    model_config = {"extra": "ignore", "env_file": ".env"}

    @property
    def allowed_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()]

    @property
    def audiences_list(self) -> list[str]:
        if self.google_oauth_client_ids.strip():
            return [c.strip() for c in self.google_oauth_client_ids.split(",") if c.strip()]
        if self.google_oauth_client_id.strip():
            return [self.google_oauth_client_id.strip()]
        return []


@lru_cache
def get_settings() -> Settings:
    return Settings()
