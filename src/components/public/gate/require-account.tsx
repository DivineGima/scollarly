"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isSignedInHint } from "@/lib/client/signed-in-hint";
import { authHref } from "@/modules/gate/next";

export interface RequireAccountLabels {
  title: string;
  intro: string;
  signIn: string;
  signUp: string;
}

/**
 * Wraps a form that needs an account (PRD_3 F20, ADR-051), such as Start your application. The page is cached and identical for
 * everyone, so the choice is made on the phone after load: a signed-in hint shows the form, anything else shows a plain panel with
 * Sign in and Sign up that return to `next`. Until the check has run nothing is shown, so a signed-in person never sees a flash of
 * the panel and a signed-out person never sees a form they cannot use. The server refuses the submit without a session regardless.
 */
export function RequireAccount({ labels, next, children }: { labels: RequireAccountLabels; next: string; children: ReactNode }) {
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");

  useEffect(() => {
    setState(isSignedInHint() ? "in" : "out");
  }, []);

  if (state === "unknown") return null;
  if (state === "in") return <>{children}</>;
  return (
    <div className="notice" role="region" aria-labelledby="require-title" data-testid="require-account">
      <h2 id="require-title">{labels.title}</h2>
      <p>{labels.intro}</p>
      <p className="cta-row">
        <a className="btn btn-primary" href={authHref("/sign-up", next)}>
          {labels.signUp}
        </a>
        <a className="btn btn-outline" href={authHref("/sign-in", next)}>
          {labels.signIn}
        </a>
      </p>
    </div>
  );
}
