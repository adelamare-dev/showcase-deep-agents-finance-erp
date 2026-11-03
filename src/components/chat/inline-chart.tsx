"use client";

import { ToolCallStatus } from "@copilotkit/react-core/v2";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useDataset } from "@/hooks/use-dataset";
import type { ChartDataset, DatasetParams } from "@/lib/erp-api";

type Props = {
  args: {
    dataset?: string;
    quarters?: number;
    growth_pct?: number;
    metric?: DatasetParams["metric"];
    chartType?: string;
  };
  status: string;
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border bg-card p-4 duration-300 ease-out">
      {children}
    </div>
  );
}

export function InlineChatChart({ args, status }: Props) {
  const { dataset, quarters, growth_pct, metric } = args;
  const { data: chart, error, loading } = useDataset<ChartDataset>(
    dataset,
    { quarters, growth_pct, metric },
    status === ToolCallStatus.Complete,
  );

  if (error) {
    return (
      <Frame>
        <p className="text-sm text-destructive">Could not draw this chart.</p>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
      </Frame>
    );
  }

  if (loading || !chart) {
    return (
      <Frame>
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-[180px] animate-pulse rounded bg-muted" />
      </Frame>
    );
  }

  const { title, data, series } = chart;
  const type = args.chartType ?? chart.chartType;

  const chartData = data.map((d) => ({ name: d.label, ...d }));

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 10, left: -10, bottom: 5 },
    };

    switch (type) {
      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                name={s.label}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                name={s.label}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        );
      default:
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.15}
                name={s.label}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        );
    }
  };

  return (
    <Frame>
      <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        {renderChart()}
      </ResponsiveContainer>
    </Frame>
  );
}
