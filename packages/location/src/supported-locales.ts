/**
 * UI translation locales supported by the web app.
 * Keep this list in sync with apps/web/i18n/request.ts and apps/web/proxy.ts.
 */
export const SUPPORTED_LOCALES = ["en", "es", "pt", "ja", "ko", "zh"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isLocaleSupported(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale.toLowerCase());
}

/**
 * Resolve a raw locale (e.g., "en-US", "es-419") down to a supported one,
 * falling back to DEFAULT_LOCALE.
 */
export function getSupportedLocale(rawLocale: string | null | undefined): SupportedLocale {
  if (!rawLocale) return DEFAULT_LOCALE;
  const base = rawLocale.split("-")[0]?.toLowerCase();
  if (!base) return DEFAULT_LOCALE;
  return isLocaleSupported(base) ? base : DEFAULT_LOCALE;
}
