"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Button } from "./ui/button";

export type DataState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; httpStatus: number };

/**
 * The data call of a signed-in screen (ADR-040): the page is a shell, this fetches what it shows. A lost session sends the
 * person to sign in; any other failure is a state the screen can show with a Try again button, never a blank page.
 */
export function useAdminData<T>(path: string | null): { state: DataState<T>; reload: () => void } {
  const [state, setState] = useState<DataState<T>>({ status: "loading" });
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
        setState({ status: "error", httpStatus: result.status });
      }
    });
    return () => {
      live = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

/** Shows the loading and error states of a data call; renders nothing for a ready state, so the caller renders its own. */
export function DataStatus({ state, reload }: { state: DataState<unknown>; reload: () => void }) {
  const t = useTranslations("admin.common");
  if (state.status === "loading") return <p role="status">{t("loading")}</p>;
  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-md border border-danger p-4 text-danger">
        <p>{t("error")}</p>
        <Button variant="outline" className="mt-3" onClick={reload}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  return null;
}
