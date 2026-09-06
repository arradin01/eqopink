"""Backend API tests for Sasha Band."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://sasha-pink-mobile.preview.emergentagent.com"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Root endpoint
class TestRoot:
    def test_root(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("message") == "Sasha Band API ready"


# Telemetry endpoint
class TestTelemetry:
    def test_telemetry(self, api):
        r = api.get(f"{BASE_URL}/api/telemetry", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("device_name") == "Sasha Band"
        assert data.get("heart_rate") == 72
        assert data.get("steps") == 6842
        assert data.get("connected") is True
        assert isinstance(data.get("weekly_steps"), list) and len(data["weekly_steps"]) == 7
        assert "updated_at" in data


# Insights endpoint
class TestInsights:
    def test_insights(self, api):
        r = api.get(f"{BASE_URL}/api/insights", timeout=15)
        assert r.status_code == 200
        data = r.json()
        insights = data.get("insights")
        assert isinstance(insights, list) and len(insights) == 3
        for item in insights:
            assert "title" in item and "body" in item and "tone" in item


# Tracking sessions CRUD
class TestTrackingSessions:
    def test_clear_first(self, api):
        r = api.delete(f"{BASE_URL}/api/tracking/sessions", timeout=15)
        assert r.status_code == 200
        assert "deleted_count" in r.json()

    def test_save_session(self, api):
        payload = {
            "steps": 250,
            "duration": 60,
            "distance_km": 0.19,
            "calories_kcal": 10,
            "source": "TEST_pytest",
        }
        r = api.post(f"{BASE_URL}/api/tracking/session", json=payload, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "saved"
        assert data["session"]["steps"] == 250
        assert data["session"]["source"] == "TEST_pytest"
        assert "id" in data["session"]
        assert "_id" not in data["session"]

    def test_get_sessions(self, api):
        r = api.get(f"{BASE_URL}/api/tracking/sessions", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "sessions" in data and "count" in data
        assert data["count"] >= 1
        # Verify persisted session
        matches = [s for s in data["sessions"] if s.get("source") == "TEST_pytest"]
        assert len(matches) >= 1
        assert "_id" not in matches[0]

    def test_delete_sessions(self, api):
        r = api.delete(f"{BASE_URL}/api/tracking/sessions", timeout=15)
        assert r.status_code == 200
        # Verify no sessions
        r2 = api.get(f"{BASE_URL}/api/tracking/sessions", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["count"] == 0
