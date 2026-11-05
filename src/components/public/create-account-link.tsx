import { getTranslations } from "next-intl/server";
import { authHref } from "@/modules/gate/next";

/**
 * The one call to action of the public site (PRD_4 F24, F26; architecture 23.5). Every Apply and WhatsApp button used to sit here; both now
 * live inside the account, so a public page asks for one thing: create an account. The address is `/sign-up` returning to this page, so it
 * is a working link with JavaScript off, and it is the same HTML for everyone (public pages are cached and carry nothing personal).
 * `data-account-link` marks it for the "My account" swap for a signed-in browser (S15.5).
 */
export async function CreateAccountLink({ next, size = "normal", variant = "primary" }: { next: string; size?: "normal" | "small"; variant?: "primary" | "outline" }) {
  const t = await getTranslations("site");
  const className = ["btn", variant === "primary" ? "btn-primary" : "btn-outline", size === "small" ? "btn-small" : ""].filter(Boolean).join(" ");
  return (
    <a className={className} href={authHref("/sign-up", next)} data-account-link>
      {t("createAccount")}
    </a>
  );
}
