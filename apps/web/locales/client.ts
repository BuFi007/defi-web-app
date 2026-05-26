"use client";

import { createI18nClient } from "next-international/client";

const LOCALE_LOADERS = {
  en: () => import("../messages/en.json"),
  es: () => import("../messages/es.json"),
  pt: () => import("../messages/pt.json"),
  ja: () => import("../messages/ja.json"),
  ko: () => import("../messages/ko.json"),
  zh: () => import("../messages/zh.json"),
} as const;

export const {
  useI18n,
  useScopedI18n,
  I18nProviderClient,
  useCurrentLocale,
  useChangeLocale,
} = createI18nClient(LOCALE_LOADERS);
