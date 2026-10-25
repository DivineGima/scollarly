"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useState } from "react";
import { cn } from "./ui/cn";
import { Badge } from "./ui/badge";
import { StepUpProvider } from "./step-up";
import { DataStatus, useAdminData } from "./use-admin-data";

export interface AdminSession {
  /** The effective role: an owner who has not passed 2FA never gets here. */
  role: "admin" | "owner";
  name: string;
  email: string;
  stepUpFresh: boolean;
}

const SessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useAdminSession needs the AdminShell");
  return session;
}

interface NavItem {
  href: string;
  label: "overview" | "leads" | "dataRequests" | "profile" | "team" | "audit" | "security";
  ownerOnly?: boolean;
}

/** Every screen a stage adds is one line here. The menu follows the role (B-part intro, C-part intro of architecture 16). */
const NAV: readonly NavItem[] = [
  { href: "/admin", label: "overview" },
  { href: "/admin/leads", label: "leads" },
  { href: "/admin/data-requests", label: "dataRequests" },
  { href: "/admin/profile", label: "profile" },
  { href: "/admin/team", label: "team", ownerOnly: true },
  { href: "/admin/audit", label: "audit", ownerOnly: true },
  { href: "/admin/security", label: "security", ownerOnly: true },
];

/** A screen inside a section (a lead, the link requests) keeps its section's menu item lit; the Overview is only itself. */
function isCurrent(path: string, href: string): boolean {
  return href === "/admin" ? path === href : path === href || path.startsWith(`${href}/`);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * The admin frame (S2.6): a role-based menu, the offline banner (admin pages are online-only, architecture 11.4), the 2FA
 * step-up prompt, and the signed-in person's session for the screens inside. The page around it is the same HTML for
 * everyone; who you are and which items you see come from `/api/v1/admin/session` after the page has loaded.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin");
  const { state, reload } = useAdminData<AdminSession>("/api/v1/admin/session");
  const online = useOnline();
  const [path, setPath] = useState("");
  useEffect(() => setPath(window.location.pathname.replace(/^\/en(?=\/)/, "").replace(/\/+$/, "") || "/"), []);

  const session = state.status === "ready" ? state.data : null;
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:bg-bg focus:p-2">
        {t("nav.overview")}
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <strong className="text-lg">Scollarly</strong>
          {session ? (
            <p className="flex items-center gap-2 text-sm text-fg-muted">
              <span>{session.email}</span>
              <Badge variant={session.role === "owner" ? "owner" : "default"}>{t(session.role === "owner" ? "nav.roleOwner" : "nav.roleAdmin")}</Badge>
            </p>
          ) : null}
        </div>
        <nav aria-label={t("nav.label")} className="mx-auto max-w-5xl px-4">
          <ul className="flex flex-wrap gap-x-1 gap-y-1 pb-2">
            {NAV.filter((item) => !item.ownerOnly || session?.role === "owner").map((item) => (
              <li key={item.href}>
                {/* Full page loads on purpose: each screen is a cached shell plus a data call (ADR-040). */}
                <a
                  href={item.href}
                  aria-current={isCurrent(path, item.href) ? "page" : undefined}
                  className={cn("inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-surface", isCurrent(path, item.href) && "bg-surface")}
                >
                  {t(`nav.${item.label}`)}
                </a>
              </li>
            ))}
            <li>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/sign-out" className="inline-flex min-h-11 items-center rounded-md px-3 font-semibold hover:bg-surface">
                {t("nav.signOut")}
              </a>
            </li>
          </ul>
        </nav>
      </header>

      {online ? null : (
        <p role="status" className="bg-surface px-4 py-2 text-center text-warning">
          {t("offline")}
        </p>
      )}

      <main id="main" className="admin-main mx-auto px-4 py-6">
        {session ? (
          <SessionContext.Provider value={session}>
            <StepUpProvider>{children}</StepUpProvider>
          </SessionContext.Provider>
        ) : (
          <DataStatus state={state} reload={reload} />
        )}
      </main>
    </div>
  );
}
