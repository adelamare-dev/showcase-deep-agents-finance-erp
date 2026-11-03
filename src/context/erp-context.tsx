"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";
import { useDashboard } from "@/context/dashboard-context";
import { fetchSnapshot, resetErpData, type ErpSnapshot } from "@/lib/erp-api";
import { forgetToolCalls } from "@/lib/handled-tool-calls";
import { clearSubagentSteps } from "@/lib/subagent-steps";

// Custom event the agent sends once an approved action has changed the books.
export const ERP_DATA_CHANGED_EVENT = "erp_data_changed";

// How long a changed figure stays highlighted.
export const HIGHLIGHT_MS = 3000;

type ErpContextValue = ErpSnapshot & {
  refresh: () => Promise<void>;
  // Puts the demo back to its starting point: books, dashboards, saved layouts,
  // subagent steps and conversation. Rejects, changing nothing, when the agent
  // cannot reset its books.
  resetDemo: () => Promise<void>;
  // Signed change by KPI label, cleared HIGHLIGHT_MS after the last change.
  highlights: Record<string, number>;
};

const ErpContext = createContext<ErpContextValue | null>(null);

// Keeps the well-formed `{metric, delta}` pairs of an event payload.
function readChanges(value: unknown): Record<string, number> {
  const raw = (value as { changes?: unknown } | null)?.changes;
  const out: Record<string, number> = {};
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    const { metric, delta } = (entry ?? {}) as {
      metric?: unknown;
      delta?: unknown;
    };
    if (typeof metric === "string" && typeof delta === "number" && delta !== 0) {
      out[metric] = (out[metric] ?? 0) + delta;
    }
  }
  return out;
}

// Renders its children only once the snapshot is loaded, so no page ever
// reads a partial dataset.
export function ErpProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<ErpSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True once a reload failed while data is on screen: the figures may be old.
  const [stale, setStale] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [highlights, setHighlights] = useState<Record<string, number>>({});
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by the retry button to run the initial load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetchSnapshot()
      .then((next) => {
        if (current) setSnapshot(next);
      })
      .catch((e: unknown) => {
        if (current) {
          setError(e instanceof Error ? e.message : "The data service is unreachable");
        }
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  // Re-reads the store after a change. A failure keeps the old figures, flags
  // them as possibly old (the notice offers a retry) and is also left to the
  // caller.
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await fetchSnapshot());
      setStale(false);
    } catch (e) {
      setStale(true);
      throw e;
    }
  }, []);

  const retryRefresh = useCallback(async () => {
    setRetrying(true);
    try {
      await refresh();
    } catch {
      // The notice stays on screen.
    } finally {
      setRetrying(false);
    }
  }, [refresh]);

  const { resetDashboards } = useDashboard();
  const startNewThread = useCopilotChatConfiguration()?.startNewThread;

  // The books are reset first: if the agent refuses, the screen is untouched.
  const resetDemo = useCallback(async () => {
    await resetErpData();
    clearSubagentSteps();
    forgetToolCalls();
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setHighlights({});
    await resetDashboards();
    startNewThread?.();
    await refresh();
  }, [refresh, resetDashboards, startNewThread]);

  // The agent reports each change to the books; the figures are reloaded first
  // so the highlight lands on the new values. The reload at the end of every
  // run covers a lost event. A failed reload keeps the old data on screen.
  const { agent } = useAgent({ agentId: "finance_erp_agent", updates: [] });
  useEffect(() => {
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name !== ERP_DATA_CHANGED_EVENT) return;
        const changes = readChanges(event.value);
        void refresh()
          .then(() => {
            if (Object.keys(changes).length === 0) return;
            setHighlights(changes);
            if (clearTimer.current) clearTimeout(clearTimer.current);
            clearTimer.current = setTimeout(() => setHighlights({}), HIGHLIGHT_MS);
          })
          .catch(() => {});
      },
      onRunFinalized: () => {
        void refresh().catch(() => {});
      },
    });
    return () => {
      subscription.unsubscribe();
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setHighlights({});
    };
  }, [agent, refresh]);

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm font-medium text-foreground">
              Could not load the company data.
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <p className="animate-pulse text-muted-foreground">Loading data...</p>
        )}
      </div>
    );
  }

  return (
    <ErpContext.Provider value={{ ...snapshot, refresh, resetDemo, highlights }}>
      {stale && (
        <div
          role="alert"
          data-testid="erp-stale-notice"
          className="fixed left-1/2 top-3 z-[1300] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-destructive/30 bg-background px-4 py-2 text-sm shadow-md"
        >
          <span>
            The data service did not answer. The figures shown may be out of date.
          </span>
          <Button
            size="sm"
            variant="outline"
            data-testid="erp-stale-retry"
            disabled={retrying}
            onClick={() => void retryRefresh()}
          >
            Retry
          </Button>
        </div>
      )}
      {children}
    </ErpContext.Provider>
  );
}

export function useErp(): ErpContextValue {
  const ctx = useContext(ErpContext);
  if (!ctx) {
    throw new Error("useErp must be used within an ErpProvider");
  }
  return ctx;
}
