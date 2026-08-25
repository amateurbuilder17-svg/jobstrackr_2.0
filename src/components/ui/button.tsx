import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Variants as a plain lookup rather than a variant library. The set is small
 * and closed; a dependency to express five strings would be a client-bundle
 * cost with nothing to show for it.
 */
const VARIANT = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover active:translate-y-px",
  secondary:
    "bg-surface text-ink border border-line hover:bg-surface-2 " +
    "hover:border-line-strong active:translate-y-px",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-critical text-white hover:brightness-110 active:translate-y-px",
} as const;

const SIZE = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-9.5 px-4 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-base gap-2 rounded-lg",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      // Explicit, because an unset `type` inside a form defaults to "submit" —
      // a stray icon button then silently submits the form.
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[background-color,border-color,color,transform] duration-(--duration-fast)",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
}
