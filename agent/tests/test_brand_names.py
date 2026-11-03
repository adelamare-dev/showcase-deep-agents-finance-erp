"""No fictional-company brand name from the blocklist appears in the source,
and the user's initials are written only in the brand module."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIPPED_DIRS = {".venv", "node_modules", "__pycache__", ".next", ".git", ".pytest_cache"}
SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".py", ".json", ".css", ".svg"}
BRANDS = [
    "Stark", "Wayne", "Umbrella", "Acme", "Globex", "Initech",
    "Cyberdyne", "Soylent", "Massive Dynamic",
]
# The two test files that spell the list out are not scanned for it.
LIST_FILES = {Path(__file__).resolve(), Path(__file__).resolve().with_name("test_erp_invariants.py")}
BRAND_FILE = ROOT / "src" / "content" / "brand.ts"


def _sources():
    for top in ("src", "agent"):
        for path in (ROOT / top).rglob("*"):
            if not path.is_file() or path.suffix not in SUFFIXES:
                continue
            if SKIPPED_DIRS & set(path.parts) or path.resolve() in LIST_FILES:
                continue
            yield path


def test_no_blocklisted_brand_in_source():
    pattern = re.compile("|".join(re.escape(b) for b in BRANDS), re.IGNORECASE)
    hits = [
        f"{p.relative_to(ROOT)}: {m.group(0)}"
        for p in _sources()
        for m in pattern.finditer(p.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == []


def test_company_name_matches_the_store():
    from erp_seed import COMPANY

    match = re.search(r'company:\s*"([^"]+)"', BRAND_FILE.read_text(encoding="utf-8"))
    assert match, "no company in the brand module"
    assert match.group(1) == COMPANY


def test_user_initials_only_in_brand_module():
    pattern = re.compile(r"\bJD\b")
    hits = [
        str(p.relative_to(ROOT))
        for p in _sources()
        if p != BRAND_FILE and pattern.search(p.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert hits == []
