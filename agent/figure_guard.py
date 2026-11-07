"""Rule that decides whether a figure written in the assistant's text is real.

A figure is a dollar amount, a percentage or a count of ERP entities. It is
admitted when it equals a number the tools returned this turn, a number of the
store snapshot or a number the user typed, allowing for display rounding. The
TypeScript twin in `src/lib/figure-guard.ts` applies the same rule to the same
cases (`tests/data/figure_cases.json`): change both together.

Values are compared in absolute terms: a sign never makes a figure wrong.
"""

from __future__ import annotations

import re
from typing import Literal, NamedTuple

MARK_OPEN = "⟦unverified:"
MARK_CLOSE = "⟧"

CORRECTION = (
    "Your reply cites figures not returned by this turn's tools: {raws}. "
    "Quote only figures returned by tools, exactly, or say you don't have this data."
)

_SCALES = {
    "k": 1e3,
    "thousand": 1e3,
    "m": 1e6,
    "million": 1e6,
    "b": 1e9,
    "billion": 1e9,
}
_TOLERANCE = 1e-9
_CENT = 0.005

_NUMBER = r"\d+(?:,\d{3})*(?:\.\d+)?"
_MARK_RE = re.compile(re.escape(MARK_OPEN) + r"[^" + MARK_CLOSE + r"]*" + MARK_CLOSE)
_ENTITY = r"(?:employee|bill|invoice|client|customer|supplier|item)s?"
_CURRENCY = r"(?:USD|dollars?)"
# A scaled number followed by an ERP entity ("2 million customers") is a count,
# not money; one adjective may sit between the number and the entity.
_ENTITY_AHEAD = r"(?!\s+(?:[A-Za-z]+\s+)?" + _ENTITY + r"\b)"
_MONEY_RE = re.compile(
    r"(?:(?:\$|USD\s?)\s?(?P<n1>" + _NUMBER + r")(?:\s?(?P<s1>thousand|million|billion|[KMB])\b)?"
    r"|(?<![\w.,$])(?P<n2>" + _NUMBER + r")\s?"
    r"(?:(?P<s2>thousand|million|billion)\b" + _ENTITY_AHEAD + r"(?:\s" + _CURRENCY + r"\b)?"
    r"|" + _CURRENCY + r"\b))",
    re.IGNORECASE,
)
_PERCENT_RE = re.compile(r"(?<![\w.,])(" + _NUMBER + r")(?:\s?%|\s(?:percent)\b)", re.IGNORECASE)
_COUNT_RE = re.compile(
    r"(?<![\w.,$])(?P<n>" + _NUMBER + r")(?:\s(?P<s>thousand|million|billion))?"
    r"\s+(?:[A-Za-z]+\s+)?" + _ENTITY + r"\b",
    re.IGNORECASE,
)
_ANY_NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")


class Figure(NamedTuple):
    raw: str
    kind: Literal["money", "percent", "count"]
    value: float


def _to_float(digits: str) -> float:
    return float(digits.replace(",", ""))


def _blank_marks(text: str) -> str:
    """Hide the content of existing marks, keeping every offset."""
    return _MARK_RE.sub(lambda m: " " * len(m.group(0)), text)


def _widen(text: str, start: int, end: int) -> tuple[int, int]:
    """Include a leading minus or a surrounding pair of parentheses."""
    if start > 0 and text[start - 1] == "-" and (start == 1 or text[start - 2].isspace() or text[start - 2] == "("):
        return start - 1, end
    if start > 0 and text[start - 1] == "(" and text[end : end + 1] == ")":
        return start - 1, end + 1
    return start, end


def _scan(text: str) -> list[tuple[int, int, Figure]]:
    hidden = _blank_marks(text)
    found: list[tuple[int, int, Figure]] = []
    for m in _MONEY_RE.finditer(hidden):
        digits = m.group("n1") or m.group("n2")
        suffix = m.group("s1") or m.group("s2")
        scale = _SCALES[suffix.lower()] if suffix else 1
        start, end = _widen(hidden, m.start(), m.end())
        found.append((start, end, Figure(text[start:end], "money", round(_to_float(digits) * scale, 6))))
    for m in _PERCENT_RE.finditer(hidden):
        found.append((m.start(), m.end(), Figure(m.group(0), "percent", _to_float(m.group(1)))))
    for m in _COUNT_RE.finditer(hidden):
        scale = _SCALES[m.group("s").lower()] if m.group("s") else 1
        found.append((m.start(), m.end(), Figure(m.group(0), "count", round(_to_float(m.group("n")) * scale, 6))))
    found.sort(key=lambda item: item[0])
    return found


