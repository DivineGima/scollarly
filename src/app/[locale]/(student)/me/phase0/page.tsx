import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { loadStudentStub } from "@/modules/phase0/auth-stubs";
import { AuthError, requireRole } from "@/server/auth";

// S0.4 stub student page: the same one-query session check as staff (ADR-034, ADR-020), one Neon query under row level security, render.
export const dynamic = "force-dynamic";

export default async function MePhase0Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  let actor;
  try {
    actor = await requireRole(await headers(), "student");
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
  const [t, { role }] = await Promise.all([getTranslations("phase0"), loadStudentStub(actor)]);
  return (
    <main>
      <h1>{t("meHeading")}</h1>
      <p data-testid="role">
        {t("role")}: {role}
      </p>
    </main>
  );
}
