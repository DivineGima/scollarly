import { getTranslations, setRequestLocale } from "next-intl/server";
import { StubValue } from "@/components/shell/stub-value";

// S0.4 stub staff screen (ADR-040): a prerendered shell with no data and no session logic in it. The Worker entry checks the
// session before it serves this page (src/server/edge/authed.ts) and the number comes from /api/v1/admin/phase0.

export default async function AdminPhase0Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("phase0");
  return (
    <main>
      <h1>{t("adminHeading")}</h1>
      <StubValue url="/api/v1/admin/phase0" field="leadCount" label={t("leadCount")} testId="lead-count" />
    </main>
  );
}
