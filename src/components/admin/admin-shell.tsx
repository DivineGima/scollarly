"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useState } from "react";
import { useUnreadCount } from "@/components/notifications/use-unread";
import { AppNav } from "@/components/shell/app-nav";
import { FirstVisitTour, type TourStep } from "@/components/shell/first-visit-tour";
import { navLabels } from "@/components/shell/nav-labels";
import { api } from "@/lib/client/api";
import { activeItem, normalisePath, TOUR_KEYS, type TabKey } from "@/modules/nav/config";
import { Badge } from "./ui/badge";
import { StepUpProvider } from "./step-up";
import { DataStatus, useAdminData } from "./use-admin-data";

export interface AdminSession {
  /** The effective role: an owner who has not passed 2FA never gets here. */
  role: "admin" | "owner";
  name: string;
  email: string;
  stepUpFresh: boolean;
  /** The tabs whose first-visit tour this person has already seen (`app_user.tours_seen`). */
  toursSeen: string[];
  userId: string;
}

const SessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useAdminSession needs the AdminShell");
  return session;
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
 * The admin frame (S2.6, S13.6): the signed-in person's name and role, the offline banner (admin pages are read-only offline, architecture
 * 11.4), the 2FA step-up prompt, the floating bar with the round More button (architecture 21.10, ADR-041), and the three-step tour of the tab
 * a person opens for the first time. The page around it is the same HTML for everyone; who you are and which More rows you see come from
 * `/api/v1/admin/session` after the page has loaded. Access is decided by the server on every request, never by this menu.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin");
  const shell = useTranslations("shell");
  const { state, reload } = useAdminData<AdminSession>("/api/v1/admin/session");
  const online = useOnline();
  const [path, setPath] = useState("");
  const [seen, setSeen] = useState<string[] | null>(null);
  useEffect(() => setPath(normalisePath(window.location.pathname)), []);

  const session = state.status === "ready" ? state.data : null;
  useEffect(() => {
    // A session that does not say which tours were seen shows none, rather than showing every tour again.
    if (session) setSeen(Array.isArray(session.toursSeen) ? session.toursSeen : null);
  }, [session]);

  const unread = useUnreadCount("admin", session !== null);
  const lit = session && path ? activeItem(session.role, path) : null;
  const tourTab: TabKey | null = lit && lit !== "more" && (TOUR_KEYS as readonly string[]).includes(lit) ? lit : null;

  function tourSeen(tab: TabKey) {
    setSeen((current) => [...(current ?? []), tab]);
    void api("POST", "/api/v1/admin/tour.seen", { tab });
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:bg-bg focus:p-2">
        {t("skip")}
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

      {session ? <AppNav role={session.role} labels={navLabels(shell as never, "staff")} unread={unread} /> : null}
      {session && tourTab ? (
        <FirstVisitTour
          tabKey={tourTab}
          steps={tourSteps(t.raw(`tours.${tourTab}`))}
          labels={{ next: shell("tour.next"), skip: shell("tour.skip"), done: shell("tour.done"), stepOf: (step, total) => shell("tour.stepOf", { step, total }) }}
          seen={seen === null ? null : seen.includes(tourTab)}
          onSeen={tourSeen}
        />
      ) : null}
    </div>
  );
}

/** The steps of a tab's tour from the messages; anything that is not a list of title and body is no tour. */
function tourSteps(raw: unknown): TourStep[] {
  return Array.isArray(raw) ? (raw as TourStep[]).filter((step) => typeof step?.title === "string" && typeof step?.body === "string") : [];
}
