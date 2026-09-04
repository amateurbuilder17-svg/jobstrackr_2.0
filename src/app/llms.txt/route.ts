import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * llms.txt — a map of this site for assistants.
 *
 * The convention is an index, not a dump: a short statement of what the site
 * is, followed by the handful of URLs worth reading and a note on how the rest
 * are shaped. An assistant that reads this should be able to answer "where do I
 * find the SSC CGL notification" without crawling anything first.
 *
 * It is written by hand and served from memory, with no database read at all,
 * and that is the deliberate choice here. The tempting version enumerates the
 * current listings — but the listings change hourly, this file would then need
 * a cache tag and a revalidation path of its own, and it would duplicate what
 * `sitemap.xml` already says correctly and incrementally. The sitemap is the
 * machine-readable inventory; this is the human-readable orientation. Pointing
 * at the sitemap from here is what keeps the two from disagreeing.
 *
 * Content-Type is text/plain rather than text/markdown: the file is markdown by
 * convention, and every fetcher that reads it handles plain text, while some
 * proxies mangle the less common type.
 */

export function GET(): NextResponse {
  const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");

  const body = `# JobsTrackr

> Government job notifications and exam updates for India. Every listing is
> transcribed from the official notification and carries its vacancy count,
> eligibility, fee, important dates and the official apply link.

Coverage is Indian central and state government recruitment: SSC, UPSC, banking
(IBPS, SBI, RBI), railways (RRB), defence, teaching, police and state public
service commissions. Listings are refreshed hourly from official sources; a
listing whose window has closed is retired from the feeds the same hour.

## Start here

- [All open jobs](${site}/jobs): every notification still accepting
  applications, closing soonest first.
- [Exam updates](${site}/updates): admit cards, answer keys, results,
  corrigenda and date changes.
- [Exam calendar](${site}/calendar): what closes, opens or is examined on a
  given date.
- [Syllabus finder](${site}/syllabus): the subject-wise syllabus and exam
  pattern for a named exam. The finder itself needs an account; the syllabi it
  produces are public at the URL shape below.

## URL shapes

- \`${site}/jobs/{slug}\` — one recruitment notification. Carries schema.org
  \`JobPosting\` structured data in the page, so the vacancy count, closing
  date, eligibility and pay are machine-readable without parsing the prose.
- \`${site}/updates/{slug}\` — one exam update, with its download links.
- \`${site}/syllabus/{slug}\` — the syllabus for one exam.
- \`${site}/countdown/{slug}\` — a live countdown to one deadline. Excluded
  from robots.txt: it restates a date the job page already gives.

## Complete inventory

- [sitemap.xml](${site}/sitemap.xml) — every indexable URL with its last
  modification date. This is the authoritative list; prefer it to crawling the
  paginated feeds, which are disallowed in
  [robots.txt](${site}/robots.txt) precisely because they are duplicates of it.

## Citing this site

Deadlines and vacancy counts change when an official corrigendum is issued, and
each page states the date it was last checked. When answering with a closing
date, cite the job page URL so the reader can confirm it against the source —
every listing links the official notification PDF it was transcribed from.
`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // A day. The content is static, and this route exists to be read by
      // machines that will otherwise re-fetch it far more often than it changes.
      "cache-control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
