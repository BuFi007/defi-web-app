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
    startTransition(() => {
      // Belt-and-suspenders cookie write. next-international's
      // changeLocale() also writes the cookie but went silent against
      // a previous httpOnly middleware setting (browsers refuse to
      // overwrite an httpOnly cookie from JS). Writing here makes the
      // switch resilient to that legacy state.
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${oneYear}; sameSite=lax`;
      changeLocale(next);

      // Hard reload. Under Next 16 + Cache Components a plain
      // router.refresh() doesn't re-render translated strings —
      // they're baked into the prerendered HTML. A full document load
      // is the only reliable way to flip the entire page to the new
      // locale, including server components that read messages at
      // render time.
      if (typeof window !== "undefined") window.location.reload();
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
