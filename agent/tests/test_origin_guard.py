from __future__ import annotations

from datetime import date

from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

import erp_store
import main
from erp_store import ErpStore
from origin_guard import OriginGuardMiddleware

ALLOWED = "http://localhost:3000"
FOREIGN = "http://evil.example"
AGENT_PATH = "/copilotkit/agents/finance_erp_agent"


def _client(monkeypatch):
    store = ErpStore(date(2027, 4, 1))
    monkeypatch.setattr(erp_store, "_store", store)
    return TestClient(main.app), store


def _pay_first_bill(store):
    store.pay_bills(store.bills_for_approval(31, True)[:1])


def test_reset_with_a_foreign_origin_is_refused_and_changes_nothing(monkeypatch):
    client, store = _client(monkeypatch)
    _pay_first_bill(store)
    before = store.snapshot()
    response = client.post("/api/erp/reset", headers={"Origin": FOREIGN, "Content-Type": "text/plain"})
    assert response.status_code == 403
    assert response.json() == {"detail": "Origin not allowed"}
    assert store.snapshot() == before


def test_reset_with_the_allowed_origin_goes_through(monkeypatch):
    client, _ = _client(monkeypatch)
    assert client.post("/api/erp/reset", headers={"Origin": ALLOWED}).status_code == 200


def test_reset_without_an_origin_goes_through(monkeypatch):
    client, _ = _client(monkeypatch)
    assert client.post("/api/erp/reset").status_code == 200


def test_a_read_with_a_foreign_origin_is_unchanged(monkeypatch):
    client, _ = _client(monkeypatch)
    assert client.get("/api/erp/snapshot", headers={"Origin": FOREIGN}).status_code == 200


def test_a_foreign_origin_is_refused_on_the_run_endpoint_before_any_model_call(monkeypatch):
    client, _ = _client(monkeypatch)
    response = client.post(AGENT_PATH, json={}, headers={"Origin": FOREIGN})
    assert response.status_code == 403


def test_preflight_from_the_allowed_origin_still_works():
    response = TestClient(main.app).options(
        "/api/erp/reset",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED


def test_the_guard_is_installed_with_the_same_origins_as_cors():
    guard = next(m for m in main.app.user_middleware if m.cls is OriginGuardMiddleware)
    assert guard.kwargs["allowed_origins"] == main.ALLOWED_ORIGINS
    cors = next(m for m in main.app.user_middleware if m.cls is CORSMiddleware)
    assert cors.kwargs["allow_origins"] == main.ALLOWED_ORIGINS
