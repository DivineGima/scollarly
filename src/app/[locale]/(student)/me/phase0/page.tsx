import { getTranslations, setRequestLocale } from "next-intl/server";
import { StubValue } from "@/components/shell/stub-value";

// S0.4 stub student screen (ADR-040): the same shell-plus-data pattern as staff. The Worker entry checks the session before it
// serves this page and the value comes from /api/v1/me/phase0.

export default async function MePhase0Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("phase0");
  return (
    <main>
      <h1>{t("meHeading")}</h1>
      <StubValue url="/api/v1/me/phase0" field="role" label={t("role")} testId="role" />
    </main>
  );
}
