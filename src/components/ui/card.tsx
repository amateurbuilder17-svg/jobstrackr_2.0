import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative rounded-lg border border-line bg-surface",
        // No shadow. A card in this product is a record in a list, and a stack
        // of records should read as one aligned table rather than as separate
        // objects drifting over a background. The border does the separating.
        // Shadow is kept for surfaces that genuinely float — see `--shadow-md`.
        "transition-[border-color,background-color] duration-(--duration-fast)",
        className,
      )}
      {...props}
    />
  );
}

export function CardInteractive({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      className={cn(
        // Hover moves the surface, not the elevation. A background shift reads
        // as "this row is under the cursor" without promoting a layer, which is
        // what kept long lists smooth on a mid-range phone under the old
        // shadow-based hover.
        "hover:border-line-strong hover:bg-surface-2/60",
        // Draws the ring when the anchor inside the card takes focus, so
        // keyboard users see the whole card highlight rather than a bare link.
        "focus-within:border-accent-line focus-within:bg-surface-2/60",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A record in a list: full-bleed, separated from its neighbours by a single
 * hairline rather than by its own border and gap.
 *
 * This is the shape most of the app's lists want. `Card` remains for the cases
 * that are genuinely one bounded object — a summary block, an empty state —
 * rather than one of many.
 */
export function Row({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative border-b border-line bg-surface",
        "transition-colors duration-(--duration-fast)",
        "hover:bg-surface-2/70 focus-within:bg-surface-2/70",
        className,
      )}
      {...props}
    />
  );
}
