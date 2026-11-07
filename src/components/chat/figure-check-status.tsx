"use client";

import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import { figureCheckText } from "@/content/ui-text";

// Shown while a reply is prepared: the orchestrator's text is checked against
// the books before it reaches the chat, so nothing streams until it is ready.
// That is the case while a run is going and the thread ends on the user's
// message, a tool result or an assistant message without text.
export function FigureCheckStatus() {
  const { agent } = useAgent({
    agentId: "finance_erp_agent",
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  const last = agent.messages[agent.messages.length - 1];
  const preparing =
    agent.isRunning &&
    last !== undefined &&
    (last.role === "user" ||
      last.role === "tool" ||
      (last.role === "assistant" && !(typeof last.content === "string" && last.content.trim())));
  if (!preparing) return null;
  return (
    <div
      role="status"
      data-testid="figure-check-status"
      className="mx-4 mb-2 text-sm text-muted-foreground"
    >
      {figureCheckText.checking}
    </div>
  );
}
