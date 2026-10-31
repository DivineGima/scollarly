"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { isCourseField, type CourseField } from "@/lib/courses";
import type { ProfileRelationship } from "@/lib/constants";
import { api } from "@/lib/client/api";

type Problem = "offline" | "failed" | "signedOut" | null;

/**
 * "No account found. Create one?" (architecture 21.3, A2.1 step 5). A person who tapped Sign in with a Google login that has no
 * Scollarly account lands here. Nothing is created until they choose; Back signs them out. The page is the same for everyone: who is
 * signed in is checked by the Worker before it is served, and the one change is the plain POST below.
 */
export function ConfirmAccount() {
  const t = useTranslations("auth.confirm");
  const [busy, setBusy] = useState<ProfileRelationship | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [course, setCourse] = useState<CourseField | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("course");
    setCourse(isCourseField(value) ? value : null);
  }, []);

  async function create(as: ProfileRelationship) {
    setBusy(as);
    setProblem(null);
    const result = await api<{ next: string }>("POST", "/api/v1/account/confirm", { as, ...(course ? { course } : {}) });
    if (result.ok) {
      window.location.assign(result.data.next);
      return;
    }
    setBusy(null);
    if (result.status === 401) setProblem("signedOut");
    else setProblem(result.code === "NETWORK" ? "offline" : "failed");
  }

  return (
    <>
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      <p className="auth-choices-label">{t("question")}</p>
      <div className="auth-choices">
        <button type="button" className="auth-button" disabled={busy !== null} onClick={() => void create("student")}>
          {busy === "student" ? t("working") : t("student")}
        </button>
        <button type="button" className="auth-button" disabled={busy !== null} onClick={() => void create("parent")}>
          {busy === "parent" ? t("working") : t("parent")}
        </button>
      </div>
      {problem ? (
        <p role="alert" className="auth-notice">
          {problem === "offline" ? t("errorOffline") : problem === "signedOut" ? t("errorSignedOut") : t("errorFailed")}
        </p>
      ) : null}
      {/* A full navigation: the sign-out page ends the session. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a className="auth-secondary" href="/sign-out">
        {t("back")}
      </a>
    </>
  );
}
