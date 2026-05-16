// /home/tcxcx/coding_projects/Foresta/foresta-landing/src/components/locale-switcher/index.tsx
"use client";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import React, { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LocaleSwitcher() {
  const router = useRouter();
  const locale = useLocale();
  const [selectedLocale, setSelectedLocale] = useState(locale);

  const handleLocaleChange = (value: string) => {
    setSelectedLocale(value);
    router.replace(`/${value}`);
  };

  return (
    <Select onValueChange={handleLocaleChange} value={selectedLocale}>
      <SelectTrigger className="w-fit bg-white dark:bg-foreground shadow-xl rounded-md text-purpleDanis font-bold">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-white dark:bg-foreground shadow-xl rounded-md text-purpleDanis [&_[data-radix-select-viewport]]:text-purpleDanis">
        <SelectItem value="en" className="text-purpleDanis focus:text-purpleDanis">English</SelectItem>
        <SelectItem value="es" className="text-purpleDanis focus:text-purpleDanis">Español</SelectItem>
        <SelectItem value="pt" className="text-purpleDanis focus:text-purpleDanis">Português</SelectItem>
      </SelectContent>
    </Select>
  );
}
