/**
 * Country flag emoji map. Ported (trimmed) from desk-v1's @bu/location.
 * Add new entries here as more locales / payment regions are supported.
 */
export type CountryFlag = {
  code: string;
  unicode: string;
  name: string;
  emoji: string;
};

const countryFlags = {
  AR: {
    code: "AR",
    unicode: "U+1F1E6 U+1F1F7",
    name: "Argentina",
    emoji: "🇦🇷",
  },
  BR: {
    code: "BR",
    unicode: "U+1F1E7 U+1F1F7",
    name: "Brazil",
    emoji: "🇧🇷",
  },
  ES: {
    code: "ES",
    unicode: "U+1F1EA U+1F1F8",
    name: "Spain",
    emoji: "🇪🇸",
  },
  GB: {
    code: "GB",
    unicode: "U+1F1EC U+1F1E7",
    name: "United Kingdom",
    emoji: "🇬🇧",
  },
  JP: {
    code: "JP",
    unicode: "U+1F1EF U+1F1F5",
    name: "Japan",
    emoji: "🇯🇵",
  },
  KR: {
    code: "KR",
    unicode: "U+1F1F0 U+1F1F7",
    name: "South Korea",
    emoji: "🇰🇷",
  },
  PT: {
    code: "PT",
    unicode: "U+1F1F5 U+1F1F9",
    name: "Portugal",
    emoji: "🇵🇹",
  },
  US: {
    code: "US",
    unicode: "U+1F1FA U+1F1F8",
    name: "United States",
    emoji: "🇺🇸",
  },
} as const satisfies Record<string, CountryFlag>;

export type CountryCode = keyof typeof countryFlags;

export default countryFlags;
