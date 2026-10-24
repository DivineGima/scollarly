"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pageGroupOf } from "@/lib/page-group";
import { flushEvents, flushIfDue, trackEvent, visitCount } from "@/offline/events";
import { listLeads, QUEUE_CHANGED_EVENT } from "@/offline/lead-queue";
import { realSyncDeps } from "@/offline/real-deps";
import { nextDueIn } from "@/offline/logic";
import { syncOnce } from "@/offline/sync-engine";

export interface RuntimeLabels {
  offline: string;
  /** Contains `{count}`. */
  queued: string;
  installPrompt: string;
  install: string;
  dismiss: string;
  turnstilePrompt: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * The small always-on part of the public site (S4.1, S4.2, S4.5): it keeps the lead queue and the event queue moving, shows
 * an offline and "saved on this phone" notice, counts page views, and offers the install prompt after a repeat visit. It renders
 * nothing when there is nothing to say. It does no network work at all until there is something to send, so a visitor who
 * only reads pays for nothing beyond this code.
 *
 * Triggers for sending (architecture 11.2): the `online` event, app load, the tab becoming visible, and a timer for the next
 * waiting lead. A lead is sent only while the app is open and online; background sync is not relied on.
 */
export function OfflineRuntime({ labels, siteKey }: { labels: RuntimeLabels; siteKey: string }) {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [interactive, setInteractive] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const items = await listLeads();
      setQueued(items.filter((i) => i.status !== "sent" && i.status !== "failed").length);
      return items;
    } catch {
      setQueued(0);
      return [];
    }
  }, []);

  const sync = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    try {
      // Only wake Turnstile when there is a lead to send.
      const items = await refresh();
      if (items.length > 0) await syncOnce(realSyncDeps({ siteKey, host: () => hostRef.current, onInteractive: setInteractive }, () => void refresh()));
      const after = await refresh();
      const wait = nextDueIn(after, Date.now());
      if (timer.current) clearTimeout(timer.current);
      // Wake again for the next waiting lead (at most once an hour is ever needed, the longest backoff step).
      if (wait !== null) timer.current = setTimeout(() => void sync(), Math.min(Math.max(wait, 1_000), 3_600_000));
    } finally {
      running.current = false;
    }
  }, [refresh, siteKey]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();

    const onOnline = () => {
      setOnline(true);
      void sync();
      void flushEvents();
    };
    const onOffline = () => setOnline(false);
    const onHide = () => void flushIfDue();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
      else void flushIfDue();
    };
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      void trackEvent({ type: "install" }).then(() => flushEvents());
    };

    const onQueueChanged = () => void refresh();

    window.addEventListener("online", onOnline);
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    // App load: count the page view, then (when idle) send whatever is waiting.
    void trackEvent({ type: "page_view", pageGroup: pageGroupOf(location.pathname) });
    const idle = (callback: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(callback, { timeout: 5_000 }) : setTimeout(callback, 2_000));
    idle(() => {
      void sync();
      void flushIfDue();
    });

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, sync]);

  // The install button is for a returning visitor only, and never inside the installed app.
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    void visitCount().then((n) => setReturning(n >= 2));
  }, []);
  const standalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  const showInstall = Boolean(installEvent) && returning && !dismissed && !standalone;

  return (
    <>
      {!online || queued > 0 ? (
        <div className="status-bar" role="status">
          {!online ? <span>{labels.offline}</span> : null}
          {queued > 0 ? <span>{labels.queued.replace("{count}", String(queued))}</span> : null}
        </div>
      ) : null}
      {interactive ? (
        <div className="status-bar" role="status">
          {labels.turnstilePrompt}
        </div>
      ) : null}
      <div ref={hostRef} className="turnstile-host" />
      {showInstall ? (
        <div className="install-bar">
          <span>{labels.installPrompt}</span>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={async () => {
              await installEvent?.prompt();
              const choice = await installEvent?.userChoice;
              if (choice?.outcome === "dismissed") setDismissed(true);
              setInstallEvent(null);
            }}
          >
            {labels.install}
          </button>
          <button type="button" className="btn btn-outline btn-small" onClick={() => setDismissed(true)}>
            {labels.dismiss}
          </button>
        </div>
      ) : null}
    </>
  );
}
