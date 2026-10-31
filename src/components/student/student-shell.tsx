"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AppNav } from "@/components/shell/app-nav";
import { navLabels } from "@/components/shell/nav-labels";
import { normalisePath } from "@/modules/nav/config";

/**
 * The frame of the student app (S8.1, S13.4; architecture 21.10): a small header, the offline notice, the page, and the floating bar
 * with the round More button (ADR-041). Plain CSS on the site's tokens, no admin library, so the app stays light on a limited data
 * plan. The page around it is the same HTML for everyone; who is signed in and what is shown come from the data calls after it loads.
 * The questionnaire hides the bar: a new person has one thing to do.
 */
export function StudentShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("me");
  const shell = useTranslations("shell");
  const [path, setPath] = useState("");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setPath(normalisePath(window.location.pathname));
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const showBar = !path.startsWith("/me/onboarding");

  return (
    <div className="me-shell">
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <header className="me-header">
        <strong>Scollarly</strong>
      </header>
      {online ? null : (
        <p role="status" className="me-offline">
          {t("offline")}
        </p>
      )}
      <main id="main" className="me-main">
        {children}
      </main>
      {showBar ? <AppNav role="student" labels={navLabels(shell as never, "student")} /> : null}
    </div>
  );
}
