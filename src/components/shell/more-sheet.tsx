"use client";

import { useEffect, useRef } from "react";
import { type MoreItem, type NavRole, SIGN_OUT_HREF } from "@/modules/nav/config";
import { Icon } from "./icons";

export interface MoreSheetLabels {
  title: string;
  close: string;
  notifications: string;
  unreadCount: (count: number) => string;
  items: Record<MoreItem["key"], string>;
  signOut: string;
}

export interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  labels: MoreSheetLabels;
  role: NavRole;
  items: readonly MoreItem[];
  notificationsHref: string;
  unread: number;
}

/**
 * The sheet behind the round button: Notifications on top, then the pages that are not tabs, then Sign out (architecture 21.10).
 * A dialog: Escape and the backdrop close it, focus moves in when it opens and returns to the button when it closes.
 */
export function MoreSheet({ open, onClose, labels, items, notificationsHref, unread }: MoreSheetProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="more-backdrop" onClick={onClose} role="presentation">
      <div ref={panel} className="more-sheet" role="dialog" aria-modal="true" aria-label={labels.title} onClick={(event) => event.stopPropagation()}>
        <div className="more-head">
          <h2>{labels.title}</h2>
          <button type="button" className="more-close" onClick={onClose} aria-label={labels.close}>
            ×
          </button>
        </div>
        <ul className="more-list">
          <li>
            <a href={notificationsHref} className="more-row more-row-first">
              <Icon name="bell" />
              <span>{labels.notifications}</span>
              {unread > 0 ? <span className="more-count">{labels.unreadCount(unread)}</span> : null}
            </a>
          </li>
          {items.map((item) => (
            <li key={item.key}>
              <a href={item.href} className="more-row">
                <Icon name={item.icon} />
                <span>{labels.items[item.key]}</span>
              </a>
            </li>
          ))}
          <li>
            <a href={SIGN_OUT_HREF} className="more-row">
              <Icon name="signOut" />
              <span>{labels.signOut}</span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
