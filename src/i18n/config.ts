/** English is the only active locale in v1 (ADR-018). French is added in a later version by adding "fr" here and filling messages/fr.json. */
export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
