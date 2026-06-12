from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings


def verify_google_id_token(token: str) -> dict:
    """Raises ValueError on invalid token."""
    s = get_settings()
    if not s.google_oauth_client_id:
        # verify_oauth2_token skips the aud check when audience is empty
        raise ValueError("GOOGLE_OAUTH_CLIENT_ID is not configured")
    return google_id_token.verify_oauth2_token(
        token, google_requests.Request(), s.google_oauth_client_id
    )
