from __future__ import annotations

import pytest

import models
from models import orchestrator_chat_model, subagent_chat_model


def test_model_ids_are_dated():
    assert "latest" not in models.ORCHESTRATOR_MODEL
    assert "latest" not in models.SUBAGENT_MODEL


def test_parallel_tool_calls_are_on_in_the_shipped_state():
    assert models.ORCHESTRATOR_PARALLEL_TOOL_CALLS is True
    assert orchestrator_chat_model().model_kwargs["parallel_tool_calls"] is True


@pytest.mark.parametrize("enabled", [False, True])
def test_orchestrator_client_follows_the_parallel_switch(monkeypatch, enabled):
    monkeypatch.setattr(models, "ORCHESTRATOR_PARALLEL_TOOL_CALLS", enabled)
    assert orchestrator_chat_model().model_kwargs["parallel_tool_calls"] is enabled


@pytest.mark.parametrize("model", ["ministral-14b-2512", "ministral-8b-2512"])
def test_subagent_client_uses_the_subagent_model(monkeypatch, model):
    monkeypatch.setattr(models, "SUBAGENT_MODEL", model)
    assert subagent_chat_model().model == model


def test_the_shipped_subagent_model_is_the_measured_one():
    assert models.SUBAGENT_MODEL == "ministral-8b-2512"


def test_clients_make_a_single_bounded_attempt():
    for client in (orchestrator_chat_model(), subagent_chat_model()):
        assert client.max_retries == models.MAX_RETRIES == 1
        assert client.timeout == models.REQUEST_TIMEOUT_S
        assert client.temperature == 0
