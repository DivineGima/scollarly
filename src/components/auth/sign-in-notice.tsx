"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const ERRORS: Record<string, "errorCancelled" | "errorFailed" | "errorUnavailable"> = {
  cancelled: "errorCancelled",
  failed: "errorFailed",
  unavailable: "errorUnavailable",
};

/**
 * The two things the sign-in page can only know in the browser: why the person came back (the `error` in the address, set by
 * `/auth/landing` or by Google's refusal) and whether the phone is online. The page itself is the same for everyone.
 */
export function SignInNotice() {
  const t = useTranslations("auth.signIn");
  const [error, setError] = useState<keyof typeof ERRORS | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error") ?? "";
    setError(Object.hasOwn(ERRORS, code) ? code : null);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <>
      {error ? (
        <p role="alert" className="auth-notice">
          {t(ERRORS[error] as "errorFailed")}
        </p>
      ) : null}
      {online ? null : (
        <p role="status" className="auth-notice">
          {t("offline")}
        </p>
      )}
    </>
  );
}
