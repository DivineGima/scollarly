"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { INBOX_REFRESH_EVENT, NOTIFICATIONS_CHANGED_EVENT } from "./events";

/** The bar's dot asks at most this often (architecture 21.8: once after a screen loads, and again when the app regains focus, at most once a minute). */
export const UNREAD_REFRESH_MS = 60_000;

/** Staff only (architecture 24.10): while the page is visible and online the count is asked again on this timer, so a new document shows without a reload. */
export const STAFF_POLL_MS = 120_000;

/**
 * The unread number for the round More button's dot (architecture 21.8). One small call after the screen loads, and again when the app comes
 * back into view, never more than once a minute and never while offline. A student has no timer. Staff also have one (`STAFF_POLL_MS`, only while
 * the page is visible), and when the count rises the open Inbox is told to fetch itself again. A failed call leaves the dot as it was (an ended
 * session is handled by the screen's own data call, not here). "Mark all read" on the page asks for an immediate refresh.
 */
export function useUnreadCount(area: "me" | "admin", enabled: boolean): number {
  const [count, setCount] = useState(0);
  const lastAskedAt = useRef(0);
  const lastCount = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    async function ask(force: boolean) {
      if (!navigator.onLine) return;
      const now = Date.now();
      if (!force && now - lastAskedAt.current < UNREAD_REFRESH_MS) return;
      lastAskedAt.current = now;
      const result = await api<{ unread: number }>("GET", `/api/v1/${area}/notifications?count=1`);
      if (live && result.ok && typeof result.data.unread === "number") {
        const unread = result.data.unread;
        if (area === "admin" && lastCount.current !== null && unread > lastCount.current) window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
        lastCount.current = unread;
        setCount(unread);
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask(false);
    };
    const onFocus = () => void ask(false);
    const onChanged = () => void ask(true);
    void ask(true);
    const timer = area === "admin" ? window.setInterval(() => document.visibilityState === "visible" && void ask(true), STAFF_POLL_MS) : null;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => {
      live = false;
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    };
  }, [area, enabled]);

  return count;
}
