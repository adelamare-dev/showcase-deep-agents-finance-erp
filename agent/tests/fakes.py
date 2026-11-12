from __future__ import annotations

from typing import Any

from langchain_core.language_models.base import LangSmithParams
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field


def tool_names(tools) -> set[str]:
    """Names of tools given as BaseTool, OpenAI-style dicts or callables."""
    names = set()
    for t in tools:
        if isinstance(t, dict):
            names.add((t.get("function") or t)["name"])
        else:
            names.add(getattr(t, "name", None) or t.__name__)
    return names


class ScriptedToolCaller(BaseChatModel):
    """Chat model that requests one scripted tool call per message.

    Each reply carries a single call with a fresh id. Once the script is spent
    the model answers with an empty message, which ends the turn.
    """

    script: list[tuple[str, dict]]
    calls: list = Field(default_factory=list)
    # Names of the tools the agent bound to the model, in order.
    bound_tools: set[str] = Field(default_factory=set)

    @property
    def _llm_type(self) -> str:
        return "scripted-tool-caller"

    def _get_ls_params(self, stop: list[str] | None = None, **kwargs: Any) -> LangSmithParams:
        # Report the provider of the client this fake stands in for, so the
        # provider-keyed harness profile applies to it.
        return LangSmithParams(ls_provider="mistral", ls_model_type="chat")

    def bind_tools(self, tools, **kwargs):
        self.bound_tools = tool_names(tools)
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        index = len(self.calls)
        self.calls.append(messages)
        if index < len(self.script):
            name, args = self.script[index]
            reply = AIMessage(
                content="",
                tool_calls=[
                    {"id": f"call{len(self.calls)}", "name": name, "args": args}
                ],
            )
        else:
            reply = AIMessage(content="")
        return ChatResult(generations=[ChatGeneration(message=reply)])


class ScriptedReplies(BaseChatModel):
    """Chat model that answers with the given messages, one per call.

    Once the script is spent it repeats the last message. `calls` holds the
    messages each call received.
    """

    replies: list[AIMessage]
    calls: list = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted-replies"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        index = min(len(self.calls), len(self.replies) - 1)
        self.calls.append(list(messages))
        reply = self.replies[index].model_copy(deep=True)
        return ChatResult(generations=[ChatGeneration(message=reply)])
