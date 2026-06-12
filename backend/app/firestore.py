from google.cloud import firestore

from app.config import get_settings

_client: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _client
    if _client is None:
        s = get_settings()
        # Named DB always - (default) is never used
        _client = firestore.Client(project=s.gcp_project, database=s.firestore_database)
    return _client
