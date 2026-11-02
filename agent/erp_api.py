"""REST access to the ERP store, for the web UI."""

from __future__ import annotations

from fastapi import APIRouter

from erp_store import get_store

router = APIRouter(prefix="/api/erp")


@router.get("/snapshot")
def snapshot() -> dict:
    """Every dataset and the totals, as one document."""
    return get_store().snapshot()
