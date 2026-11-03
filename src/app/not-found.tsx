import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium">This page does not exist.</p>
      <Link href="/" className="text-sm underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
