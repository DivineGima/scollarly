import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale } from "./config";

// No locale middleware (ADR-018): the locale comes from the `[locale]` route segment, and unprefixed paths are rewritten to `/en`.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
