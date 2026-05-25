"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-gradient-to-br from-indigo-100 via-violet-200 to-cyan-300 dark:from-gray-900 dark:via-indigo-400 dark:to-gray-800 min-h-screen">
        <main className="grid min-h-screen place-content-center px-4">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              500
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
              Something went wrong
            </h1>
            <p className="mt-4 max-w-md text-lg text-muted-foreground">
              An unexpected error occurred. Try again, or reload the page.
            </p>
            {error.digest ? (
              <p className="mt-2 text-xs text-muted-foreground/70 font-mono">
                ref: {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-8 inline-flex h-10 items-center justify-center rounded-md border border-yellow-200 px-8 text-sm font-medium transition-colors hover:bg-yellow-300 hover:text-black focus:outline-none focus:ring"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
