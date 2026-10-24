"use client";

import { useEffect, useState } from "react";

/**
 * Stage 0 stand-in for a signed-in screen's data island (ADR-040): the page around it is a prerendered shell with no
 * data in it, and this fetches the one value from a plain edge function. The real screens use the same pattern.
 */
export function StubValue({ url, field, label, testId }: { url: string; field: string; label: string; testId: string }) {
  const [value, setValue] = useState<string>("...");
  useEffect(() => {
    let live = true;
    fetch(url, { credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, unknown>>) : Promise.reject(new Error(String(response.status)))))
      .then((body: Record<string, unknown>) => live && setValue(String(body[field] ?? "")))
      .catch(() => live && setValue("unavailable"));
    return () => {
      live = false;
    };
  }, [url, field]);
  return (
    <p data-testid={testId}>
      {label}: {value}
    </p>
  );
}
