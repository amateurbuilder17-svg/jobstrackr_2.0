import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative rounded-lg border border-line bg-surface shadow-xs",
        // The hover lift is on the border and shadow, not on transform.
        // Transforming a card in a long list forces layer promotion for every
        // one of them, which is what makes scroll janky on a mid-range phone.
        "transition-[border-color,box-shadow] duration-(--duration-fast)",
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
        "hover:border-line-strong hover:shadow-sm",
        // Draws the ring when the anchor inside the card takes focus, so
        // keyboard users see the whole card highlight rather than a bare link.
        "focus-within:border-accent-line focus-within:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
