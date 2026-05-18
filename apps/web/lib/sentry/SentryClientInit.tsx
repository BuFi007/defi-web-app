"use client";

import { useEffect } from "react";

import { initWebSentryClient } from "./client";

/**
 * Mounts once at the root layout to fire Sentry's browser init. No-ops when
 * the DSN is missing or `@sentry/nextjs` isn't installed — keeps dev clean.
 */
export function SentryClientInit(): null {
  useEffect(() => {
    void initWebSentryClient();
  }, []);
  return null;
}
