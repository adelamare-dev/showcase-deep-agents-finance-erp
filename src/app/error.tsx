"use client";

import Link from "next/link";

export default function RouteError({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium">Something went wrong on this page.</p>
      <div className="flex gap-4 text-sm">
        <button type="button" className="underline" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="underline">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
