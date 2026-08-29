import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { publicDb } from "../clients";
import { unwrap } from "../errors";
import { tags } from "../tags";
import { endOfDayIst } from "@/lib/countdown/remaining";

/**
 * What there is to count down to.
 *
 * Two sources, and only two, because only two carry a real date:
 *
 *   - **`jobs.last_date`** — an application closing. This is the populated one:
 *     219 published jobs have a future closing date today, and it is the
 *     deadline people actually miss.
 *   - **`exams.next_event_at`** — the next thing that happens for an exam. The
 *     schema comment on that column says the countdown hangs off it, and it is
 *     currently null on every row because nothing writes it yet. Included
 *     anyway, so the wall fills in on its own the day ingest populates it
 *     rather than needing a second change here.
 *
 * Public content, cached, tagged. Nothing per-user: a countdown to a public
 * deadline is the same for everybody, which is what lets this page be static.
 */

export interface Countdown {
  /** `job:<slug>` or `exam:<slug>` — unique across both sources. */
  key: string;
  slug: string;
  kind: "job" | "exam";
  title: string;
  /** "Applications close", "Exam day" — what the instant actually is. */
  label: string;
  /** ISO instant. */
  at: string;
  organization: string | null;
  /** Where to read the detail. */
  href: string;
}

interface JobRow {
  slug: string;
  title: string;
  last_date: string;
  organization: { short_name: string | null; name: string } | null;
}

interface ExamRow {
  slug: string;
  name: string;
  short_name: string | null;
  next_event_at: string;
  next_event_label: string | null;
}

/**
 * Everything closing or happening from now on, soonest first.
 *
 * Bounded by a count rather than a date range. A wall is read from the top and
 * abandoned; the hundredth card is not something anybody scrolls to, and
 * fetching it costs the same egress as the first.
 */
export async function listCountdowns(limit = 60): Promise<Countdown[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());
  cacheTag(tags.examList());

  // Today rather than `now()`: `last_date` is a date, not an instant, and a
  // job closing today is still open today.
  const today = new Date().toISOString().slice(0, 10);

  const [jobs, exams] = await Promise.all([
    publicDb()
      .from("jobs")
      .select("slug, title, last_date, organization:organizations ( short_name, name )")
      .eq("status", "published")
      .gte("last_date", today)
      .order("last_date", { ascending: true })
      .limit(limit),
    publicDb()
      .from("exams")
      .select("slug, name, short_name, next_event_at, next_event_label")
      .eq("is_active", true)
      .not("next_event_at", "is", null)
      .gte("next_event_at", new Date().toISOString())
      .order("next_event_at", { ascending: true })
      .limit(limit),
  ]);

  const jobRows = unwrap("listCountdowns.jobs", jobs) as unknown as JobRow[];
  const examRows = unwrap("listCountdowns.exams", exams) as unknown as ExamRow[];

  const items: Countdown[] = [
    ...jobRows.map((row) => ({
      key: `job:${row.slug}`,
      slug: row.slug,
      kind: "job" as const,
      title: row.title,
      label: "Applications close",
      // A closing date is a day, and the day ends at 23:59:59 IST. Treating it
      // as midnight *at the start* of that day would show the deadline as
      // passed for the whole of the last day people can still apply — the
      // single most damaging off-by-one this feature could have.
      at: endOfDayIst(row.last_date),
      organization: row.organization?.short_name ?? row.organization?.name ?? null,
      href: `/jobs/${row.slug}`,
    })),
    ...examRows.map((row) => ({
      key: `exam:${row.slug}`,
      slug: row.slug,
      kind: "exam" as const,
      title: row.short_name ?? row.name,
      label: row.next_event_label ?? "Next event",
      at: row.next_event_at,
      organization: null,
      href: `/updates?q=${encodeURIComponent(row.short_name ?? row.name)}`,
    })),
  ];

  return items.sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit);
}

/** One countdown by its slug, for the share page. Jobs first, then exams. */
export async function getCountdown(slug: string): Promise<Countdown | null> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.job(slug));
  cacheTag(tags.exam(slug));

  const { data: job } = await publicDb()
    .from("jobs")
    .select("slug, title, last_date, organization:organizations ( short_name, name )")
    .eq("slug", slug)
    .eq("status", "published")
    .not("last_date", "is", null)
    .maybeSingle();

  if (job) {
    const row: JobRow = job;
    return {
      key: `job:${row.slug}`,
      slug: row.slug,
      kind: "job",
      title: row.title,
      label: "Applications close",
      at: endOfDayIst(row.last_date),
      organization: row.organization?.short_name ?? row.organization?.name ?? null,
      href: `/jobs/${row.slug}`,
    };
  }

  const { data: exam } = await publicDb()
    .from("exams")
    .select("slug, name, short_name, next_event_at, next_event_label")
    .eq("slug", slug)
    .not("next_event_at", "is", null)
    .maybeSingle();

  if (!exam?.next_event_at) return null;

  return {
    key: `exam:${exam.slug}`,
    slug: exam.slug,
    kind: "exam",
    title: exam.short_name ?? exam.name,
    label: exam.next_event_label ?? "Next event",
    at: exam.next_event_at,
    organization: null,
    href: `/updates?q=${encodeURIComponent(exam.short_name ?? exam.name)}`,
  };
}
