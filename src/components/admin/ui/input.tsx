import { cn } from "./cn";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-md border border-border bg-bg px-3 text-base text-fg aria-[invalid=true]:border-danger focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-semibold text-fg", className)} {...props} />;
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-danger">
      {children}
    </p>
  );
}
