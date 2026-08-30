"use client";

import { BookmarkIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useSaved } from "@/components/session/session-provider";

/**
 * The save toggle.
 *
 * State comes from context rather than props, so a list of 20 cards costs one
 * fetch and one shared store rather than 20 of each.
 *
 * Nothing here changes between the server render and the first client render,
 * and that constraint is load-bearing rather than stylistic. An earlier version
 * disabled the button until the store had hydrated; `disabled` then differed
 * from the prerendered HTML, React reported a hydration mismatch and *discarded
 * the client tree for this subtree* — leaving twenty permanently disabled
 * buttons whose state updates went nowhere. The symptom looked like a broken
 * store; the cause was one attribute that flipped mid-hydration.
 *
 * So the button is always live, and starts drawn unsaved on both sides. The
 * store fills it in afterwards as an ordinary state update, which hydration
 * does not police. A press that lands before the store is ready is kept, not
 * dropped — see the merge in `SessionProvider`.
 */
export function SaveButton({
  jobId,
  title,
  className,
}: {
  jobId: string;
  /** Used only for the accessible name, so the control is not just "Save". */
  title: string;
  className?: string;
}) {
  const { isSaved, toggle, pending } = useSaved();

  const saved = isSaved(jobId);
  const queued = pending.has(jobId);

  return (
    <button
      type="button"
      // `relative` lifts it above the card's stretched title link, which would
      // otherwise sit on top of this button and swallow the click.
      className={cn(
        "relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md",
        "text-ink-3 transition-colors duration-(--duration-fast)",
        "hover:bg-surface-2 hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        saved && "text-accent hover:text-accent",
        className,
      )}
      // A toggle, not an action: `aria-pressed` is what tells a screen reader
      // this is a two-state control and which state it is in.
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      onClick={() => {
        toggle(jobId);
      }}
    >
      <BookmarkIcon
        className="size-4.5"
        fill={saved ? "currentColor" : "none"}
        // Dimmed while the intent is still queued — the save has happened as
        // far as the user is concerned, but it has not been acknowledged, and
        // silently pretending otherwise is how offline state goes wrong.
        opacity={queued ? 0.55 : 1}
      />
    </button>
  );
}
