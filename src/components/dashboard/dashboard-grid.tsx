"use client";

import { useEffect, useRef, useState } from "react";
import { useDashboard } from "@/context/dashboard-context";
import {
  WidgetRenderer,
  colSpanClass,
} from "@/components/dashboard/widget-renderer";
import { DashboardToolbar } from "@/components/dashboard/dashboard-toolbar";
import type { DashboardWidget } from "@/types/dashboard";

type DisplayWidget = DashboardWidget & {
  phase: "entering" | "visible" | "exiting";
  enterIndex?: number;
};

const EXIT_DURATION = 250;

export function DashboardGrid() {
  const { widgets } = useDashboard();
  const [displayed, setDisplayed] = useState<DisplayWidget[]>(() =>
    widgets.map((w) => ({ ...w, phase: "visible" as const })),
  );
  const prevIdsRef = useRef<Set<string>>(new Set(widgets.map((w) => w.id)));
  const exitTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const scrollTargetRef = useRef<string | null>(null);
  const elementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const prevIds = prevIdsRef.current;
    const nextIds = new Set(widgets.map((w) => w.id));

    const entering = widgets.filter((w) => !prevIds.has(w.id));
    const exiting = [...prevIdsRef.current].filter((id) => !nextIds.has(id));
    const persisted = widgets.filter((w) => prevIds.has(w.id));

    // Build new display list
    const next: DisplayWidget[] = [
      ...persisted.map((w) => ({ ...w, phase: "visible" as const })),
      ...entering.map((w, i) => ({
        ...w,
        phase: "entering" as const,
        enterIndex: i,
      })),
    ];

    // Keep exiting widgets temporarily
    setDisplayed((prev) => {
      const exitingWidgets = prev
        .filter((w) => exiting.includes(w.id))
        .map((w) => ({ ...w, phase: "exiting" as const }));
      return [...next, ...exitingWidgets];
    });

    // Remove exiting widgets after animation
    if (exiting.length > 0) {
      const timer = setTimeout(() => {
        setDisplayed((prev) => prev.filter((w) => w.phase !== "exiting"));
        exitTimersRef.current.delete(timer);
      }, EXIT_DURATION);
      exitTimersRef.current.add(timer);
    }

    // Transition entering → visible after animation
    if (entering.length > 0) {
      const timer = setTimeout(
        () => {
          setDisplayed((prev) =>
            prev.map((w) =>
              w.phase === "entering" ? { ...w, phase: "visible" } : w,
            ),
          );
          exitTimersRef.current.delete(timer);
        },
        350 + entering.length * 80,
      );
      exitTimersRef.current.add(timer);
    }

    // A widget added on its own scrolls into view. A replaced layout (a saved
    // dashboard loaded, a reset) removes widgets in the same update and stays
    // where it is, so does the first render.
    if (entering.length > 0 && exiting.length === 0) {
      const last = entering.reduce((a, b) => (b.order >= a.order ? b : a));
      scrollTargetRef.current = last.id;
    }

    prevIdsRef.current = nextIds;

    return () => {
      exitTimersRef.current.forEach(clearTimeout);
      exitTimersRef.current.clear();
    };
  }, [widgets]);

  // Runs once the new widget is in the DOM.
  useEffect(() => {
    const id = scrollTargetRef.current;
    const element = id ? elementsRef.current.get(id) : undefined;
    if (!element) return;
    scrollTargetRef.current = null;
    element.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [displayed]);

  const sorted = [...displayed].sort((a, b) => {
    // Exiting widgets go last
    if (a.phase === "exiting" && b.phase !== "exiting") return 1;
    if (b.phase === "exiting" && a.phase !== "exiting") return -1;
    return a.order - b.order;
  });

  return (
    <div>
      <DashboardToolbar />
      <div className="@container space-y-8 p-8">
        <div className="grid grid-flow-row-dense grid-cols-1 gap-6 transition-all duration-300 @xl:grid-cols-2 @5xl:grid-cols-4">
          {sorted.map((widget) => (
            <div
              key={widget.id}
              ref={(el) => {
                if (el) elementsRef.current.set(widget.id, el);
                else elementsRef.current.delete(widget.id);
              }}
              data-widget-type={widget.type}
              data-widget-dataset={
                widget.type === "custom-chart" ? widget.config.dataset : undefined
              }
              className={`${colSpanClass(widget.type, widget.colSpan)} ${
                widget.phase === "entering"
                  ? "widget-enter"
                  : widget.phase === "exiting"
                    ? "widget-exit"
                    : ""
              }`}
              style={
                widget.phase === "entering" && widget.enterIndex !== undefined
                  ? { animationDelay: `${widget.enterIndex * 80}ms` }
                  : undefined
              }
            >
              <WidgetRenderer widget={widget} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
