import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";

const locales = ["en", "es", "pt"];

export default getRequestConfig(async ({ locale, requestLocale }) => {
  const resolvedLocale = locale ?? (await requestLocale);

  // Validate that the incoming `locale` parameter is valid
  if (!resolvedLocale || !locales.includes(resolvedLocale)) notFound();

  return {
    locale: resolvedLocale,
    messages: (await import(`../messages/${resolvedLocale}.json`)).default,
  };
});
