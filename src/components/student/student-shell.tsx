"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- every signed-in screen is a cached shell plus a data call, so moving between screens is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface NavItem {
  href: string;
  label: "progress" | "link" | "profile" | "data";
}

const NAV: readonly NavItem[] = [
  { href: "/me", label: "progress" },
  { href: "/me/link-application", label: "link" },
  { href: "/me/profile", label: "profile" },
  { href: "/me/data", label: "data" },
];

const LOCALE_PREFIX = /^\/en(?=\/)/;

/**
 * The frame of the student portal (S8.1): a small menu, the offline notice, and the page. Plain CSS on the site's tokens, no admin
 * library, so the portal stays light on a limited data plan. The page around it is the same HTML for everyone; who is signed in
 * and what is shown come from the data calls after it has loaded.
 */
export function StudentShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("me");
  const [path, setPath] = useState("");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setPath(window.location.pathname.replace(LOCALE_PREFIX, "").replace(/\/+$/, "") || "/");
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <div className="me-shell">
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <header className="me-header">
        <strong>Scollarly</strong>
        <nav aria-label={t("nav.label")}>
          <ul className="me-nav">
            {NAV.map((item) => (
              <li key={item.href}>
                <a href={item.href} aria-current={path === item.href ? "page" : undefined}>
                  {t(`nav.${item.label}`)}
                </a>
              </li>
            ))}
            <li>
              <a href="/sign-out">{t("nav.signOut")}</a>
            </li>
          </ul>
        </nav>
      </header>
      {online ? null : (
        <p role="status" className="me-offline">
          {t("offline")}
        </p>
      )}
      <main id="main" className="me-main">
        {children}
      </main>
    </div>
  );
}
