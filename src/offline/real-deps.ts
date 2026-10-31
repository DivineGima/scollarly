import { randomUuid } from "@/lib/uuid";
import { enqueueLead, listLeads, removeLead, updateLead } from "./lead-queue";
import { sendLead } from "./send";
import { browserLock, type SyncDeps } from "./sync-engine";
import { realWait, type SubmitDeps } from "./submit";
import { getTurnstileToken } from "./turnstile";

/**
 * The browser's real implementations of the queue, the network and Turnstile, wired into the pure engines of
 * `sync-engine.ts` and `submit.ts`. The tests of those engines use fakes; the Playwright tests use these.
 */

export interface TokenSource {
  siteKey: string;
  /** Where the Turnstile widget lives (shown only for an interactive challenge). */
  host: () => HTMLElement | null;
  onInteractive?: (active: boolean) => void;
}

const token = (source: TokenSource) => () => getTurnstileToken({ siteKey: source.siteKey, host: source.host(), onInteractive: source.onInteractive });

export function realSubmitDeps(source: TokenSource, onSent?: SubmitDeps["onSent"]): SubmitDeps {
  return {
    enqueue: enqueueLead,
    update: updateLead,
    remove: removeLead,
    now: () => Date.now(),
    getToken: token(source),
    send: (item, turnstileToken) => sendLead(item, turnstileToken),
    isOnline: () => navigator.onLine,
    wait: realWait,
    newKey: randomUuid,
    ...(onSent ? { onSent } : {}),
  };
}

/**
 * The sync deps for the signed-in screens (S13.3): only finished questionnaires, which need no Turnstile (the session protects them).
 * `getToken` is never called for them, and rejects if it ever were, so a lead from the apply form can never be sent from here by mistake.
 */
export function realOnboardingSyncDeps(onSent?: SyncDeps["onSent"]): SyncDeps {
  return {
    list: async () => (await listLeads()).filter((item) => item.kind === "onboarding"),
    update: updateLead,
    remove: removeLead,
    now: () => Date.now(),
    getToken: () => Promise.reject(new Error("no token for onboarding")),
    send: (item, turnstileToken) => sendLead(item, turnstileToken),
    withLock: browserLock(),
    ...(onSent ? { onSent } : {}),
  };
}

export function realSyncDeps(source: TokenSource, onSent?: SyncDeps["onSent"]): SyncDeps {
  return {
    list: listLeads,
    update: updateLead,
    remove: removeLead,
    now: () => Date.now(),
    getToken: token(source),
    send: (item, turnstileToken) => sendLead(item, turnstileToken),
    withLock: browserLock(),
    ...(onSent ? { onSent } : {}),
  };
}
