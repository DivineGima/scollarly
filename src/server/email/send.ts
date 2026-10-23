/**
 * Email adapter (architecture section 5: the ONLY place that talks to Resend).
 * Uses Resend's REST API through fetch, so no SDK is added to the Worker bundle.
 *
 * Privacy: nothing about the recipient or the message is ever logged (CLAUDE.md: no personal data in logs).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export type EmailResult = { sent: true } | { sent: false; reason: "not_configured" | "provider_error" };

export type EmailSender = (message: EmailMessage) => Promise<EmailResult>;

const RESEND_URL = "https://api.resend.com/emails";

export function createEmailSender(env: EmailEnv, fetchImpl: typeof fetch = fetch): EmailSender {
  return async (message) => {
    if (!env.RESEND_API_KEY) return { sent: false, reason: "not_configured" };
    try {
      const response = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.EMAIL_FROM ?? "Scollarly <onboarding@resend.dev>",
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      return response.ok ? { sent: true } : { sent: false, reason: "provider_error" };
    } catch {
      return { sent: false, reason: "provider_error" };
    }
  };
}
