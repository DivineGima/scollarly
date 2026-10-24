/**
 * Translatable text (architecture 6.4, ADR-008): a JSON object keyed by locale, `en` required, for example
 * `{ "en": "Fees", "fr": "Frais" }`. English is the only active locale in v1; French is added by filling `fr`.
 *
 * The database only guarantees the value is a JSON object. That `en` is present is checked by `translationsSchema`
 * (`src/lib/schemas/common.ts`) in the services that write content, because a draft may be saved before its text exists.
 */
export type Translations = Record<string, string>;

/** The text for `locale`, falling back to English, then to `fallback`. */
export function pickTranslation(translations: Translations | null | undefined, locale: string, fallback = ""): string {
  if (!translations) return fallback;
  return translations[locale] || translations.en || fallback;
}
