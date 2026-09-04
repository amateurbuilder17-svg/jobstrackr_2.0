import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { removeLogoAction } from "@/lib/admin/actions";
import { getLogoCoverage, listOrganizations } from "@/lib/db/queries/admin-ops";
import { logoUrl } from "@/lib/db/storage";
import { Pager } from "../pager";
import { RowAction } from "../action-form";
import {
  Empty,
  FilterChips,
  SearchForm,
  Section,
  Stat,
  StatRow,
  Td,
  TableFrame,
  Th,
  THead,
} from "../ui";
import { LogoUpload } from "./logo-upload";

type SearchParams = Promise<{ page?: string; q?: string; show?: string }>;

const VIEWS = [
  { label: "Missing a logo", value: undefined },
  { label: "All organisations", value: "all" },
];

/**
 * Conducting-body logos.
 *
 * The old page kept logos in their own table keyed by a free-text name, and
 * matched a job's `department` string to one in the browser with a fuzzy
 * helper, on every render, to draw a 36 px badge. Here the logo belongs to the
 * organisation the job already points at, so there is no matching to do — the
 * badge reads `organizations.logo_path` and renders it.
 *
 * That makes "which bodies have no logo" a `where logo_path is null`, ordered
 * by published job count. The ordering is the useful part: a body with 400
 * listings and no logo is 400 pages showing initials, and one with a single
 * listing is not worth an afternoon. The top of page one is always the work
 * that pays.
 */
export default function AdminLogosPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
        <Coverage />
      </Suspense>

      <Section
        title="Organisations"
        hint="Ordered by published listings, so the badge that appears most often is first. Images are converted to a 128 px WebP in the browser before they are sent."
      >
        <Suspense fallback={<div className="h-16" />}>
          <Controls searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Table searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

async function Coverage() {
  const coverage = await getLogoCoverage();
  const missing = coverage.totalOrgs - coverage.withLogo;

  return (
    <Section title="Coverage">
      <StatRow>
        <Stat label="Organisations" value={coverage.totalOrgs} />
        <Stat label="With a logo" value={coverage.withLogo} />
        <Stat label="Without" value={missing} tone="warn" />
        {/*
          The figure that actually matters. Bodies without a logo are mostly
          long-tail ones with a listing or two, so "12% of organisations" and
          "78% of listings show a badge" are very different sentences about the
          same data — and only the second describes what a visitor sees.
        */}
        <Stat
          label="Listings with a badge"
          value={
            coverage.jobsTotal === 0
              ? "—"
              : `${String(Math.round((coverage.jobsWithLogo / coverage.jobsTotal) * 100))}%`
          }
          hint={`${coverage.jobsWithLogo.toLocaleString("en-IN")} of ${coverage.jobsTotal.toLocaleString("en-IN")}`}
        />
      </StatRow>
    </Section>
  );
}

async function Controls({ searchParams }: { searchParams: SearchParams }) {
  const { q, show } = await searchParams;

  return (
    <>
      <div className="mt-3">
        <SearchForm
          action="/admin/logos"
          value={q}
          placeholder="Search organisations"
          hidden={{ show }}
        />
      </div>
      <FilterChips
        basePath="/admin/logos"
        param="show"
        current={show}
        options={VIEWS}
        extra={{ q }}
      />
    </>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page, q, show } = await searchParams;

  const result = await listOrganizations({
    page: Number(page ?? 1),
    query: q,
    missingOnly: show !== "all",
  });

  if (result.rows.length === 0) {
    return (
      <Empty>
        {show === "all"
          ? "No organisation matches."
          : "Every organisation has a logo. Nothing left to upload."}
      </Empty>
    );
  }

  return (
    <>
      <TableFrame minWidth="48rem">
        <THead>
          <Th width="3rem">
            <span className="sr-only">Logo</span>
          </Th>
          <Th>Organisation</Th>
          <Th align="right" width="6rem">
            Listings
          </Th>
          <Th width="22rem">
            <span className="sr-only">Upload</span>
          </Th>
        </THead>
        <tbody>
          {result.rows.map((org) => (
            <tr key={org.id} className="border-t border-line/60">
              <Td>
                {org.logoPath ? (
                  /* An already-128px WebP on a noindex admin page. The image
                     loader would bill a transform to resize a file the upload
                     already sized, once, offline. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl(org.logoPath)}
                    alt=""
                    width={32}
                    height={32}
                    className="size-8 rounded border border-line bg-surface-2 object-contain"
                  />
                ) : (
                  <span className="flex size-8 items-center justify-center rounded border border-dashed border-line text-2xs text-ink-3">
                    {(org.shortName ?? org.name).slice(0, 2).toUpperCase()}
                  </span>
                )}
              </Td>
              <td className="max-w-0 px-3 py-2">
                <span className="block truncate font-medium text-ink">{org.name}</span>
                <span className="block truncate text-2xs text-ink-3">
                  {org.shortName ?? org.slug}
                </span>
              </td>
              <Td align="right" className={org.jobCount > 0 ? "text-ink" : "text-ink-3"}>
                {org.jobCount.toLocaleString("en-IN")}
              </Td>
              <Td>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <LogoUpload orgId={org.id} slug={org.slug} name={org.name} />
                  {org.logoPath ? (
                    <RowAction
                      action={removeLogoAction}
                      fields={{ orgId: org.id, slug: org.slug }}
                      label="Remove"
                      variant="danger"
                      confirm={`Remove the logo for ${org.name}? Cards fall back to initials.`}
                    />
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <Pager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/admin/logos"
        params={{ q, show }}
      />
    </>
  );
}
