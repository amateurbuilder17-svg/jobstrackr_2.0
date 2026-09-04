"use client";

import { BookmarkIcon } from "@/components/icons";
import { useSaved } from "@/components/session/session-provider";
import { cn } from "@/lib/cn";

export function JobBookmarkButton({ jobId, title }: { jobId: string; title: string }) {
  const { ready, isSaved, toggle } = useSaved();
  const saved = ready && isSaved(jobId);

  return (
    <button
      type="button"
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(jobId);
      }}
      className={cn(
        "relative z-10 -mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg p-1.5",
        "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        saved
          ? "text-accent hover:text-accent-hover"
          : "text-ink-3 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <BookmarkIcon className="size-4.5" fill={saved ? "currentColor" : "none"} />
    </button>
  );
}
