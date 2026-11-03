import { useSyncExternalStore } from "react";

// Name of the custom event the agent dispatches for each tool call a subagent
// makes while a `do_research` or `do_projections` card is running.
export const SUBAGENT_STEP_EVENT = "subagent_step";

export type SubagentStep = {
  tool: string;
  args: string;
};

type StepEvent = { toolCallId?: unknown; tool?: unknown; args?: unknown };

// Steps by tool call id, so each card shows its own. The map is replaced on
// every change: that is what lets `useSyncExternalStore` see a new snapshot.
let stepsByCall: ReadonlyMap<string, readonly SubagentStep[]> = new Map();
const listeners = new Set<() => void>();
const NO_STEPS: readonly SubagentStep[] = [];

function emit() {
  listeners.forEach((listener) => listener());
}

export function recordSubagentStep(value: unknown) {
  const { toolCallId, tool, args } = (value ?? {}) as StepEvent;
  if (
    typeof toolCallId !== "string" ||
    typeof tool !== "string" ||
    typeof args !== "string"
  ) {
    return;
  }
  const next = new Map(stepsByCall);
  next.set(toolCallId, [...(stepsByCall.get(toolCallId) ?? []), { tool, args }]);
  stepsByCall = next;
  emit();
}

export function clearSubagentSteps() {
  stepsByCall = new Map();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The steps reported so far for one tool call, in the order they happened.
export function useSubagentSteps(toolCallId?: string): readonly SubagentStep[] {
  const steps = useSyncExternalStore(
    subscribe,
    () => (toolCallId ? stepsByCall.get(toolCallId) : undefined),
    () => undefined,
  );
  return steps ?? NO_STEPS;
}

// "query_invoices" -> "Query invoices"
export function stepLabel(tool: string): string {
  const words = tool.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