def extract_figures(text: str) -> list[Figure]:
    """Dollar amounts, percentages and entity counts of `text`, in reading order."""
    return [fig for _, _, fig in _scan(text)]


def _numbers_in(text: str) -> set[float]:
    values: set[float] = set()
    for m in _ANY_NUMBER_RE.finditer(text):
        token = m.group(0)
        values.add(_to_float(token))
        # "[5,123]" is a list of two numbers as often as it is 5,123.
        if "," in token:
            values.update(_to_float(part) for part in token.split(","))
    return values


def _leaves(node: object) -> set[float]:
    if isinstance(node, bool):
        return set()
    if isinstance(node, (int, float)):
        return {abs(float(node))}
    if isinstance(node, dict):
        return set().union(*(_leaves(v) for v in node.values())) if node else set()
    if isinstance(node, (list, tuple)):
        return set().union(*(_leaves(v) for v in node)) if node else set()
    return set()


def allowed_values(tool_texts: list[str], snapshot: dict, user_text: str) -> set[float]:
    """Every number a figure may legitimately equal this turn."""
    allowed: set[float] = set(_leaves(snapshot))
    for text in (*tool_texts, user_text):
        allowed |= _numbers_in(text or "")
    return {abs(v) for v in allowed}


def _same(a: float, b: float) -> bool:
    return abs(a - b) < _TOLERANCE


def _decimals(digits: str) -> int:
    """Decimals a figure is written with, at least one."""
    return max(len(digits.split(".")[1]) if "." in digits else 0, 1)


def _within(value: float, written: float, decimals: int) -> bool:
    """Whether `value`, displayed with `decimals` decimals, may read `written`.

    One rule for both languages: no rounding function is involved, so exact
    halves behave the same everywhere.
    """
    return abs(value - written) <= 0.5 * 10**-decimals + _TOLERANCE


def _money_allowed(fig: Figure, allowed: set[float]) -> bool:
    if any(abs(fig.value - v) < _CENT for v in allowed):
        return True
    m = _MONEY_RE.fullmatch(fig.raw.strip("-()").strip())
    suffix = m and (m.group("s1") or m.group("s2"))
    if not m or not suffix:
        return False
    scale = _SCALES[suffix.lower()]
    digits = m.group("n1") or m.group("n2")
    written = _to_float(digits)
    return any(_within(v / scale, written, _decimals(digits)) for v in allowed)


def is_allowed(fig: Figure, allowed: set[float]) -> bool:
    """Whether `fig` equals an allowed value, allowing for display rounding."""
    if fig.kind == "money":
        return _money_allowed(fig, allowed)
    if fig.kind == "percent":
        decimals = _decimals(re.match(r"[\d,.]+", fig.raw).group(0))
        return any(
            _within(v, fig.value, decimals) or (v <= 1 and _within(v * 100, fig.value, decimals))
            for v in allowed
        )
    return any(_same(v, fig.value) for v in allowed)


def unverified(text: str, allowed: set[float]) -> list[Figure]:
    """The figures of `text` that no allowed value backs."""
    return [fig for fig in extract_figures(text) if not is_allowed(fig, allowed)]


def mark(text: str, figs: list[Figure]) -> str:
    """Wrap each of the given figures in `⟦unverified:…⟧`, leaving the rest as is."""
    raws = {fig.raw for fig in figs}
    out: list[str] = []
    cursor = 0
    for start, end, fig in _scan(text):
        if fig.raw in raws and start >= cursor:
            out.append(text[cursor:start])
            out.append(f"{MARK_OPEN}{fig.raw}{MARK_CLOSE}")
            cursor = end
    out.append(text[cursor:])
    return "".join(out)
