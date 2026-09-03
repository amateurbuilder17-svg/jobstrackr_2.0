"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToday } from "@/components/jobs/today-provider";
import {
  BellIcon,
  BookmarkIcon,
  CheckIcon,
  ExternalLinkIcon,
  ShareIcon,
} from "@/components/icons";
import { useSaved } from "@/components/session/session-provider";
import { cn } from "@/lib/cn";
import { daysUntilFrom } from "@/lib/format/deadline";

/**
 * Apply · Track · Save · Share.
 *
 * The one client island on an otherwise entirely static page. Everything it
 * needs about the job arrives as props, computed during the prerender; what it
 * adds is the three things a cached document cannot know — today's date, who is
 * reading, and whether they can share.
 *
 * The old app's version of this bar recomputed its own `left` and `width` from
 * the sidebar's open state on every render, which is why it drifted whenever
 * the sidebar animated. This one is `sticky` on mobile and in the document flow
 * on desktop, and knows nothing about any other component's layout.
 */

/** Values in `last_date_display` that mean "no date yet", not "closed". */
const TBD = /\b(tbd|to be (announced|notified|decided)|not announced|walk[\s-]?in|n\/a)\b/i;

export interface JobActionsProps {
  jobId: string;
  slug: string;
  title: string;
  applyLink: string | null;
  officialWebsite: string | null;
  lastDate: string | null;
  lastDateDisplay: string | null;
}

export function JobActions(props: JobActionsProps) {
  const { jobId, slug, title, applyLink, officialWebsite, lastDate, lastDateDisplay } = props;

  const router = useRouter();
  const today = useToday();
  const { isSaved, toggle, isTracked, toggleTracked, trackingPending, signedIn } = useSaved();

  const tracked = isTracked(jobId);
  const saved = isSaved(jobId);
  const pendingTrack = trackingPending.has(jobId);

  // Expiry is a client-side judgement because the page is not re-rendered on
  // the day it closes — it was prerendered days ago and served from the CDN
  // since. `today` is null during the prerender and on the first paint, and
  // the bar is deliberately drawn as *open* then: the apply link is the thing
  // the visitor came for, and hiding it behind a date the server cannot know
  // would hide it from a crawler permanently.
  const daysLeft = today === null ? null : daysUntilFrom(today, lastDate);
  const undated = lastDateDisplay !== null && TBD.test(lastDateDisplay);
  const expired = daysLeft !== null && daysLeft < 0 && !undated;

  const primary = expired
    ? officialWebsite
      ? { href: officialWebsite, label: "Official website" }
      : null
    : applyLink
      ? { href: applyLink, label: "Apply on the official site" }
      : officialWebsite
        ? { href: officialWebsite, label: "Official website" }
        : null;

  return (
    <div
      className={cn(
        // Mobile: pinned above the bottom navigation, which is 56px plus the
        // iOS home-indicator inset. Desktop: an ordinary block, because there
        // is no bottom bar and a floating panel over a wide page is clutter.
        "fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30",
        "border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md",
        "lg:static lg:mt-6 lg:border lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none",
        "lg:rounded-lg lg:border-transparent",
      )}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 sm:gap-2.5">
        {primary ? (
          <a
            href={primary.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              "inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-5",
              "text-sm font-semibold transition-colors duration-(--duration-fast)",
              expired
                ? "border border-line bg-surface text-ink hover:bg-surface-2"
                : "bg-brand text-white shadow-xs hover:bg-brand-deep",
            )}
          >
            <span className="truncate">{primary.label}</span>
            <ExternalLinkIcon className="size-4 shrink-0" />
          </a>
        ) : (
          <span
            className={cn(
              "inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-xl px-5",
              "border border-dashed border-line text-sm font-medium text-ink-3",
            )}
          >
            {expired ? "Applications closed" : "No apply link published yet"}
          </span>
        )}

        <button
          type="button"
          aria-pressed={tracked}
          aria-label={tracked ? `Stop tracking ${title}` : `Track ${title}`}
          onClick={() => {
            if (!signedIn) {
              router.push(`/sign-in?next=${encodeURIComponent(`/jobs/${slug}`)}`);
              return;
            }
            toggleTracked(jobId);
          }}
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border",
            "text-sm font-medium transition-colors duration-(--duration-fast)",
            tracked
              ? "border-accent-line bg-accent-soft text-accent"
              : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
            pendingTrack && "opacity-60",
          )}
        >
          {tracked ? <CheckIcon className="size-4.5" /> : <BellIcon className="size-4.5" />}
        </button>

        <button
          type="button"
          aria-pressed={saved}
          aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
          onClick={() => {
            toggle(jobId);
          }}
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border",
            "transition-colors duration-(--duration-fast)",
            saved
              ? "border-accent-line bg-accent-soft text-accent"
              : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
          )}
        >
          <BookmarkIcon className="size-4.5" fill={saved ? "currentColor" : "none"} />
        </button>

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
          "hover:border-line-strong hover:text-ink",
        )}
      >
        <ShareIcon className="size-4.5" />
      </button>
      {/* Announced rather than shown as a toast. The confirmation is one word
          and the page already has a live region convention; a toast library
          would be 12 kB to say "Link copied". */}
      <span aria-live="polite" className="sr-only">
        {message}
      </span>
      {message ? (
        <span className="pointer-events-none absolute right-4 -top-9 rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-bg lg:top-auto lg:-bottom-9">
          {message}
        </span>
      ) : null}
    </>
  );

  async function share() {
    const url = `${window.location.origin}/jobs/${slug}`;

    // Feature-detected as a function rather than for truthiness: the DOM types
    // declare `share` unconditionally, but it is absent on desktop Firefox and
    // on any browser outside a secure context.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelling the sheet throws AbortError, which is not a failure —
        // fall through to the clipboard rather than reporting anything.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      say("Link copied");
    } catch {
      say("Could not copy the link");
    }
  }

  function say(text: string) {
    setMessage(text);
    setTimeout(() => {
      setMessage("");
    }, 2200);
  }
}
