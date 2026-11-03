"use client";

import { useEffect, useState } from "react";
import {
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";
import { describeRunError, type RunErrorInfo } from "@/lib/run-errors";

// Says in plain words why the last run failed, and offers to run it again.
// Retry replays the agent on the messages already in the thread: it adds no
// message, and the effect of a tool call is applied once per key
// (`handled-tool-calls.ts`), so a call carried out before the failure is not
// carried out a second time.
export function RunErrorBanner() {
  const { agent } = useAgent({
    agentId: "finance_erp_agent",
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();
  const [error, setError] = useState<RunErrorInfo | null>(null);

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunInitialized: () => setError(null),
      // The agent reported the failure in the stream.
      onRunErrorEvent: ({ event }) => setError(describeRunError(event.message)),
      // The request itself failed: the agent or the runtime did not answer.
      onRunFailed: ({ error: failure }) => setError(describeRunError(failure)),
    });
    return () => subscription.unsubscribe();
  }, [agent]);

  if (!error) return null;

  return (
    <div
      role="alert"
      data-testid="run-error-banner"
      data-kind={error.kind}
      className="pointer-events-auto mx-4 mb-2 flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <span>{error.message}</span>
      <Button
        size="sm"
        variant="outline"
        data-testid="run-error-retry"
        disabled={agent.isRunning}
        onClick={() => {
          setError(null);
          copilotkit.runAgent({ agent }).catch(() => {});
        }}
      >
        Retry
      </Button>
    </div>
  );
}
