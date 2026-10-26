"use client";

import { useCallback, useRef, useState } from "react";
import { pageGroupOf } from "@/lib/page-group";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { flushEvents, trackEvent } from "@/offline/events";
import { realSubmitDeps } from "@/offline/real-deps";
import { submitLead, type SubmitResult } from "@/offline/submit";
import { preloadTurnstile } from "@/offline/turnstile";

/**
 * The send-first flow shared by the quick form and the apply form (ADR-031, architecture 16 A5). The form gives it a
 * finished request body and the text of the WhatsApp message (a function of the reference, because the reference is made here
 * on the device); the hook saves the lead, sends it, waits up to four seconds, opens WhatsApp, and reports what happened.
 */

export type FlowState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done"; result: Extract<SubmitResult, { kind: "sent" | "queued" }>; waUrl: string | null; opened: boolean }
  | { phase: "limited"; reason: "number_limit" | "rate"; waUrl: string | null }
  | { phase: "save_failed" };

export interface StartOptions {
  payload: Record<string, unknown> & { client_ref: string };
  /** The message for this reference, in the visitor's language. */
  messageFor: (ref: string) => string;
  universityId?: string | undefined;
  /** Called when the server refuses the details, with its field tokens. */
  onRejected: (fields: Record<string, string>) => void;
}

/** Opens WhatsApp in a new tab. Returns false when the browser blocks the jump (it was not a direct tap), so a button can be shown. */
export function openWhatsApp(url: string): boolean {
  try {
    return window.open(url, "_blank", "noopener") !== null;
  } catch {
    return false;
  }
}

export function useLeadFlow({ siteKey, numberE164 }: { siteKey: string; numberE164: string | null }) {
  const [state, setState] = useState<FlowState>({ phase: "idle" });
  const [interactive, setInteractive] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  const start = useCallback(
    async ({ payload, messageFor, universityId, onRejected }: StartOptions) => {
      setState({ phase: "submitting" });
      const deps = realSubmitDeps({ siteKey, host: () => hostRef.current, onInteractive: setInteractive });
      void trackEvent({ type: "form_submit", ...(universityId ? { universityId } : {}), pageGroup: pageGroupOf(location.pathname) });

      // Anything unexpected (a browser missing an API, a storage fault) must not leave the form on "submitting" for ever: nothing was
      // queued in that case, so it is the same answer as a browser that cannot save.
      let result: SubmitResult;
      try {
        result = await submitLead(deps, { payload });
      } catch {
        result = { kind: "save_failed" };
      }

      switch (result.kind) {
        case "sent":
        case "queued": {
          const waUrl = buildWhatsAppUrl(numberE164, messageFor(result.ref));
          const opened = waUrl ? openWhatsApp(waUrl) : false;
          setState({ phase: "done", result, waUrl, opened });
          if (waUrl) void trackEvent({ type: "wa_tap", leadRef: result.ref, ...(universityId ? { universityId } : {}), pageGroup: pageGroupOf(location.pathname) });
          void flushEvents();
          return;
        }
        case "rejected":
          setState({ phase: "idle" });
          onRejected(result.fields);
          return;
        case "limited":
          setState({ phase: "limited", reason: result.reason, waUrl: buildWhatsAppUrl(numberE164) });
          return;
        case "save_failed":
          setState({ phase: "save_failed" });
          return;
      }
    },
    [numberE164, siteKey],
  );

  return { state, interactive, hostRef, start, reset, preload: preloadTurnstile };
}
