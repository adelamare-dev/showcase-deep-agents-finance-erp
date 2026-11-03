"""REST access to the ERP store, for the web UI."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from erp_datasets import (
    DATASET_IDS,
    GROWTH_PCT_LIMIT,
    MAX_QUARTERS,
    MIN_QUARTERS,
    build_dataset,
)
from erp_store import get_store

router = APIRouter(prefix="/api/erp")


@router.get("/snapshot")
def snapshot() -> dict:
    """Every dataset and the totals, as one document."""
    return get_store().snapshot()


@router.post("/reset")
def reset() -> dict:
    """Restore the initial data, dropping every payment and order made since start-up."""
    get_store().reset()
    return {"status": "reset"}


@router.get("/datasets/{dataset_id}")
def dataset(
    dataset_id: str,
    quarters: int = Query(4, ge=MIN_QUARTERS, le=MAX_QUARTERS),
    growth_pct: float = Query(0, ge=-GROWTH_PCT_LIMIT, le=GROWTH_PCT_LIMIT),
    metric: Literal["revenue", "profit", "cash_flow"] = "revenue",
) -> dict:
    """One chart or card of the catalog, built from the store at request time."""
    if dataset_id not in DATASET_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown dataset: {dataset_id}")
    return build_dataset(get_store(), dataset_id, quarters=quarters, growth_pct=growth_pct, metric=metric)
