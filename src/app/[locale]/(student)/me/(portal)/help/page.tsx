import { getTranslations, setRequestLocale } from "next-intl/server";
import { StudentHelp } from "@/components/student/student-help";
import { readSite } from "@/modules/content/read";

// S13.4: the Help tab. No data call: the guides are public pages and the WhatsApp number is the public one from the site settings.
export default async function MeHelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, site] = await Promise.all([getTranslations("student.help"), readSite()]);
  return (
    <StudentHelp
      whatsappE164={site.contact.whatsappE164}
      labels={{
        title: t("title"),
        intro: t("intro"),
        guides: t("guides"),
        process: t("process"),
        visa: t("visa"),
        faq: t("faq"),
        contact: t("contact"),
        whatsapp: t("whatsapp"),
        whatsappText: t("whatsappText"),
        whatsappMissing: t("whatsappMissing"),
      }}
    />
  );
}
