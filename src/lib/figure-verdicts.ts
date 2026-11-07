// The verdict on an assistant message is given once, when the message is first
// shown, and kept. A later change to the books (an approval, say) must never
// badge an old reply that was right when it was written. The map lives outside
// React for the same reason as `handled-tool-calls.ts`: a remount of the list
// must not give a second verdict.
const frozen = new Map<string, { source: string; marked: string }>();

/**
 * The text of message `id` with its unverified figures marked. `judge` runs
 * only the first time a given text is seen for that message.
 */
export function frozenVerdict(id: string, source: string, judge: () => string): string {
  const kept = frozen.get(id);
  if (kept && kept.source === source) return kept.marked;
  const marked = judge();
  frozen.set(id, { source, marked });
  return marked;
}

// A demo reset empties the conversation; its messages are not shown again.
export function forgetFigureVerdicts(): void {
  frozen.clear();
}
