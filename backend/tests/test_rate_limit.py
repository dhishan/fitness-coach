"""Unit tests for the shared sliding-window rate limiter."""
import time
from unittest.mock import patch

import pytest

from app.services.rate_limit import _hits, _lock, within_budget


@pytest.fixture(autouse=True)
def _clear_hits():
    """Reset shared state between tests."""
    with _lock:
        _hits.clear()
    yield
    with _lock:
        _hits.clear()


class TestWithinBudget:
    def test_allows_calls_under_limit(self):
        for _ in range(5):
            assert within_budget("test", "user1", limit=5) is True

    def test_blocks_call_over_limit(self):
        for _ in range(3):
            within_budget("test", "user2", limit=3)
        assert within_budget("test", "user2", limit=3) is False

    def test_zero_limit_disables_check(self):
        for _ in range(100):
            assert within_budget("test", "user3", limit=0) is True

    def test_negative_limit_disables_check(self):
        for _ in range(100):
            assert within_budget("test", "user4", limit=-1) is True

    def test_different_buckets_are_independent(self):
        for _ in range(2):
            within_budget("bucket_a", "user5", limit=2)
        # bucket_a is now exhausted for user5
        assert within_budget("bucket_a", "user5", limit=2) is False
        # bucket_b for same user is untouched
        assert within_budget("bucket_b", "user5", limit=2) is True

    def test_different_users_are_independent(self):
        for _ in range(2):
            within_budget("test", "user6", limit=2)
        assert within_budget("test", "user6", limit=2) is False
        assert within_budget("test", "user7", limit=2) is True

    def test_window_slides_old_hits_expire(self):
        # Use a very short window so we can fake time advancing
        fake_now = [0.0]

        def fake_monotonic():
            return fake_now[0]

        with patch("app.services.rate_limit.time.monotonic", side_effect=fake_monotonic):
            # Use up the full budget at t=0
            within_budget("test", "user8", limit=2, window_s=1.0)
            within_budget("test", "user8", limit=2, window_s=1.0)
            assert within_budget("test", "user8", limit=2, window_s=1.0) is False

            # Advance past the window
            fake_now[0] = 1.1
            # Old hits are now outside the window; budget should be free again
            assert within_budget("test", "user8", limit=2, window_s=1.0) is True

    def test_exact_limit_boundary(self):
        """The Nth call (equal to limit) is allowed; N+1 is blocked."""
        limit = 3
        for i in range(limit):
            result = within_budget("test", "user9", limit=limit)
            assert result is True, f"call {i + 1} should be allowed"
        assert within_budget("test", "user9", limit=limit) is False
