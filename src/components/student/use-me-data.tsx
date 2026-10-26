"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export type MeState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; httpStatus: number; offline: boolean };

/**
 * The data call of a student screen (ADR-040): the page is a shell, this fetches what it shows. A lost session sends the person to
 * sign in. A request that never reached the server (`offline`) is told apart from a server fault, because `/me` can still show the
 * last stage kept on the phone in the first case.
 */
export function useMeData<T>(path: string | null): { state: MeState<T>; reload: () => void } {
  const [state, setState] = useState<MeState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    setState({ status: "loading" });
    void api<T>("GET", path).then((result) => {
      if (!live) return;
      if (result.ok) setState({ status: "ready", data: result.data });
      else {
        if (result.status === 401) window.location.replace("/sign-in");
        setState({ status: "error", httpStatus: result.status, offline: result.status === 0 });
      }
    });
    return () => {
      live = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

/** The loading and error states of a data call. Renders nothing for a ready state, so the caller renders its own. */
export function MeStatus({ state, reload }: { state: MeState<unknown>; reload: () => void }) {
  const t = useTranslations("me.common");
  if (state.status === "loading") return <p role="status">{t("loading")}</p>;
  if (state.status === "error") {
    return (
      <div role="alert" className="me-notice me-notice-error">
        <p>{state.offline ? t("offline") : t("error")}</p>
        <button type="button" className="me-button me-button-quiet" onClick={reload}>
          {t("retry")}
        </button>
      </div>
    );
  }
  return null;
}
