"use client";

import { brand } from "@/content/brand";
import { headerLabels } from "@/content/ui-text";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border px-8">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>

      <div
        role="img"
        aria-label={headerLabels.userAvatar}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
      >
        {brand.userInitials}
      </div>
    </header>
  );
}
