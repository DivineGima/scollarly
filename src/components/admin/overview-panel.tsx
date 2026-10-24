"use client";

import { useTranslations } from "next-intl";
import { useAdminSession } from "./admin-shell";

/** B1 lands here. The real Overview (counts, overdue) is Stage 5 (S5.3); until then it greets the person and says what is coming. */
export function OverviewPanel() {
  const t = useTranslations("admin.overview");
  const session = useAdminSession();
  return (
    <section>
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-4">{t("welcome", { name: session.name || session.email })}</p>
      <p className="mt-2 text-fg-muted">{t("soon")}</p>
    </section>
  );
}
