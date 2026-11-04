"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isCourseField } from "@/lib/courses";
import { safeNext } from "@/modules/gate/next";

/**
 * The two ways to create an account: as a student or as a parent (architecture 21.3, F14). Each is a plain link to `/auth/start`
 * with the intent, so the page works with no script. A course chosen on the landing page (`/sign-up?course=law`) is added to the
 * links after load, so it reaches the study-plan step; an unknown value is dropped. The same goes for `next`, the page the person tapped an action on (PRD_3 F20).
 */
export function SignUpChoices() {
  const t = useTranslations("auth.signUp");
  const [course, setCourse] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("course");
    setCourse(isCourseField(value) ? value : null);
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const href = (as: "student" | "parent") => `/auth/start?intent=sign-up&as=${as}${course ? `&course=${course}` : ""}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="auth-choices" role="group" aria-label={t("choose")}>
      <p className="auth-choices-label">{t("choose")}</p>
      {/* Full navigations to a Worker route, not pages: <Link> would prefetch them. */}
      <a className="auth-button" href={href("student")}>
        {t("student")}
        <span className="auth-button-sub">{t("google")}</span>
      </a>
      <a className="auth-button" href={href("parent")}>
        {t("parent")}
        <span className="auth-button-sub">{t("google")}</span>
      </a>
    </div>
  );
}
