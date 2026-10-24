"use client";

import { useId, useState } from "react";

/**
 * A one-field form for an authenticator code or a recovery code. It owns the field, the busy state and the error line;
 * the caller owns what a code means. `onSubmit` returns an error message to show, or null when the code was accepted.
 */
export function CodeForm({
  label,
  submitLabel,
  busyLabel,
  recovery = false,
  onSubmit,
}: {
  label: string;
  submitLabel: string;
  busyLabel: string;
  recovery?: boolean;
  onSubmit: (code: string) => Promise<string | null>;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || code.trim() === "") return;
    setBusy(true);
    setError(null);
    const message = await onSubmit(code.trim());
    setBusy(false);
    if (message) {
      setError(message);
      setCode("");
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <div className="auth-field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete={recovery ? "off" : "one-time-code"}
          autoCapitalize={recovery ? "characters" : "off"}
          spellCheck={false}
          maxLength={recovery ? 24 : 10}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          disabled={busy}
          autoFocus
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="auth-notice">
            {error}
          </p>
        ) : null}
      </div>
      <button type="submit" className="auth-button" disabled={busy || code.trim() === ""}>
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
