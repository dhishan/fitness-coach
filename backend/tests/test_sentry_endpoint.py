"""Tests for the /internal/sentry-test endpoint and LLM rate-limit enforcement."""
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# /internal/sentry-test
# ---------------------------------------------------------------------------

class TestSentryTestEndpoint:
    def test_disabled_when_token_empty(self, client):
        """sentry_test_token="" (the test-environment default) returns disabled."""
        # In the test environment SENTRY_TEST_TOKEN is unset (empty string default).
        with patch("app.main.settings") as mock_settings:
            mock_settings.sentry_test_token = ""
            mock_settings.sentry_dsn = ""
            r = client.get("/internal/sentry-test?token=anything")
        assert r.status_code == 200
        data = r.json()
        assert data["captured"] is False
        assert data["reason"] == "disabled"

    def test_wrong_token_rejected(self, client):
        with patch("app.main.settings") as mock_settings:
            mock_settings.sentry_test_token = "correct-token"
            mock_settings.sentry_dsn = "https://key@sentry.io/123"
            r = client.get("/internal/sentry-test?token=wrong-token")
        assert r.status_code == 200
        data = r.json()
        assert data["captured"] is False
        assert data["reason"] == "unauthorized"

    def test_right_token_captures_event(self, client):
        mock_sentry = MagicMock()
        mock_sentry.capture_message = MagicMock()
        with patch("app.main.settings") as mock_settings, \
             patch.dict("sys.modules", {"sentry_sdk": mock_sentry}):
            mock_settings.sentry_test_token = "correct-token"
            mock_settings.sentry_dsn = "https://key@sentry.io/123"
            r = client.get("/internal/sentry-test?token=correct-token")
        assert r.status_code == 200
        data = r.json()
        assert data["captured"] is True
        assert "look_at" in data

    def test_no_dsn_returns_not_configured(self, client):
        with patch("app.main.settings") as mock_settings:
            mock_settings.sentry_test_token = "correct-token"
            mock_settings.sentry_dsn = ""
            r = client.get("/internal/sentry-test?token=correct-token")
        assert r.status_code == 200
        data = r.json()
        assert data["captured"] is False
        assert "SENTRY_DSN" in data["reason"]


# ---------------------------------------------------------------------------
# LLM rate limit: 429 on estimate/text
# ---------------------------------------------------------------------------

AI_SVC = "app.routers.nutrition.nutrition_ai"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u_rl_test", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


class TestEstimateTextRateLimit:
    def setup_method(self):
        # Clear rate-limit state before each test
        from app.services.rate_limit import _hits, _lock
        with _lock:
            _hits.clear()

    def teardown_method(self):
        from app.services.rate_limit import _hits, _lock
        with _lock:
            _hits.clear()

    def test_second_call_blocked_when_limit_is_one(self, client):
        estimate = {"name": "Rice", "serving": "1 cup", "macros": {}, "confidence": 0.9}
        headers = _auth(client)

        # Patch settings to limit=1 for this test
        with patch("app.routers.nutrition.get_settings") as mock_gs:
            mock_gs.return_value.llm_rate_limit_per_min = 1
            with patch(f"{AI_SVC}.estimate_from_text", return_value=estimate):
                r1 = client.post(
                    "/api/v1/nutrition/estimate/text",
                    json={"text": "rice"},
                    headers=headers,
                )
            assert r1.status_code == 200

            # Second call within the same window should be rate-limited
            r2 = client.post(
                "/api/v1/nutrition/estimate/text",
                json={"text": "rice"},
                headers=headers,
            )
        assert r2.status_code == 429
        assert "Rate limit" in r2.json()["detail"]
