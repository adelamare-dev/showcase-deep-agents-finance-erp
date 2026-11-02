from __future__ import annotations

import json
from datetime import date

from fastapi.testclient import TestClient

import erp_store
import main
from erp_store import ErpStore


def test_snapshot_route_serves_the_store(monkeypatch):
    store = ErpStore(date(2027, 4, 1))
    monkeypatch.setattr(erp_store, "_store", store)
    response = TestClient(main.app).get("/api/erp/snapshot")
    assert response.status_code == 200
    assert response.json() == json.loads(json.dumps(store.snapshot()))


def test_cors_allows_only_the_frontend_origin():
    client = TestClient(main.app)
    headers = {"Access-Control-Request-Method": "GET"}
    allowed = client.options("/api/erp/snapshot", headers={**headers, "Origin": "http://localhost:3000"})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    denied = client.options("/api/erp/snapshot", headers={**headers, "Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in denied.headers
