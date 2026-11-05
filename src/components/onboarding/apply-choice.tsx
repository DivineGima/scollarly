"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- signed-in screens are cached shells plus a data call, so leaving one is a full page load on purpose (ADR-040) */

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { SIGNED_IN_FRAGMENT } from "@/lib/client/signed-in-hint";
import { APPLY_ADDRESS } from "@/modules/gate/next";

/** Where "Apply now" goes: the Apply screen inside the account (S15.3). */
export const APPLY_PATH = "/me/apply";

/**
 * The last thing a new account sees (PRD_4 F24, architecture 23.4): the profile is saved and no application has been made, so the person
 * chooses. "Apply now" opens the Apply screen; "Not yet" opens the dashboard (or the public page they came from), where the Apply button
 * waits. A native `<dialog>`: the platform traps focus and Escape closes it, and Escape means "Not yet", never "Apply". Both buttons are
 * full-size touch targets.
 */
export function ApplyChoice({ after }: { after: string | null }) {
  const t = useTranslations("onboarding.applyChoice");
  const dialog = useRef<HTMLDialogElement | null>(null);
  // "Not yet" never goes to the Apply screen: a person who arrived through the old Apply address (`next=/apply`) still chose "not yet".
  const later = after && after !== APPLY_ADDRESS ? `${after}${SIGNED_IN_FRAGMENT}` : "/me";

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="ob-choice"
      aria-labelledby="ob-choice-title"
      data-testid="apply-choice"
      onCancel={(event) => {
        // Escape: the person is not ready to apply. Take them on without applying (a hard navigation, like every move between signed-in screens).
        event.preventDefault();
        window.location.assign(later);
      }}
    >
      <h1 id="ob-choice-title">{t("title")}</h1>
      <p>{t("body")}</p>
      <div className="me-actions">
        <a className="me-button" href={APPLY_PATH} data-testid="apply-now">
          {t("apply")}
        </a>
        <a className="me-button me-button-quiet" href={later} data-testid="apply-later">
          {t("later")}
        </a>
      </div>
    </dialog>
  );
}
