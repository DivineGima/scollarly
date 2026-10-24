import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/** `<title>` and description for a page from its message namespace (`metaTitle`, `metaDescription`). */
export async function pageMetadata(locale: string, namespace: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace });
  return { title: t("metaTitle"), description: t("metaDescription") };
}
