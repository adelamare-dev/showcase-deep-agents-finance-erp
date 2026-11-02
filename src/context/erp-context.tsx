"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { fetchSnapshot, type ErpSnapshot } from "@/lib/erp-api";

type ErpContextValue = ErpSnapshot & { refresh: () => Promise<void> };

const ErpContext = createContext<ErpContextValue | null>(null);

// Renders its children only once the snapshot is loaded, so no page ever
// reads a partial dataset.
export function ErpProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<ErpSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // Re-reads the store after a change. A failure is left to the caller.
  const refresh = useCallback(async () => {
    setSnapshot(await fetchSnapshot());
  }, []);

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
    <ErpContext.Provider value={{ ...snapshot, refresh }}>
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
