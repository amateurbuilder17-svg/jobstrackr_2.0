import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Semantic colour is reserved for genuine state — a deadline, an eligibility
 * verdict, a publication status. `neutral` is the default precisely so that
 * reaching for a colour is a decision rather than a habit; a page where every
 * chip is coloured communicates nothing by colour at all.
 */
const TONE = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  good: "bg-good-soft text-good border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  critical: "bg-critical-soft text-critical border-transparent",
  /* The last day of an application window, and nothing else. A solid fill is
     the loudest thing this design system can do, so it is spent on the one
     state where being missed costs someone a year — and it survives greyscale
     and every form of colour blindness, which a tinted background does not. */
  criticalSolid: "bg-critical text-white border-transparent dark:text-bg",
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-2xs font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
