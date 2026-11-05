"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { PageIntro } from "@/components/shell/page-intro";
import { isCourseField } from "@/lib/courses";
import { formatWat } from "@/lib/time";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { DataStatus, useAdminData } from "./use-admin-data";

interface NotAppliedData {
  students: { id: string; name: string; country: string; courseFields: string[]; onboardedAt: string; whatsapp: string }[];
  total: number;
}

/**
 * PRD_4 F27 (architecture 23.6): students who finished onboarding and have not applied. A list for a friendly nudge: a first name and initial,
 * the country, the courses they chose, when they finished (WAT) and a one-tap WhatsApp link built by the one helper with a translated message.
 * It is not part of Leads: a profile is not a lead, so it has no reference, no response clock and no stage.
 */
export function NotAppliedPanel() {
  const t = useTranslations("admin.notApplied");
  const courses = useTranslations("courses");
  const { state, reload } = useAdminData<NotAppliedData>("/api/v1/admin/not-applied");
  const countryNames = useMemo(() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      return null;
    }
  }, []);

  return (
    <section>
      <PageIntro title={t("title")} purpose={t("purpose")} />
      <DataStatus state={state} reload={reload} />
      {state.status === "ready" ? (
        state.data.students.length === 0 ? (
          <p className="text-fg-muted" data-testid="not-applied-empty">
            {t("empty")}
          </p>
        ) : (
          <>
            <p className="text-fg-muted" data-testid="not-applied-count">
              {state.data.total > state.data.students.length ? t("showing", { shown: state.data.students.length, total: state.data.total }) : t("count", { count: state.data.total })}
            </p>
            <ul className="mt-3 space-y-3" data-testid="not-applied-list">
              {state.data.students.map((student) => {
                const fields = student.courseFields.filter(isCourseField).map((field) => courses(field)).join(", ");
                const chat = buildWhatsAppUrl(student.whatsapp, t("message", { name: student.name.split(" ")[0] ?? "" }));
                return (
                  <li key={student.id} className="rounded-lg border border-border p-4" data-testid="not-applied-item">
                    <p className="font-semibold">{student.name || t("unknownStudent")}</p>
                    <p className="text-fg-muted">
                      {countryNames?.of(student.country) ?? student.country} · {fields || t("noCourses")}
                    </p>
                    <p className="text-sm text-fg-muted">{t("finished", { when: formatWat(new Date(student.onboardedAt)) })}</p>
                    {chat ? (
                      <p className="mt-2">
                        <a className="font-semibold text-accent underline" href={chat} target="_blank" rel="noopener noreferrer">
                          {t("chat")}
                        </a>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}
