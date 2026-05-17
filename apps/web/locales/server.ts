import { createI18nServer } from "next-international/server";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@bufi/location/supported-locales";

// `next/root-params` ships with an empty .d.ts — the compiler substitutes
// the real implementation per-app at build time based on the `[locale]`
// dynamic segment. Declare the shape we use so tsc stays happy.
declare module "next/root-params" {
  export function locale(): Promise<string | undefined>;
}

import { locale as rootLocale } from "next/root-params";

const LOCALE_LOADERS = {
  en: () => import("../messages/en.json"),
  es: () => import("../messages/es.json"),
  pt: () => import("../messages/pt.json"),
  ja: () => import("../messages/ja.json"),
  ko: () => import("../messages/ko.json"),
} as const;

const i18n = createI18nServer(LOCALE_LOADERS);

export const { getStaticParams } = i18n;

function resolvePath(
  messages: unknown,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let cursor: unknown = messages;
  for (const part of parts) {
    if (
      cursor &&
      typeof cursor === "object" &&
      part in (cursor as Record<string, unknown>)
    ) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    String(params[key] ?? `{${key}}`),
  );
}

async function loadMessages(locale: SupportedLocale): Promise<Record<string, unknown>> {
  const mod = await LOCALE_LOADERS[locale]();
  return (mod as { default: Record<string, unknown> }).default;
}

async function resolveLocaleFromRootParams(): Promise<SupportedLocale> {
  const raw = await rootLocale();
  if (raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

/**
 * `'use cache'`-safe i18n getter. Tries next-international's request-aware
 * version first (which reads cookies / headers). Inside a cached function the
 * request APIs throw — we catch and resolve via `next/root-params` instead,
 * which IS cache-compatible because it's the dynamic route segment.
 */
export async function getI18n(): Promise<
  (key: string, params?: Record<string, unknown>) => string
> {
  try {
    const t = await i18n.getI18n();
    return t as (key: string, params?: Record<string, unknown>) => string;
  } catch {
    const locale = await resolveLocaleFromRootParams();
    const messages = await loadMessages(locale);
    return (key, params) => {
      const raw = resolvePath(messages, key);
      if (!raw) return key;
      return interpolate(raw, params);
    };
  }
}

export async function getScopedI18n<S extends string>(scope: S) {
  try {
    const t = await i18n.getScopedI18n(scope as never);
    return t as unknown as (
      key: string,
      params?: Record<string, unknown>,
    ) => string;
  } catch {
    const locale = await resolveLocaleFromRootParams();
    const messages = await loadMessages(locale);
    return (key: string, params?: Record<string, unknown>) => {
      const fullKey = `${scope}.${key}`;
      const raw = resolvePath(messages, fullKey);
      if (!raw) return fullKey;
      return interpolate(raw, params);
    };
  }
}

export async function getCurrentLocale(): Promise<SupportedLocale> {
  try {
    return (await i18n.getCurrentLocale()) as SupportedLocale;
  } catch {
    return resolveLocaleFromRootParams();
  }
}
