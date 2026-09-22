import Link from "next/link";

import type { HubItem, HubPage } from "@/lib/db/queries/hubs";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format/deadline";
import { decodeEntities } from "@/lib/format/text";
import {
  HUB_PAGE_SIZE,
  hubPageCount,
  hubPagePath,
  pagerWindow,
  type Hub,
} from "@/lib/hubs/catalog";
import { breadcrumbJsonLd } from "@/lib/seo/site-jsonld";
import { CATEGORY_LABELS } from "@/lib/updates/categories";

/**
 * One page of a hub: a heading, a plain list of links, and a pager.
 *
 * Deliberately not the job and update cards. A hub exists to be walked by a
 * crawler and skimmed by a person arriving from a search for "railway jobs",
 * and fifty cards are several times the bytes of fifty rows — bytes that are
 * billed as ISR writes every time the page re-renders. The rows are the
 * format this audience already reads on every government results site: title,
 * employer, date.
 *
 * Everything printed is fixed by the data. There is no "3 days left" here:
 * text that depends on today's date changes the page every day, which turns a
 * free, unchanged revalidation into a billed write. The detail page is where
 * the live countdown is.
 *
 * A Server Component with no client code, so the route ships no JavaScript of
 * its own.
 */
export function HubView({ hub, page, result }: { hub: Hub; page: number; result: HubPage }) {
  const last = hubPageCount(result.total);
  const first = (page - 1) * HUB_PAGE_SIZE + 1;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <script
        type="application/ld+json"
        // Built from the catalogue and typed columns, not from user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd(env.NEXT_PUBLIC_SITE_URL, [
              { name: hub.parent.name, path: hub.parent.path },
              { name: page > 1 ? `${hub.label}, page ${String(page)}` : hub.label },
            ]),
          ),
        }}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline underline-offset-4">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          href={hub.parent.path}
          className="hover:text-ink hover:underline underline-offset-4"
        >
          {hub.parent.name}
        </Link>
      </nav>

      <h1 className="mt-3 font-cond text-2xl font-bold tracking-tight text-balance text-ink sm:text-3xl">
        {hub.heading}
        {page > 1 ? <span className="text-ink-3"> — page {page}</span> : null}
      </h1>
      <p className="mt-3 leading-relaxed text-ink-2">{hub.description}</p>

      {result.items.length > 0 ? (
        <>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-ink-3 tabular">
            {result.total <= result.items.length
              ? `${String(result.total)} listed`
              : `${String(first)}–${String(first + result.items.length - 1)} of ${String(result.total)}`}
          </p>
          <ol className="mt-2 divide-y divide-line border-y border-line">
            {result.items.map((item) => (
              <HubRow key={`${item.kind}:${item.slug}`} item={item} />
            ))}
          </ol>
          <HubPager hub={hub} page={page} last={last} />
        </>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="font-semibold text-ink">Nothing listed here right now</p>
          <p className="mt-1 text-sm text-ink-2">
            New notifications appear here as they are published.
          </p>
          <Link
            href="/jobs"
            className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
          >
            See the jobs open now
          </Link>
        </div>
      )}
    </div>
  );
}

function HubRow({ item }: { item: HubItem }) {
  const href = item.kind === "job" ? `/jobs/${item.slug}` : `/updates/${item.slug}`;

  const meta =
    item.kind === "job"
      ? [
          item.organization,
          item.lastDate
            ? `${item.closed ? "Closed" : "Last date"} ${formatDate(item.lastDate) ?? ""}`.trim()
            : null,
        ]
      : [
          item.category ? CATEGORY_LABELS[item.category] : null,
          item.organization,
          formatDate(item.date),
        ];

  return (
    <li className="py-3">
      {/* Not prefetched: fifty links entering the viewport at once would be
          fifty route prefetches. See the note in `JobCard`. */}
      <Link
        href={href}
        prefetch={false}
        className="font-semibold leading-snug text-ink underline-offset-4 hover:text-brand hover:underline"
      >
        {decodeEntities(item.title)}
      </Link>
      <p className="mt-1 text-xs text-ink-3">{meta.filter(Boolean).join(" · ")}</p>
    </li>
  );
}

function HubPager({ hub, page, last }: { hub: Hub; page: number; last: number }) {
  if (last <= 1) return null;

  const link =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2";

  return (
    <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <Link href={hubPagePath(hub, page - 1)} rel="prev" prefetch={false} className={link}>
          ← Newer
        </Link>
      ) : null}
      {pagerWindow(page, last).map((n, i) =>
        n === null ? (
          <span key={`gap-${String(i)}`} className="px-1 text-ink-3" aria-hidden="true">
            …
          </span>
        ) : n === page ? (
          <span
            key={n}
            aria-current="page"
            className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-ink px-3 text-sm font-semibold text-surface"
          >
            {n}
          </span>
        ) : (
          <Link key={n} href={hubPagePath(hub, n)} prefetch={false} className={link}>
            {n}
          </Link>
        ),
      )}
      {page < last ? (
        <Link href={hubPagePath(hub, page + 1)} rel="next" prefetch={false} className={link}>
          Older →
        </Link>
      ) : null}
    </nav>
  );
}
