"use client";

import Link from "next/link";

import { ClockIcon, ShareIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import type { Countdown } from "@/lib/db/queries/countdown";
import { absolute, formatRemaining, remainingUntil } from "@/lib/countdown/remaining";
import { useNow } from "./now-provider";

/**
 * One countdown.
 *
 * A Client Component, but it owns no timer — it reads the shared instant from
 * `NowProvider`. A wall of twenty of these is one interval and one re-render
 * per second, not twenty of each.
 *
 * Before hydration `now` is null and the card shows the absolute date. That is
 * deliberate: the date is true forever, it is what belongs in the prerendered
 * HTML a crawler reads, and it means the static page does not ship a countdown
 * that was stale the moment it was written.
 */
export function CountdownCard({ item }: { item: Countdown }) {
  const now = useNow();
  const r = now === null ? null : remainingUntil(item.at, new Date(now));

  return (
    <li className="flex items-start gap-3 rounded-md border border-line bg-surface p-4">
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
          {item.label}
          {item.organization ? ` · ${item.organization}` : ""}
        </p>

        <h3 className="mt-1 font-semibold text-balance text-ink">
          <Link href={item.href} className="hover:underline">
            {item.title}
          </Link>
        </h3>

        <p className="mt-2 flex flex-wrap items-center gap-2">
          {r === null ? (
            // Server render and the moment before hydration.
            <span className="text-sm text-ink-2">
              <time dateTime={item.at}>{absolute(item.at)}</time>
            </span>
          ) : (
            <>
              <Badge tone={r.passed ? "neutral" : r.urgent ? "criticalSolid" : "accent"}>
                <ClockIcon className="size-3" />
                {formatRemaining(r)}
              </Badge>
              <span className="text-xs text-ink-3">
                <time dateTime={item.at}>{absolute(item.at)}</time>
              </span>
            </>
          )}
        </p>
      </div>

      <Link
        href={`/countdown/${item.slug}`}
        aria-label={`Full countdown for ${item.title}`}
        className={
          "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink-3 " +
          "transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink"
        }
      >
        <ShareIcon className="size-4" />
      </Link>
    </li>
  );
}
