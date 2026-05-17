import countryFlags, { type CountryCode } from "./country-flags";
import type { SupportedLocale } from "./supported-locales";

/**
 * Maps each UI locale to a representative country flag and its native name.
 * Choices favour the largest native-speaker market for the language:
 *   - en → 🇬🇧 (neutral international English)
 *   - es → 🇪🇸
 *   - pt → 🇧🇷 (Brazilian Portuguese is the larger market)
 *   - ja → 🇯🇵
 *   - ko → 🇰🇷
 */
export type LocaleFlag = {
  locale: SupportedLocale;
  country: CountryCode;
  emoji: string;
  /** Endonym — the language's name written in itself. */
  nativeName: string;
};

const localeFlags: Record<SupportedLocale, LocaleFlag> = {
  en: {
    locale: "en",
    country: "GB",
    emoji: countryFlags.GB.emoji,
    nativeName: "English",
  },
  es: {
    locale: "es",
    country: "ES",
    emoji: countryFlags.ES.emoji,
    nativeName: "Español",
  },
  pt: {
    locale: "pt",
    country: "BR",
    emoji: countryFlags.BR.emoji,
    nativeName: "Português",
  },
  ja: {
    locale: "ja",
    country: "JP",
    emoji: countryFlags.JP.emoji,
    nativeName: "日本語",
  },
  ko: {
    locale: "ko",
    country: "KR",
    emoji: countryFlags.KR.emoji,
    nativeName: "한국어",
  },
};

export function getLocaleFlag(locale: SupportedLocale): LocaleFlag {
  return localeFlags[locale];
}

export default localeFlags;
