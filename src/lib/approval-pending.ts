import { useSyncExternalStore } from "react";

// True while an approval card waits for an answer. The run is paused there, so
// the agent reports itself as idle and the Settings reset must be told apart.
let pending = false;
const listeners = new Set<() => void>();

export function setApprovalPending(next: boolean): void {
  if (pending === next) return;
  pending = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useApprovalPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending,
    () => false,
  );
}
