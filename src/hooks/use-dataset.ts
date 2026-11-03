"use client";

import { useEffect, useState } from "react";
import { useErp } from "@/context/erp-context";
import {
  fetchDataset,
  type CashPositionDataset,
  type ChartDataset,
  type DatasetParams,
} from "@/lib/erp-api";

type Result<T> = { key: string; data?: T; error?: string };

// Reads one dataset of the catalog from the agent service. It reads again when
// the request changes or when the snapshot is refreshed (an approval changed
// the store), and keeps showing the previous figures until the new ones arrive.
export function useDataset<T extends ChartDataset | CashPositionDataset>(
  id: string | undefined,
  params: DatasetParams,
  enabled = true,
): { data?: T; error?: string; loading: boolean } {
  const { totals } = useErp();
  const { quarters, growth_pct, metric } = params;
  const key = `${id}|${quarters}|${growth_pct}|${metric}`;
  const [result, setResult] = useState<Result<T> | null>(null);

  useEffect(() => {
    if (!enabled || !id) return;
    let current = true;
    fetchDataset<T>(id, { quarters, growth_pct, metric })
      .then((data) => {
        if (current) setResult({ key, data });
      })
      .catch((e: unknown) => {
        if (current) {
          setResult({
            key,
            error:
              e instanceof Error ? e.message : "The data service is unreachable",
          });
        }
      });
    return () => {
      current = false;
    };
  }, [enabled, id, key, quarters, growth_pct, metric, totals]);

  if (!enabled) return { loading: true };
  if (!id) return { error: "No dataset was requested.", loading: false };
  if (!result || result.key !== key) return { loading: true };
  return { data: result.data, error: result.error, loading: false };
}
