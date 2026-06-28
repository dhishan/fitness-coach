from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    gcp_project: str = "personal-projects-473219"
    firestore_database: str = "fitness-tracker-dev"
    jwt_secret_key: str = "dev-only-secret"
    jwt_expiry_hours: int = 24
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
    usda_api_key: str = ""
    apple_audience_prefix: str = "org.blueelephants.fitnesstracker"
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 1.0
    sentry_profiles_sample_rate: float = 1.0
    # Public URL of the hosted MCP resource (for OAuth discovery metadata).
    mcp_public_url: str = "https://mcp.fitness-tracker.blueelephants.org/mcp/"
    # Public connector: when true, a verified Google email with no existing
    # account is auto-provisioned on first MCP login. Off until launch.
    public_signup_enabled: bool = False
    # Shared HS256 secret between the Cloudflare Worker OAuth gateway and this
    # backend. The Worker signs a short-lived assertion {sub,email}; the backend
    # trusts it via X-Mcp-Gateway-Assertion. Empty = gateway path disabled.
    mcp_gateway_secret: str = ""
    # Abuse protection for the public MCP connector. Per-user request cap (per
    # 60s) and a global backstop on new-account provisioning (per hour). <=0
    # disables (used in tests).
    mcp_rate_limit_per_min: int = 90
    mcp_provision_limit_per_hour: int = 20

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
