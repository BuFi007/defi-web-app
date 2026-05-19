"use client";

import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@bufi/location/supported-locales";
import localeFlags from "@bufi/location/locale-flags";
import { useTransition } from "react";
import { useChangeLocale, useCurrentLocale } from "@/locales/client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const isSupported = (value: string): value is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

export default function LocaleSwitcher() {
  const current = useCurrentLocale();
  const changeLocale = useChangeLocale();
  const [isPending, startTransition] = useTransition();

  const value: SupportedLocale = isSupported(current) ? current : "en";

  const handleLocaleChange = (next: string) => {
    if (!isSupported(next) || next === value) return;
    // Just call changeLocale. It dynamically imports the locale
    // bundle, then does router.push(`/${next}${pathWithoutLocale}`) +
    // refresh(). Our `proxy.ts` then redirects `/${next}/...` to the
    // clean path and writes the `Next-Locale` cookie (the actual
    // name next-international's middleware reads — see
    // node_modules/next-international/dist/app/middleware/index.js
    // `LOCALE_COOKIE = "Next-Locale"`). Server components re-render
    // on the route swap.
    //
    // The previous implementation wrote `NEXT_LOCALE` (uppercase,
    // underscore) which the middleware NEVER reads, then forced
    // `window.location.reload()` which raced changeLocale's async
    // import + push and reloaded the OLD URL with the OLD cookie.
    // Net effect: clicks did nothing.
    startTransition(() => {
      changeLocale(next);
    });
  };

  return (
    <Select
      onValueChange={handleLocaleChange}
      value={value}
      disabled={isPending}
    >
      <SelectTrigger
        className="w-fit bg-white dark:bg-[#1B142D] shadow-xl rounded-md text-purpleDanis dark:text-[#E2D0FD] font-bold gap-2 border-purpleDanis/15 dark:border-white/10"
        aria-label="Change language"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-white dark:bg-[#1B142D] shadow-xl border-none rounded-md text-purpleDanis dark:text-[#E2D0FD] [&_[data-radix-select-viewport]]:text-purpleDanis dark:[&_[data-radix-select-viewport]]:text-[#E2D0FD]">
        {SUPPORTED_LOCALES.map((code) => {
          const { emoji, nativeName } = localeFlags[code];
          return (
            <SelectItem
              key={code}
              value={code}
              className="text-purpleDanis focus:text-purpleDanis dark:text-[#E2D0FD] dark:focus:text-[#E2D0FD]"
            >
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="text-base leading-none">
                  {emoji}
                </span>
                <span>{nativeName}</span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
