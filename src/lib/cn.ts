import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `text-card-*` is a font size, not a colour.
 *
 * The fluid card scale in `globals.css` adds `--text-card-2xs` … `--text-card-lg`,
 * which Tailwind turns into `text-card-base` and friends. tailwind-merge cannot
 * know that: it sees `text-<something>` with an unrecognised value and files it
 * under text colour, so a later `text-white` in the same `cn()` call silently
 * deletes the size — which is exactly what happened to the deadline pill, and
 * it fails silently, inheriting whatever size the parent had.
 *
 * Declaring the group here is the fix, and it is worth preferring over spelling
 * every call site `text-[length:var(--text-card-base)]`: one declaration cannot
 * be forgotten at the next call site.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["card-2xs", "card-xs", "card-sm", "card-base", "card-lg"] }],
    },
  },
});

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
