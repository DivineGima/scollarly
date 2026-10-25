import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badgeVariants = cva("inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold", {
  variants: {
    variant: {
      default: "bg-surface text-fg",
      owner: "bg-accent text-accent-fg",
      warning: "bg-surface text-warning",
      success: "bg-surface text-success",
      danger: "bg-danger text-accent-fg",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
