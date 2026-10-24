"use client";

import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState } from "react";
import { api, type ApiResult } from "@/lib/client/api";
import { codeErrorKey } from "@/lib/client/two-factor";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { FieldError, Input, Label } from "./ui/input";

type Run = <T>(action: () => Promise<ApiResult<T>>) => Promise<ApiResult<T>>;
const StepUpContext = createContext<{ run: Run } | null>(null);

/**
 * Architecture 9.3 step 5: a destructive owner action needs a 2FA check inside the last 10 minutes. `run(action)` calls the
 * action; if the server answers STEP_UP_REQUIRED it asks for a code (or a recovery code) and, once accepted, calls the action
 * again. Cancelling returns the original refusal, so the screen shows nothing changed.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin.stepUp");
  const [open, setOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const id = useId();

  const finish = useCallback((confirmed: boolean) => {
    setOpen(false);
    resolver.current?.(confirmed);
    resolver.current = null;
  }, []);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setRecovery(false);
        setCode("");
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const run: Run = useCallback(
    async (action) => {
      const first = await action();
      if (first.ok || first.code !== "STEP_UP_REQUIRED") return first;
      return (await ask()) ? action() : first;
    },
    [ask],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || code.trim() === "") return;
    setBusy(true);
    setError(null);
    const result = await api("POST", recovery ? "/api/v1/auth/twoFactor.recovery" : "/api/v1/auth/twoFactor.verify", { code: code.trim() });
    setBusy(false);
    if (result.ok) finish(true);
    else {
      setError(t(codeErrorKey(result)));
      setCode("");
    }
  }

  const value = useMemo(() => ({ run }), [run]);
  return (
    <StepUpContext.Provider value={value}>
      {children}
      <Dialog open={open} onClose={() => finish(false)} title={t("title")}>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <p className="mb-4 text-fg-muted">{t("body")}</p>
          <Label htmlFor={`${id}-code`}>{recovery ? t("recoveryLabel") : t("codeLabel")}</Label>
          <Input
            id={`${id}-code`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode={recovery ? "text" : "numeric"}
            autoComplete={recovery ? "off" : "one-time-code"}
            maxLength={recovery ? 24 : 10}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            disabled={busy}
            autoFocus
          />
          {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || code.trim() === ""}>
              {t("confirm")}
            </Button>
            <Button variant="ghost" onClick={() => setRecovery((value) => !value)}>
              {recovery ? t("useApp") : t("useRecovery")}
            </Button>
          </div>
        </form>
      </Dialog>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): Run {
  const context = useContext(StepUpContext);
  if (!context) throw new Error("useStepUp needs a StepUpProvider");
  return context.run;
}
