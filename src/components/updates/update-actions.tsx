"use client";

import { useState } from "react";

import { ExternalLinkIcon, ShareIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

export interface UpdateActionsProps {
  slug: string;
  title: string;
  action: {
    label: string;
    url: string;
  } | null;
  official: {
    label: string;
    url: string;
  } | null;
}

/**
 * Primary actions for an exam update detail page.
 *
 * Sticky bottom bar on mobile (above bottom navigation), inline flow on desktop.
 * Includes primary CTA, official website link, and share action with clipboard fallback.
 */
export function UpdateActions({ slug, title, action, official }: UpdateActionsProps) {
  if (!action && !official) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30",
        "border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md",
        "lg:static lg:mt-6 lg:border lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none",
        "lg:rounded-lg lg:border-transparent",
      )}
    >
      <div className="relative mx-auto flex max-w-3xl items-center gap-2 sm:gap-2.5">
        {action ? (
          <a
            href={action.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-5",
              "text-sm font-semibold transition-colors duration-(--duration-fast)",
              "bg-brand text-white shadow-xs hover:bg-brand-deep",
            )}
          >
            <span className="truncate">{action.label}</span>
            <ExternalLinkIcon className="size-4 shrink-0" aria-hidden="true" />
          </a>
        ) : null}

        {official ? (
          <a
            href={official.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-4",
              "border border-line bg-surface text-sm font-medium text-ink",
              "transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-2",
            )}
          >
            <span className="truncate">{official.label}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
          </a>
        ) : null}

        <ShareButton slug={slug} title={title} />
      </div>
    </div>
  );
}

function ShareButton({ slug, title }: { slug: string; title: string }) {
  const [message, setMessage] = useState("");

  return (
    <>
      <button
        type="button"
        aria-label={`Share ${title}`}
        onClick={() => {
          void share();
        }}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line",
          "bg-surface text-ink-2 transition-colors duration-(--duration-fast)",
          "hover:border-line-strong hover:text-ink hover:bg-surface-2",
        )}
      >
        <ShareIcon className="size-4.5" />
      </button>
      <span aria-live="polite" className="sr-only">
        {message}
      </span>
      {message ? (
        <span className="pointer-events-none absolute right-2 -top-9 rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-bg lg:top-auto lg:-bottom-9">
          {message}
        </span>
      ) : null}
    </>
  );

  async function share() {
    const url = `${window.location.origin}/updates/${slug}`;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Sheet cancelled; fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      say("Link copied");
    } catch {
      say("Could not copy link");
    }
  }

  function say(text: string) {
    setMessage(text);
    setTimeout(() => {
      setMessage("");
    }, 2200);
  }
}
