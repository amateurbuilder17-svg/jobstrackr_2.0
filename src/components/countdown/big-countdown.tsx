"use client";

import { formatParts, remainingUntil } from "@/lib/countdown/remaining";
import { useNow } from "./now-provider";

/**
 * The large four-part display, for a single countdown.
 *
 * `tabular-nums` throughout, and every part zero-padded, so nothing shifts
 * sideways as the digits change. A countdown whose layout jitters once a second
 * is the most reliable way to make one unpleasant to watch.
 *
 * The whole block is one `aria-live="off"` region with a readable summary
 * beside it. Announcing a changing number every second would make the page
 * unusable with a screen reader, so the digits are marked decorative and the
 * sentence underneath carries the meaning.
 */
export function BigCountdown({ at, label }: { at: string; label: string }) {
  const now = useNow();

  if (now === null) {
    // Server render: a same-shaped placeholder, so the numbers appear without
    // the layout moving under them.
    return (
      <div className="flex gap-2 sm:gap-3" aria-hidden="true">
        {["days", "hrs", "min", "sec"].map((unit) => (
          <div
            key={unit}
            className="flex-1 rounded-md border border-line bg-surface-2 px-2 py-3 text-center"
          >
            <div className="h-8 rounded bg-surface-3" />
            <div className="mt-1.5 text-2xs tracking-wide text-ink-3 uppercase">{unit}</div>
          </div>
        ))}
      </div>
    );
  }

  const r = remainingUntil(at, new Date(now));

  if (r.passed) {
    return (
      <p className="rounded-md border border-line bg-surface-2 px-4 py-6 text-center">
        <span className="font-cond text-2xl font-bold text-ink">This has passed</span>
        <span className="mt-1 block text-sm text-ink-3">{label} was earlier.</span>
      </p>
    );
  }

  return (
    <>
      <div
        className="flex gap-2 sm:gap-3"
        aria-hidden="true"
        // Decorative: the sentence below is what is announced.
      >
        {formatParts(r).map((part) => (
          <div
            key={part.label}
            className={
              "flex-1 rounded-md border px-2 py-3 text-center " +
              (r.urgent ? "border-critical/30 bg-critical-soft" : "border-line bg-surface")
            }
          >
            <div
              className={
                "font-cond text-3xl font-bold tabular-nums sm:text-4xl " +
                (r.urgent ? "text-critical" : "text-ink")
              }
            >
              {part.value}
            </div>
            <div className="mt-1 text-2xs tracking-wide text-ink-3 uppercase">{part.label}</div>
          </div>
        ))}
      </div>

      {/* Updated once a minute's worth of change is meaningful, not every
          second — `aria-live="polite"` on a per-second counter is a screen
          reader talking over itself indefinitely. */}
      <p aria-live="off" className="mt-3 text-center text-sm text-ink-2">
        {r.days > 0
          ? `${String(r.days)} day${r.days === 1 ? "" : "s"} and ${String(r.hours)} hours until ${label.toLowerCase()}.`
          : `${String(r.hours)} hours and ${String(r.minutes)} minutes until ${label.toLowerCase()}.`}
      </p>
    </>
  );
}
