from __future__ import annotations

import json
from datetime import date

from fastapi.testclient import TestClient

import erp_store
import main
from erp_datasets import DATASET_IDS, build_dataset
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


def _dataset_client(monkeypatch):
    store = ErpStore(date(2027, 4, 1))
    monkeypatch.setattr(erp_store, "_store", store)
    return TestClient(main.app), store


def test_dataset_route_serves_the_catalog(monkeypatch):
    client, store = _dataset_client(monkeypatch)
    for dataset_id in DATASET_IDS:
        response = client.get(f"/api/erp/datasets/{dataset_id}")
        assert response.status_code == 200, dataset_id
        assert response.json() == json.loads(json.dumps(build_dataset(store, dataset_id)))
    response = client.get("/api/erp/datasets/scenario_analysis?quarters=6&growth_pct=-5&metric=profit")
    expected = build_dataset(store, "scenario_analysis", quarters=6, growth_pct=-5, metric="profit")
    assert response.json() == json.loads(json.dumps(expected))


def test_dataset_route_answers_404_for_an_unknown_id(monkeypatch):
    client, _ = _dataset_client(monkeypatch)
    assert client.get("/api/erp/datasets/payroll_secrets").status_code == 404


def test_dataset_route_answers_422_out_of_bounds(monkeypatch):
    client, _ = _dataset_client(monkeypatch)
    for query in ("quarters=0", "quarters=9", "growth_pct=51", "growth_pct=-51", "metric=headcount", "quarters=x"):
        response = client.get(f"/api/erp/datasets/revenue_forecast?{query}")
        assert response.status_code == 422, query


def test_reset_route_restores_the_initial_data(monkeypatch):
    client, store = _dataset_client(monkeypatch)
    initial = store.snapshot()
    bill = next(b for b in initial["bills"] if b["status"] != "paid")
    store.pay_bills([bill["id"]])
    assert store.snapshot() != initial
    response = client.post("/api/erp/reset")
    assert response.status_code == 200
    assert store.snapshot() == initial
