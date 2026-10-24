import { isE164 } from "./phone";

/**
 * The one place a WhatsApp URL is built (FR-4, architecture 10.2). Every "Chat on WhatsApp" button, the lead detail
 * button and the contact page call this with the number read from `site_setting.whatsapp_number_e164`. No number is
 * ever written in code (a source scan test fails if one is).
 */

/** The digits wa.me expects (no plus), or null when the configured number is missing or not valid E.164. */
export function whatsAppDigits(numberE164: string | null | undefined): string | null {
  return isE164(numberE164) ? numberE164.slice(1) : null;
}

/**
 * The wa.me link with the message in `?text=`, encoded with `encodeURIComponent`.
 * Returns null when no valid number is configured, so the caller can show the number to copy or hide the button
 * instead of linking to nowhere.
 */
export function buildWhatsAppUrl(numberE164: string | null | undefined, text?: string): string | null {
  const digits = whatsAppDigits(numberE164);
  if (!digits) return null;
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
