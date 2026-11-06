import type { Page } from "@playwright/test";

export interface ScenarioResult {
  passed: number;
  failed: { name: string; error?: string }[];
  cases: unknown[];
}

export function loadScenario(
  name: string,
  options?: { only?: (string | number)[] },
): { source: string; run: (page: Page) => Promise<ScenarioResult> } | null;
