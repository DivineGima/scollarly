import { getTranslations } from "next-intl/server";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import { readSite } from "@/modules/content/read";
import { PageLink } from "./page-link";

export interface WhatsAppContext {
  universityId?: string;
  universityName?: string;
  programmeId?: string;
  /** Where the visitor is, for the lead's `source.page`. */
  page: string;
}

/**
 * Every "Chat on WhatsApp" button (architecture 16 A1 step 3, A3 step 6). The address comes from the one helper
 * (`lib/whatsapp`) with the number in `site_setting`, never from code (FR-4).
 *
 * Without JavaScript this is a plain link into the chat. With JavaScript the quick form island (Stage 4, ADR-030) catches
 * the tap through the `data-wa-chat` attributes, collects name, number and country, saves the lead and then opens the
 * same chat with the reference. When no number is set yet, the button leads to the contact page instead of nowhere.
 */
export async function WhatsAppButton({
  context,
  variant = "primary",
  labelKey = "chat",
}: {
  context: WhatsAppContext;
  variant?: "primary" | "secondary";
  labelKey?: "chat" | "ask";
}) {
  const [{ contact }, t] = await Promise.all([readSite(), getTranslations("site.whatsapp")]);
  const label = t(labelKey);
  const className = variant === "primary" ? "btn btn-whatsapp" : "btn btn-outline";
  const href = buildWhatsAppUrl(contact.whatsappE164);
  if (!href) {
    return (
      <PageLink href="/contact" className={className}>
        {label}
      </PageLink>
    );
  }
  return (
    <a
      href={href}
      className={className}
      rel="noopener"
      data-wa-chat=""
      data-wa-page={context.page}
      data-wa-university-id={context.universityId}
      data-wa-university-name={context.universityName}
      data-wa-programme-id={context.programmeId}
    >
      {label}
    </a>
  );
}
