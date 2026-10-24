import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

/** shadcn/ui Button, in the project's tokens. A thumb-sized target (44px) on every size. */
export const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-base font-semibold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90",
        outline: "border border-border bg-bg text-fg hover:bg-surface",
        destructive: "bg-danger text-accent-fg hover:opacity-90",
        ghost: "text-accent underline-offset-2 hover:underline",
      },
      size: { default: "", sm: "px-3 text-sm" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
