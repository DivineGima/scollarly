"use client";

import { useState } from "react";

/** "Copy WhatsApp number" (architecture 16 A6 step 3). The number is also shown as text, so a refusal by the browser loses nothing. */
export function CopyButton({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch {
      setDone(false);
    }
  }
  return (
    <>
      <button type="button" className="btn btn-outline js-only" onClick={copy}>
        {label}
      </button>
      <span role="status" aria-live="polite" className="muted">
        {done ? copied : ""}
      </span>
    </>
  );
}
