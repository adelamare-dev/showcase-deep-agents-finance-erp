// A tool card can mount again (navigation, re-render of the message list)
// while its call is already complete. The keys of the calls already carried out
// live outside React so that a remount never applies the same call twice.
// Each key starts with a prefix naming its tool (`save-`, `load-` or the tool
// name), so one set serves every tool.
const handled = new Set<string>();

// True the first time a key is seen, false afterwards.
export function claimToolCall(key: string): boolean {
  if (handled.has(key)) return false;
  handled.add(key);
  return true;
}

// A dashboard reset that lands after a replacing update of the same run would
// wipe the dashboard just built (each card applies when its own result
// arrives), so it is ignored. The flag is cleared when a run starts.
let replacedThisRun = false;

export function markDashboardReplaced(): void {
  replacedThisRun = true;
}

export function dashboardReplacedThisRun(): boolean {
  return replacedThisRun;
}

export function clearDashboardReplaced(): void {
  replacedThisRun = false;
}

// A demo reset empties the conversation, so a call with the same arguments
// must take effect again on the next take.
export function forgetToolCalls(): void {
  handled.clear();
  replacedThisRun = false;
}
