import { getTranslations } from "next-intl/server";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile-site-key";
import { readCatalogue, readSite } from "@/modules/content/read";
import { getLeadLabels } from "./lead/get-labels";
import { QuickWhatsApp } from "./lead/quick-whatsapp";
import { OfflineRuntime } from "./offline-runtime";

/**
 * The two client islands every public page carries (architecture 6.3): the offline and sync runtime, and the quick WhatsApp
 * form that every "Chat on WhatsApp" button opens. Everything else on a public page is server-rendered HTML.
 */
export async function ClientShell({ locale }: { locale: string }) {
  const [{ contact }, { universities }, labels, t] = await Promise.all([readSite(), readCatalogue(), getLeadLabels(locale), getTranslations({ locale, namespace: "pwa" })]);
  return (
    <>
      <OfflineRuntime
        siteKey={TURNSTILE_SITE_KEY}
        labels={{
          offline: t("offline"),
          queued: t("queued", { count: "{count}" }),
          installPrompt: t("installPrompt"),
          install: t("install"),
          dismiss: t("dismiss"),
          turnstilePrompt: labels.turnstilePrompt,
        }}
      />
      <QuickWhatsApp
        labels={labels}
        universities={universities.map((u) => ({ id: u.id, name: u.name }))}
        numberE164={contact.whatsappE164}
        siteKey={TURNSTILE_SITE_KEY}
        locale={locale}
      />
    </>
  );
}
