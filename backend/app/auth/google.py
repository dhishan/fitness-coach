from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings


def verify_google_id_token(token: str) -> dict:
    """Raises ValueError on invalid token or audience mismatch."""
    s = get_settings()
    if not s.audiences_list:
        raise ValueError("No OAuth client IDs configured")
    idinfo = google_id_token.verify_oauth2_token(token, google_requests.Request())
    if idinfo.get("aud") not in s.audiences_list:
        raise ValueError("audience not allowed")
    return idinfo
