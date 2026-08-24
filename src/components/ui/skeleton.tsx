import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A loading placeholder.
 *
 * These must match the final element's box exactly. A skeleton that is the
 * wrong height is worse than none: the content lands, everything below it
 * jumps, and the layout shift is charged to Core Web Vitals — so the fallback
 * meant to make loading feel smooth is what makes the page score badly.
 *
 * `aria-hidden` because a screen reader should hear the region's live status,
 * not a description of grey rectangles.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton", className)} {...props} />;
}
