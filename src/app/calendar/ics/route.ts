import { getUser } from "@/lib/auth/session";
import { listPersonalEvents } from "@/lib/db/queries/calendar";
import { EVENT_LABELS } from "@/lib/exams/report";
import { env } from "@/lib/env";

/**
 * The reader's own dates as an .ics file.
 *
 * Generated rather than linked out, so a deadline lands in whatever calendar
 * the person already uses instead of only living in this app.
 *
 * This used to export a month of *every* published deadline, and took `?m=` to
 * say which month. Both are gone with the page's: what it exports now is the
 * same curated set the page draws — the exams this account saved or tracks, all
 * of them, with no month parameter, because a calendar app has no notion of
 * "the month I was looking at" and importing twelve files to get a year is not
 * a feature anybody wanted.
 *
 * Per-user and therefore never cached. The old handler carried an `s-maxage`
 * that would now be actively dangerous — a CDN holding one account's exams and
 * serving them to the next caller.
 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return new Response("Sign in to export your calendar.", {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const events = await listPersonalEvents();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JobsTrackr//Exam Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:My exam dates",
  ];

  for (const event of events) {
    const stamp = event.date.replaceAll("-", "");
    const label = EVENT_LABELS[event.type];
    const phase = event.phase ? ` (${event.phase})` : "";

    lines.push(
      "BEGIN:VEVENT",
      // Stable across regenerations: re-importing must update the existing
      // entry rather than duplicate it. `PersonalEvent.id` is already
      // subject + type + date, which is exactly the identity wanted here.
      `UID:${event.id.replaceAll("|", "-")}@jobstrackr.in`,
      `DTSTAMP:${stamp}T000000Z`,
      // An all-day event. DTEND is exclusive in iCalendar, so it is the *next*
      // day — using the same date produces a zero-length event that several
      // clients simply do not show.
      `DTSTART;VALUE=DATE:${stamp}`,
      `DTEND;VALUE=DATE:${nextDay(event.date)}`,
      `SUMMARY:${escapeIcs(`${label}${phase} — ${event.subject}`)}`,
      `DESCRIPTION:${escapeIcs(describe(event.predicted, event.organization))}`,
    );

    if (event.href) lines.push(`URL:${env.NEXT_PUBLIC_SITE_URL}${event.href}`);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // CRLF, not LF. RFC 5545 requires it, and Outlook enforces it.
  const body = lines.join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="jobstrackr.ics"',
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * The note that rides into the reader's phone.
 *
 * The "expected" caveat matters more here than on the page: once a date is in
 * somebody's own calendar it has lost every visual cue this app gave it, and an
 * alarm at 9am for an admit card a model guessed at is worse than no alarm.
 */
function describe(predicted: boolean, organization: string | null): string {
  const parts: string[] = [];
  if (organization) parts.push(organization);
  parts.push(
    predicted
      ? "Expected date — not officially confirmed. Check the conducting body's notice."
      : "From the official notification.",
  );
  return parts.join(". ");
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * Escapes a value for iCalendar. Backslash first, or it would double-escape
 * the ones the later replacements introduce.
 */
function escapeIcs(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}
