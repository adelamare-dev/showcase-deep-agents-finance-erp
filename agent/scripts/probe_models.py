"""Probe candidate Mistral models: one minimal tool-calling request each.

Prints one row per model with the HTTP status and the `x-ratelimit-*` response
headers. The API key is read from the environment and never printed.

Run from `agent/`: `uv run python scripts/probe_models.py`
"""

from __future__ import annotations

import os
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()

URL = "https://api.mistral.ai/v1/chat/completions"
CANDIDATES = [
    "mistral-small-2603",
    "ministral-14b-2512",
    "ministral-8b-2512",
    "mistral-medium-2508",
    "mistral-large-2512",
    "mistral-small-2506",
    "ministral-3b-2512",
]

TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}


def probe(client: httpx.Client, key: str, model: str) -> dict[str, str]:
    """Send one tool-calling request and return the row to print."""
    body = {
        "model": model,
        "temperature": 0,
        "max_tokens": 64,
        "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
        "tools": [TOOL],
        "tool_choice": "any",
    }
    try:
        response = client.post(
            URL, json=body, headers={"Authorization": f"Bearer {key}"}
        )
    except httpx.HTTPError as exc:
        return {"model": model, "status": type(exc).__name__}
    row = {"model": model, "status": str(response.status_code)}
    for name, value in response.headers.items():
        if name.lower().startswith("x-ratelimit"):
            row[name.lower()] = value
    if response.status_code == 200:
        message = response.json()["choices"][0]["message"]
        row["tool_call"] = str(bool(message.get("tool_calls")))
    return row


def main() -> int:
    key = os.environ.get("MISTRAL_API_KEY")
    if not key:
        print("MISTRAL_API_KEY is not set (expected in agent/.env).", file=sys.stderr)
        return 1
    with httpx.Client(timeout=45) as client:
        rows = [probe(client, key, model) for model in CANDIDATES]
    for row in rows:
        print(" | ".join(f"{k}={v}" for k, v in row.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
