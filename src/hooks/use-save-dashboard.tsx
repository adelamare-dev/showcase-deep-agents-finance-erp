"use client";

import { useEffect, useState } from "react";
import { useRenderTool, ToolCallStatus } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { useDashboard } from "@/context/dashboard-context";
import { CompletedToolCard } from "@/components/chat/tool-card";
import { claimToolCall } from "@/lib/handled-tool-calls";


function SaveHandler({
  name,
  status,
  result,
}: {
  name: string;
  status: string;
  result?: unknown;
}) {
  const { saveCurrent } = useDashboard();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== ToolCallStatus.Complete) return;
    const key = `save-${name}`;
    if (!claimToolCall(key)) return;
    queueMicrotask(() => {
      saveCurrent(name).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "The dashboard was not saved.");
      });
    });
  }, [status, name, saveCurrent]);

  if (error) {
    return (
      <p role="alert" className="py-1 text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="save_dashboard"
        args={{ name }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Saving dashboard...
    </p>
  );
}

function LoadHandler({
  name,
  status,
  result,
}: {
  name: string;
  status: string;
  result?: unknown;
}) {
  const { loadSavedByName } = useDashboard();

  useEffect(() => {
    if (status !== ToolCallStatus.Complete) return;
    const key = `load-${name}`;
    if (!claimToolCall(key)) return;
    queueMicrotask(() => {
      loadSavedByName(name);
    });
  }, [status, name, loadSavedByName]);

  if (status === ToolCallStatus.Complete) {
    return (
      <CompletedToolCard
        name="load_dashboard"
        args={{ name }}
        result={result}
      />
    );
  }
  return (
    <p className="text-sm text-muted-foreground animate-pulse py-1">
      Loading dashboard...
    </p>
  );
}

export function useSaveDashboard() {
  useRenderTool(
    {
      name: "save_dashboard",
      parameters: z.object({ name: z.string().optional() }),
      render: ({ parameters, status, result }) => (
        <SaveHandler
          name={parameters?.name ?? ""} status={status} result={result} />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "load_dashboard",
      parameters: z.object({ name: z.string().optional() }),
      render: ({ parameters, status, result }) => (
        <LoadHandler
          name={parameters?.name ?? ""} status={status} result={result} />
      ),
    },
    [],
  );
}
