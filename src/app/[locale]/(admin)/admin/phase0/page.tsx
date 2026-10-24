import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadAdminStub } from "@/modules/phase0/auth-stubs";
import { AuthError, requireRole } from "@/server/auth";

// S0.4 stub admin page: the one-query session check (ADR-034), one Neon query under row level security, render. Online-only, never cached.
export const dynamic = "force-dynamic";

export default async function AdminPhase0Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  let actor;
  try {
    actor = await requireRole(await headers(), "admin");
  } catch (error) {
    if (error instanceof AuthError) notFound(); // hide the page from anyone without access
    throw error;
  }
  const [t, { leadCount }] = await Promise.all([getTranslations("phase0"), loadAdminStub(actor)]);
  return (
    <main>
      <h1>{t("adminHeading")}</h1>
      <p data-testid="lead-count">
        {t("leadCount")}: {leadCount}
      </p>
    </main>
  );
}
