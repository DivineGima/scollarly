/**
 * Cloudflare Turnstile in the browser (architecture 11.3, ADR-016). The widget script is loaded lazily, only when a form is
 * focused or a queued lead needs sending, so a visitor who only reads pays nothing. A token is single use, so every send
 * asks for a fresh one. The widget is set to `interaction-only`: it stays invisible unless Cloudflare needs the person to do
 * something, and then a small prompt appears ("Confirm you're human to send your application").
 */

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** An interactive challenge waits for a person, so the wait is long; an invisible one finishes in a second or two. */
const TOKEN_TIMEOUT_MS = 90_000;

let scriptLoading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile_unavailable")));
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("turnstile_unavailable"));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** Starts loading the script early (on focus) without asking for a token. */
export function preloadTurnstile(): void {
  void loadScript().catch(() => undefined);
}

export interface TokenOptions {
  siteKey: string;
  /** Where the widget lives. It is shown only if a challenge needs the person. */
  host: HTMLElement | null;
  /** Called when an interactive challenge starts (true) and ends (false), so the page can show its prompt. */
  onInteractive?: (active: boolean) => void;
}

/** A fresh single-use token. Rejects if Turnstile is blocked, not configured, or the challenge fails or times out. */
export async function getTurnstileToken({ siteKey, host, onInteractive }: TokenOptions): Promise<string> {
  if (!siteKey) throw new Error("turnstile_not_configured");
  const api = await loadScript();
  const container = document.createElement("div");
  (host ?? document.body).appendChild(container);

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | undefined;
    const finish = (action: () => void) => {
      clearTimeout(timer);
      onInteractive?.(false);
      if (widgetId !== undefined) {
        try {
          api.remove(widgetId);
        } catch {
          // Already gone.
        }
      }
      container.remove();
      action();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("turnstile_timeout"))), TOKEN_TIMEOUT_MS);
    try {
      widgetId = api.render(container, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: (token: string) => finish(() => resolve(token)),
        "error-callback": () => finish(() => reject(new Error("turnstile_error"))),
        "expired-callback": () => finish(() => reject(new Error("turnstile_expired"))),
        "before-interactive-callback": () => onInteractive?.(true),
        "after-interactive-callback": () => onInteractive?.(false),
      });
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error("turnstile_error")));
    }
  });
}
