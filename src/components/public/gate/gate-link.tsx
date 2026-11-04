import type { ComponentProps } from "react";
import { authHref, type GateKind } from "@/modules/gate/next";

/**
 * A button for an action that needs an account (PRD_3 F20, architecture 22.2): apply, start a WhatsApp chat, contact us. A public
 * page is cached and the same for everyone, so it cannot know who is looking. The markup is therefore the safe one: a plain link to
 * Sign in that returns to `next`, which also works with JavaScript off. The gate script (`GateRuntime`) upgrades it: a person who
 * is signed in goes to `href` (the real action), anyone else sees the pop-up. The server refuses the action without a session either way.
 */
export function GateLink({
  kind,
  href,
  next,
  children,
  ...rest
}: {
  kind: GateKind;
  /** Where the action really goes for a signed-in person. */
  href: string;
  /** The public page to return to after signing in. */
  next: string;
} & Omit<ComponentProps<"a">, "href">) {
  return (
    <a {...rest} href={authHref("/sign-in", next)} data-gate={kind} data-gate-href={href} data-gate-next={next}>
      {children}
    </a>
  );
}
