import Link from "next/link";

import { ChevronRightIcon, ClockIcon, UsersIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardInteractive } from "@/components/ui/card";

export const metadata = { title: "Government jobs and exam updates" };

/**
 * Placeholder home page.
 *
 * The data layer is built but the project has no rows yet, so this renders
 * fixed content. It exists to exercise the design system — every token,
 * primitive and shell surface appears here — and it is replaced by the real
 * feed in Module 4.
 */

const SAMPLE = [
  {
    slug: "ssc-cgl-2026",
    title: "Combined Graduate Level Examination 2026",
    org: "Staff Selection Commission",
    location: "All India",
    vacancies: 17_727,
    daysLeft: 3,
    qualification: "Bachelor's degree in any discipline",
  },
  {
    slug: "rrb-group-d-2026",
    title: "Railway Recruitment Board Group D Recruitment",
    org: "Railway Recruitment Board",
    location: "All India",
    vacancies: 32_438,
    daysLeft: 18,
    qualification: "Class 10 pass or ITI",
  },
  {
    slug: "opsc-ae-2026",
    title: "Assistant Engineer (Civil) Recruitment",
    org: "Odisha Public Service Commission",
    location: "Odisha",
    vacancies: 212,
    daysLeft: 45,
    qualification: "B.E. / B.Tech in Civil Engineering",
  },
];

/** Urgency is a property of the deadline, so the tone is derived, never chosen. */
function deadlineTone(daysLeft: number) {
  if (daysLeft <= 3) return { tone: "critical" as const, label: `${String(daysLeft)}d left` };
  if (daysLeft <= 14) return { tone: "warn" as const, label: `${String(daysLeft)}d left` };
  return { tone: "neutral" as const, label: `${String(daysLeft)}d left` };
}

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 lg:px-6 lg:py-12">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-ink lg:text-4xl">
          Every government job, without the noise
        </h1>
        <p className="mt-3 max-w-prose text-ink-2">
          Notifications, deadlines and eligibility for Indian competitive exams — checked daily,
          and only the ones you can actually apply for.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" size="lg">
            Browse all jobs
          </Button>
          <Button size="lg">Check my eligibility</Button>
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">Closing soon</h2>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-0.5 text-sm font-medium text-accent hover:underline"
          >
            All jobs
            <ChevronRightIcon className="size-3.5" />
          </Link>
        </div>

        <ul className="mt-4 flex flex-col gap-3">
          {SAMPLE.map((job) => {
            const deadline = deadlineTone(job.daysLeft);
            return (
              <li key={job.slug}>
                <CardInteractive className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
                        {job.org}
                      </p>
                      <h3 className="mt-1 text-base font-semibold text-ink">
                        <Link
                          href={`/jobs/${job.slug}`}
                          className="after:absolute after:inset-0"
                        >
                          {job.title}
                        </Link>
                      </h3>
                    </div>
                    <Badge tone={deadline.tone} className="tabular shrink-0">
                      <ClockIcon className="size-3" />
                      {deadline.label}
                    </Badge>
                  </div>

                  <p className="mt-2 text-sm text-ink-2">{job.qualification}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
                    <span className="inline-flex items-center gap-1.5">
                      <UsersIcon className="size-3.5" />
                      <span className="tabular font-mono">
                        {job.vacancies.toLocaleString("en-IN")}
                      </span>
                      vacancies
                    </span>
                    <span>{job.location}</span>
                  </div>
                </CardInteractive>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
