"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UseAgentUpdate, useAgent } from "@copilotkit/react-core/v2";
import {
  LayoutDashboard,
  LayoutGrid,
  FileText,
  Landmark,
  Package,
  Users,
  Settings,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useErp } from "@/context/erp-context";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Dashboards", href: "/dashboards", icon: LayoutGrid },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Accounts", href: "/accounts", icon: Landmark },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "HR", href: "/hr", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-[72px] flex-col items-center border-r border-border bg-card py-4">
      <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
        <Bot className="h-5 w-5 text-primary-foreground" />
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {item.name}
              </span>
              {isActive && (
                <span className="absolute -left-[18px] h-5 w-1 rounded-r-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      <SettingsMenu />
    </aside>
  );
}

// The one entry puts the demo back to its starting point. It stays disabled
// while the agent is running: a reset in the middle of a run would let the
// run write to books that were just restored.
function SettingsMenu() {
  const { resetDemo } = useErp();
  const { agent } = useAgent({
    agentId: "finance_erp_agent",
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      } else if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const reset = async () => {
    setResetting(true);
    setError(null);
    try {
      await resetDemo();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The demo could not be reset.");
    } finally {
      setResetting(false);
    }
  };

  const busy = agent.isRunning || resetting;

  return (
    <div ref={root} className="relative mt-auto">
      <button
        type="button"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) setError(null);
          setOpen((v) => !v);
        }}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Settings className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Settings"
          className="absolute bottom-0 left-full ml-3 w-56 rounded-xl border border-border bg-card p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            aria-label="Reset demo data"
            disabled={busy}
            onClick={reset}
            className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
          >
            Reset demo data
          </button>
          {agent.isRunning && (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              Available when the assistant has finished.
            </p>
          )}
          {error && (
            <p role="alert" className="px-3 pb-2 text-xs text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
