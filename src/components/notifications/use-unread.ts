"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { NOTIFICATIONS_CHANGED_EVENT } from "./events";

/** The bar's dot asks at most this often (architecture 21.8: once after a screen loads, and again when the app regains focus, at most once a minute). */
export const UNREAD_REFRESH_MS = 60_000;

/**
 * The unread number for the round More button's dot (architecture 21.8). One small call after the screen loads, and again when the app comes
 * back into view, never more than once a minute and never while offline: there is no polling. A failed call leaves the dot as it was (an
 * ended session is handled by the screen's own data call, not here). "Mark all read" on the page asks for an immediate refresh.
 */
export function useUnreadCount(area: "me" | "admin", enabled: boolean): number {
  const [count, setCount] = useState(0);
  const lastAskedAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    async function ask(force: boolean) {
      if (!navigator.onLine) return;
      const now = Date.now();
      if (!force && now - lastAskedAt.current < UNREAD_REFRESH_MS) return;
      lastAskedAt.current = now;
      const result = await api<{ unread: number }>("GET", `/api/v1/${area}/notifications?count=1`);
      if (live && result.ok && typeof result.data.unread === "number") setCount(result.data.unread);
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask(false);
    };
    const onFocus = () => void ask(false);
    const onChanged = () => void ask(true);
    void ask(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    };
  }, [area, enabled]);

  return count;
}
