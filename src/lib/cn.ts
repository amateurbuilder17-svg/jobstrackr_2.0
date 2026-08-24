import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, with later Tailwind utilities beating earlier ones.
 *
 * Plain concatenation loses that: `"p-4" + " p-8"` emits both, and which wins
 * depends on their order in the stylesheet rather than in the call — so a
 * component's default silently overrides the override. `twMerge` resolves the
 * conflict by keeping the last one, which is what the caller meant.
 *
 * Used mostly from Server Components, where it costs the client nothing: the
 * class string is computed during render and only the resulting HTML is sent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
