"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isCourseField } from "@/lib/courses";

/**
 * The two ways to create an account: as a student or as a parent (architecture 21.3, F14). Each is a plain link to `/auth/start`
 * with the intent, so the page works with no script. A course chosen on the landing page (`/sign-up?course=law`) is added to the
 * links after load, so it reaches the study-plan step; an unknown value is dropped.
 */
export function SignUpChoices() {
  const t = useTranslations("auth.signUp");
  const [course, setCourse] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("course");
    setCourse(isCourseField(value) ? value : null);
  }, []);

  const href = (as: "student" | "parent") => `/auth/start?intent=sign-up&as=${as}${course ? `&course=${course}` : ""}`;

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
