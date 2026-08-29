/**
 * How long is left, as something a person reads.
 *
 * Pure and dependency-free, so the whole of it is tested against fixed instants
 * rather than against the clock. Every rule below exists because a countdown
 * that gets it wrong is worse than no countdown: this is the number somebody
 * checks before deciding whether they still have time to apply.
 */

export interface Remaining {
  /** Milliseconds left. Negative once the moment has passed. */
  ms: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the deadline is behind us. */
  passed: boolean;
  /** Under 24 hours and not yet passed — the state worth shouting about. */
  urgent: boolean;
}

export function remainingUntil(target: Date | string, now: Date = new Date()): Remaining {
  const end = typeof target === "string" ? new Date(target) : target;
  const ms = end.getTime() - now.getTime();

  if (!Number.isFinite(ms)) {
    // An unparseable date is not "zero seconds left" — that would render a
    // deadline as having just expired, which is a lie in the alarming
    // direction. Treated as passed so the caller shows nothing rather than
    // a countdown to an instant it cannot name.
    return { ms: 0, days: 0, hours: 0, minutes: 0, seconds: 0, passed: true, urgent: false };
  }

  const clamped = Math.max(ms, 0);
  const totalSeconds = Math.floor(clamped / 1000);

  return {
    ms,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    passed: ms <= 0,
    urgent: ms > 0 && ms < 86_400_000,
  };
}

/**
 * The one-line form, for a card.
 *
 * Deliberately not `d h m s` at every scale. Three weeks out, the seconds are
 * noise that changes every tick and tells nobody anything; on the last day they
 * are the entire point. So the precision follows the urgency.
 */
export function formatRemaining(r: Remaining): string {
  if (r.passed) return "Closed";

  if (r.days >= 7) {
    const weeks = Math.floor(r.days / 7);
    const days = r.days % 7;
    return days === 0
      ? `${String(weeks)} week${weeks === 1 ? "" : "s"} left`
      : `${String(weeks)}w ${String(days)}d left`;
  }

  if (r.days >= 1) {
    return `${String(r.days)}d ${String(r.hours)}h left`;
  }

  if (r.hours >= 1) {
    return `${String(r.hours)}h ${String(r.minutes)}m left`;
  }

  if (r.minutes >= 1) {
    return `${String(r.minutes)}m ${String(r.seconds)}s left`;
  }

  return `${String(r.seconds)}s left`;
}

/**
 * The four-part form, for the big display.
 *
 * Always four parts, always padded, so the digits do not jump sideways as they
 * change. A countdown whose layout shifts every second is the most common way
 * to make one unpleasant to look at.
 */
export function formatParts(r: Remaining): { value: string; label: string }[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    { value: String(r.days), label: r.days === 1 ? "day" : "days" },
    { value: pad(r.hours), label: "hrs" },
    { value: pad(r.minutes), label: "min" },
    { value: pad(r.seconds), label: "sec" },
  ];
}

/**
 * How often this countdown needs redrawing.
 *
 * A deadline three months away does not need a repaint every second — that is
 * 86,400 wasted renders a day on a tab somebody left open. Once inside a day,
 * seconds are what people are watching.
 */
export function tickInterval(r: Remaining): number {
  if (r.passed) return 0;
  if (r.ms > 86_400_000) return 60_000;
  return 1000;
}

/**
 * The end of a date in Indian time, as an instant.
 *
 * `2026-09-15` becomes `2026-09-15T18:29:59.999Z` — 23:59:59.999 IST. This is
 * the most damaging off-by-one the feature could have: a closing *date* treated
 * as midnight at the *start* of that day shows the deadline as passed for the
 * whole of the last day people can still apply.
 *
 * India has one timezone and no daylight saving, so +5:30 is a constant rather
 * than something to look up — which is the one fact that makes doing this with
 * arithmetic safe.
 */
export function endOfDayIst(date: string): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const startOfDayUtc = new Date(`${date}T00:00:00.000Z`).getTime();
  return new Date(startOfDayUtc + 86_400_000 - 1 - IST_OFFSET_MS).toISOString();
}

/**
 * The date as somebody in India would write it.
 *
 * Hard-coded to `Asia/Kolkata` rather than the viewer's own zone, deliberately.
 * The deadline is 23:59 in India whoever is looking at it, and formatting in
 * local time would show a different day to somebody applying from the Gulf —
 * a page that tells two people two different closing dates for one job.
 *
 * Lives here, with the other pure helpers, rather than beside the card that
 * first needed it: the card is a Client Component, and a function exported from
 * a `"use client"` module cannot be called by a Server Component. The build
 * fails on it, which is how this ended up in the right place.
 */
export function absolute(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
