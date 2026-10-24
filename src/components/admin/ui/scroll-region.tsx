import { cn } from "./cn";

/** A wide table's wrapper. Keyboard users must be able to reach and scroll it (WCAG 2.1.1), so it is focusable and named. */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    // tabIndex: a scrollable region must be focusable for keyboard access
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto", className)}>
      {children}
    </div>
  );
}
