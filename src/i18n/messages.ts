import type { Locale } from "./config";

/**
 * Message catalogues are split by top-level namespace (architecture 6.4). A server component reads them through
 * `getTranslations("namespace")` and sends nothing to the browser. A client island gets a provider that holds only
 * the namespaces it uses, so a route never ships another route's strings:
 *
 *   <NextIntlClientProvider locale={locale} messages={await clientMessages(locale, ["apply"])}>
 */

export type Messages = Record<string, unknown>;

/** Only the listed namespaces. An unknown namespace is a bug (a typo would silently ship nothing), so it throws. */
export function pickNamespaces(messages: Messages, namespaces: readonly string[]): Messages {
  const picked: Messages = {};
  for (const namespace of namespaces) {
    if (!Object.hasOwn(messages, namespace)) throw new Error(`Unknown message namespace "${namespace}"`);
    picked[namespace] = messages[namespace];
  }
  return picked;
}

/** The namespaces a client island needs, for `NextIntlClientProvider`. */
export async function clientMessages(locale: Locale, namespaces: readonly string[]): Promise<Messages> {
  const all = (await import(`../../messages/${locale}.json`)).default as Messages;
  return pickNamespaces(all, namespaces);
}
