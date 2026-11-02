from __future__ import annotations

import models
from models import orchestrator_chat_model, subagent_chat_model


def test_model_ids_are_dated():
    assert "latest" not in models.ORCHESTRATOR_MODEL
    assert "latest" not in models.SUBAGENT_MODEL


def test_orchestrator_client_disables_parallel_tool_calls():
    assert orchestrator_chat_model().model_kwargs["parallel_tool_calls"] is False


def test_clients_make_a_single_bounded_attempt():
    for client in (orchestrator_chat_model(), subagent_chat_model()):
        assert client.max_retries == models.MAX_RETRIES == 1
        assert client.timeout == models.REQUEST_TIMEOUT_S
        assert client.temperature == 0
