"use client";

// Replaces the root layout when it fails, so it brings its own html and body.
// The link is a plain anchor on purpose: the router may be what broke, and a
// full page load starts from a clean state.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", textAlign: "center", paddingTop: "30vh" }}>
        <p>The application could not start.</p>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>{" "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">Back to the dashboard</a>
      </body>
    </html>
  );
}
