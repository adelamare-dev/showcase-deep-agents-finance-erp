from __future__ import annotations

import pytest

import main


def test_missing_key_stops_startup_with_a_named_file(monkeypatch):
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    with pytest.raises(SystemExit) as stop:
        main.require_api_key()
    assert str(stop.value) == (
        "MISTRAL_API_KEY is missing: copy agent/.env.example to agent/.env and set it."
    )


def test_blank_key_counts_as_missing(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "   ")
    with pytest.raises(SystemExit):
        main.require_api_key()


def test_a_set_key_lets_startup_continue(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "any-value")
    main.require_api_key()
