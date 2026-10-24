"use client";

import { useEffect, useRef } from "react";
import { cn } from "./cn";

/**
 * A modal dialog on the browser's own `<dialog>` element (focus is trapped and returned by the browser, Escape closes it,
 * and no extra library is shipped). Same props as the shadcn/ui Dialog parts the admin uses.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn("m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-bg p-6 text-fg backdrop:bg-black/50", className)}
    >
      {open ? (
        <>
          <h2 className="mb-3 text-xl font-semibold">{title}</h2>
          {children}
        </>
      ) : null}
    </dialog>
  );
}
