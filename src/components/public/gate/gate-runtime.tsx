"use client";

import { useEffect, useRef, useState } from "react";
import { isSignedInHint } from "@/lib/client/signed-in-hint";
import { authHref } from "@/modules/gate/next";
import { GATE_EVENT, type GateRequest } from "./gate-events";

export interface GateLabels {
  title: string;
  intro: string;
  signIn: string;
  signUp: string;
  close: string;
}

/**
 * The sign-in pop-up for actions that need an account (PRD_3 F20, ADR-051). One script for the whole public site, mounted once
 * in the public layout. It listens for taps on any `a[data-gate]` (built by `GateLink`) in the capture phase, before the other
 * islands see the tap:
 *  - a person with a signed-in hint is sent to the real address (`data-gate-href`) and the tap carries on as a normal link;
 *  - anyone else gets this dialog with Sign in and Sign up, both returning to the page they were on.
 * The hint is only a convenience (see `signed-in-hint.ts`); a stale one is caught by the server's refusal, which opens this dialog again.
 * The dialog is the platform's own `<dialog>`: it traps focus, closes on Escape and needs no library.
 */
export function GateRuntime({ labels }: { labels: GateLabels }) {
  const [next, setNext] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[data-gate]") as HTMLAnchorElement | null;
      if (!link) return;
      if (isSignedInHint()) {
        const real = link.dataset.gateHref;
        if (real) link.setAttribute("href", real);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      setNext(link.dataset.gateNext || `${location.pathname}${location.search}`);
    }
    function onRequest(event: Event) {
      const detail = (event as CustomEvent<GateRequest>).detail;
      setNext(detail?.next || `${location.pathname}${location.search}`);
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener(GATE_EVENT, onRequest);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(GATE_EVENT, onRequest);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (next !== null && !dialog.open) dialog.showModal();
    if (next === null && dialog.open) dialog.close();
  }, [next]);

  return (
    <dialog ref={dialogRef} className="lead-dialog gate-dialog" aria-labelledby="gate-title" onClose={() => setNext(null)} data-testid="gate-dialog">
      <div className="lead-panel">
        <h2 id="gate-title">{labels.title}</h2>
        <p>{labels.intro}</p>
        <div className="cta-row">
          {/* Full navigations to pages the Worker serves, not client transitions. */}
          <a className="btn btn-primary" href={authHref("/sign-up", next)} data-testid="gate-sign-up">
            {labels.signUp}
          </a>
          <a className="btn btn-outline" href={authHref("/sign-in", next)} data-testid="gate-sign-in">
            {labels.signIn}
          </a>
        </div>
        <p>
          <button type="button" className="btn btn-outline" onClick={() => setNext(null)}>
            {labels.close}
          </button>
        </p>
      </div>
    </dialog>
  );
}
