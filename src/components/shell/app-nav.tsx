"use client";

import { useEffect, useState } from "react";
import { activeItem, moreItemsFor, notificationsHref, tabsFor, type NavRole, type TabKey } from "@/modules/nav/config";
import { Icon } from "./icons";
import { MoreSheet, type MoreSheetLabels } from "./more-sheet";
import "./shell.css";

export interface AppNavLabels {
  nav: string;
  tabs: Record<TabKey, string>;
  more: string;
  sheet: MoreSheetLabels;
}

export interface AppNavProps {
  role: NavRole;
  labels: AppNavLabels;
  /** Unread notifications, once the screen has fetched the count. Zero or absent shows no dot. */
  unread?: number;
  /** The path to light a tab for. Defaults to the browser's own path after the page has loaded (the HTML is the same for everyone). */
  path?: string;
}

/**
 * The floating pill of tabs and the separate round More button (architecture 21.10, ADR-041). Plain CSS on the site's tokens, no admin
 * library, so it ships to students without weight. Tabs are links: each is its own cached shell (ADR-040). What a person may open is
 * decided by the server on every request; this component only decides what to show.
 */
export function AppNav({ role, labels, unread = 0, path }: AppNavProps) {
  const [current, setCurrent] = useState<string | null>(path ?? null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (path === undefined) setCurrent(window.location.pathname);
  }, [path]);

  const lit = current === null ? null : activeItem(role, current);
  const tabs = tabsFor(role);

  return (
    <>
      <div className="app-nav-spacer" aria-hidden="true" />
      <div className="app-nav">
        <nav aria-label={labels.nav} className="app-nav-pill">
          <ul>
            {tabs.map((tab) => (
              <li key={tab.key}>
                <a href={tab.href} aria-current={lit === tab.key ? "page" : undefined} className="app-nav-tab">
                  <Icon name={tab.icon} />
                  <span>{labels.tabs[tab.key]}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="app-nav-more"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={unread > 0 ? `${labels.more} (${unread})` : labels.more}
          data-active={lit === "more" ? "true" : undefined}
          onClick={() => setOpen(true)}
        >
          <Icon name="more" />
          {unread > 0 ? <span className="app-nav-dot" aria-hidden="true" /> : null}
        </button>
      </div>
      <MoreSheet open={open} onClose={() => setOpen(false)} labels={labels.sheet} role={role} items={moreItemsFor(role)} notificationsHref={notificationsHref(role)} unread={unread} />
    </>
  );
}
