import type { Translations } from "@/lib/translations";

/**
 * Reading translated text (architecture 6.4 as amended by decision D19).
 *
 * A row keeps its English text in plain columns. `translations` holds the other locales, one object per locale with the
 * fields it translates, for example `{ "fr": { "question": "...", "answer": "..." } }`. Two older shapes also exist and
 * are read the same way: the whole text as a string per locale (`{ "en": "Overview..." }`, used by `content_block` and by a
 * university's overview), which is the shape of the seed files. English is the only active locale in v1, so the fallback
 * chain is: the locale's own text, then English, then the plain column.
 */

type Entry = string | Record<string, string> | undefined;

function entryOf(translations: Translations | Record<string, unknown> | null | undefined, locale: string): Entry {
  const entry = translations?.[locale];
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") return entry as Record<string, string>;
  return undefined;
}

/** One field of a row, in the visitor's locale when it exists, else the plain (English) column value. */
export function localisedField(
  translations: Translations | Record<string, unknown> | null | undefined,
  locale: string,
  field: string,
  plain: string,
): string {
  if (locale !== "en") {
    const entry = entryOf(translations, locale);
    const value = entry && typeof entry === "object" ? entry[field] : undefined;
    if (typeof value === "string" && value.trim()) return value;
  }
  return plain;
}

/** The whole-text shape: `translations[locale]` as a string, falling back to English, then to `fallback`. */
export function localisedText(translations: Translations | Record<string, unknown> | null | undefined, locale: string, fallback = ""): string {
  const own = entryOf(translations, locale);
  if (typeof own === "string" && own.trim()) return own;
  const english = entryOf(translations, "en");
  return typeof english === "string" && english.trim() ? english : fallback;
}
