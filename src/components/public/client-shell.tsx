import { getTranslations } from "next-intl/server";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile-site-key";
import { getLeadLabels } from "./lead/get-labels";
import { OfflineRuntime } from "./offline-runtime";

/**
 * The client island every public page carries (architecture 6.3): the offline and sync runtime. Everything else on a public page is
 * server-rendered HTML. The sign-in pop-up and the quick WhatsApp form that used to sit here are gone: applying and chatting happen inside
 * the account (PRD_4 F24, F26; architecture 23.5), and a public page offers one link, "Create an account".
 */
export async function ClientShell({ locale }: { locale: string }) {
  const [labels, t] = await Promise.all([getLeadLabels(locale), getTranslations({ locale, namespace: "pwa" })]);
  return (
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
  );
}
