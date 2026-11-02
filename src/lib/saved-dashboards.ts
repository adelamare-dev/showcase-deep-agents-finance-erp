import { DASHBOARD_TEMPLATES } from "@/content/dashboard-templates";
import type { DashboardWidget, SavedDashboard } from "@/types/dashboard";

// Versioned so a change of format never reads an older entry as a current one.
const LOCAL_KEY = "finance-os.dashboards.v2";

// ---------------------------------------------------------------------------
// localStorage helpers. Storage can be missing, blocked, full or corrupted:
// every access is guarded and an unreadable entry is ignored.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Widgets that embed their own data points are not accepted: every figure
// must come from the agent service at render time.
function isValidWidget(value: unknown): value is DashboardWidget {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string") {
    return false;
  }
  if (value.config !== undefined) {
    if (!isRecord(value.config) || "data" in value.config) return false;
  }
  return true;
}

function isValidDashboard(value: unknown): value is SavedDashboard {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.widgets) &&
    value.widgets.every(isValidWidget)
  );
}

function getLocalCustom(): SavedDashboard[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidDashboard)
      .map((d) => ({ ...d, category: "custom" as const }));
  } catch {
    return [];
  }
}

function persistLocal(dashboards: SavedDashboard[]) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(dashboards));
  } catch {
    // Storage unavailable: the dashboard lives for this session only.
  }
}

// ---------------------------------------------------------------------------
// Public API: built-in templates plus the dashboards saved in this browser
// ---------------------------------------------------------------------------

export async function getSavedDashboards(): Promise<SavedDashboard[]> {
  return [...DASHBOARD_TEMPLATES, ...getLocalCustom()];
}

export async function saveDashboard(
  name: string,
  widgets: DashboardWidget[],
  description?: string,
): Promise<SavedDashboard> {
  const now = new Date().toISOString();
  const entry: SavedDashboard = {
    id: crypto.randomUUID(),
    name,
    description,
    category: "custom",
    widgets,
    createdAt: now,
    updatedAt: now,
  };
  persistLocal([...getLocalCustom(), entry]);
  return entry;
}

export async function deleteSavedDashboard(id: string): Promise<void> {
  persistLocal(getLocalCustom().filter((d) => d.id !== id));
}

export async function loadSavedDashboard(
  id: string,
): Promise<DashboardWidget[] | null> {
  const found = (await getSavedDashboards()).find((d) => d.id === id);
  return found?.widgets ?? null;
}

export async function findSavedDashboardByName(
  name: string,
): Promise<SavedDashboard | null> {
  const dashboards = await getSavedDashboards();
  const lower = name.toLowerCase();
  return dashboards.find((d) => d.name.toLowerCase().includes(lower)) ?? null;
}
