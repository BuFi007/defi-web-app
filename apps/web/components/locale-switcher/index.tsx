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
    if (!isSupported(next)) return;
    startTransition(() => {
      // next-international handles cookie + revalidation. The middleware
      // keeps the URL clean — no /<locale> prefix appears.
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
        className="w-fit bg-white dark:bg-foreground shadow-xl rounded-md text-purpleDanis font-bold gap-2"
        aria-label="Change language"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-white dark:bg-foreground shadow-xl border-none rounded-md text-purpleDanis [&_[data-radix-select-viewport]]:text-purpleDanis">
        {SUPPORTED_LOCALES.map((code) => {
          const { emoji, nativeName } = localeFlags[code];
          return (
            <SelectItem
              key={code}
              value={code}
              className="text-purpleDanis focus:text-purpleDanis"
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
