import { type NextRequest } from "next/server";

import { listDeadlinesInMonth } from "@/lib/db/queries/calendar";
import { env } from "@/lib/env";

/**
 * A month of deadlines as an .ics file.
 *
 * Generated rather than linked out, so a deadline lands in whatever calendar
 * the person already uses instead of only living in this app. Everything here
 * is public content, so the response is cacheable like any other page.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("m") ?? "";
  const match = /^(\d{4})-(\d{2})$/.exec(raw);

  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;

  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    return new Response("Invalid month.", { status: 400 });
  }

  const events = await listDeadlinesInMonth(year, month);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JobsTrackr//Exam Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:JobsTrackr deadlines ${raw || `${String(year)}-${pad(month)}`}`,
  ];

  for (const event of events) {
    const stamp = event.date.replaceAll("-", "");
    lines.push(
      "BEGIN:VEVENT",
      // Stable across regenerations: the same deadline must update the
      // existing entry rather than duplicate it every time someone re-imports.
      `UID:${event.id}@jobstrackr.in`,
      `DTSTAMP:${stamp}T000000Z`,
      // An all-day event. DTEND is exclusive in iCalendar, so it is the *next*
      // day — using the same date produces a zero-length event that several
      // clients simply do not show.
      `DTSTART;VALUE=DATE:${stamp}`,
      `DTEND;VALUE=DATE:${nextDay(event.date)}`,
      `SUMMARY:${escapeIcs(`Last date — ${event.title}`)}`,
      `URL:${env.NEXT_PUBLIC_SITE_URL}/jobs/${event.slug}`,
      `DESCRIPTION:${escapeIcs(
        event.organization
          ? `${event.organization}. Applications close today.`
          : "Applications close today.",
      )}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  // CRLF, not LF. RFC 5545 requires it, and Outlook enforces it.
  const body = lines.join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobstrackr-${String(year)}-${pad(month)}.ics"`,
      // Public content and stable within a month, so it may sit on the CDN.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

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
