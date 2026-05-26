"use client";

import { useEffect } from "react";
import { useI18n } from "@/locales/client";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useI18n();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-[60vh] place-content-center px-4">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Error
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t('Errors.somethingWentWrong')}
        </h1>
        <p className="mt-4 max-w-md text-lg text-muted-foreground">
          {t('Errors.unexpectedError')}
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
          {t('Errors.tryAgain')}
        </button>
      </div>
    </main>
  );
}
