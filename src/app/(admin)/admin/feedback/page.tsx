import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { setFeedbackStatusAction } from "@/lib/admin/actions";
import {
  asFeedbackKind,
  asFeedbackStatus,
  getFeedbackCounts,
  listFeedback,
  type FeedbackRow,
} from "@/lib/db/queries/admin-feedback";
import { FEEDBACK_KINDS, FEEDBACK_LABELS } from "@/lib/feedback/kinds";
import { formatDateTime } from "@/lib/format/deadline";
import { RowAction } from "../action-form";
import { Pager } from "../pager";
import { Empty, FilterChips, SearchForm, Section, Stat, StatRow } from "../ui";

type SearchParams = Promise<{
  page?: string;
  status?: string;
  kind?: string;
  q?: string;
}>;

/**
 * Suggestions and grievances.
 *
 * Cards rather than a table, and that is the one real design decision here. The
 * content of a row is a paragraph somebody wrote — up to 2,000 characters — and
 * every other admin table on this site truncates its long column to one line.
 * Truncating this one would hide the only part that matters and turn the page
 * into a list of timestamps you have to click through.
 *
 * Reads go through RLS rather than the secret key: `suggestions_owner_select`
 * already grants an admin every row, so there is nothing here the ordinary
 * session client cannot see. Only the status change needs elevation, and it
 * gets exactly that and no more — an admin can move a submission along, and
 * cannot edit what was written.
 */
export default function AdminFeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
        <Counts />
      </Suspense>

      <Section
        title="Inbox"
        hint="Newest first. Anonymous submissions are supported and normal — the form never required an address."
      >
        <Suspense fallback={<div className="h-20" />}>
          <Controls searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <List searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

async function Counts() {
  const counts = await getFeedbackCounts();

  return (
    <Section title="At a glance">
      <StatRow>
        <Stat label="Open" value={counts.open} tone="warn" />
        {/*
          The number to act on today: something is reported broken and nobody
          has looked. Migration 0029 gave this its own partial index for the
          same reason — it is the query that matters, not a derived curiosity.
        */}
        <Stat
          label="Open grievances"
          value={counts.openGrievances}
          hint="something is reported broken"
          tone="critical"
        />
        <Stat label="Triaged" value={counts.triaged} />
        <Stat label="Resolved" value={counts.resolved} />
        <Stat label="Spam" value={counts.spam} />
      </StatRow>
    </Section>
  );
}

async function Controls({ searchParams }: { searchParams: SearchParams }) {
  const { status, kind, q } = await searchParams;

  return (
    <>
      <div className="mt-3">
        <SearchForm
          action="/admin/feedback"
          value={q}
          placeholder="Search message or address"
          hidden={{ status, kind }}
        />
      </div>

      <FilterChips
        basePath="/admin/feedback"
        param="status"
        current={status}
        options={[
          { label: "All", value: undefined },
          { label: "Open", value: "open" },
          { label: "Triaged", value: "triaged" },
          { label: "Resolved", value: "resolved" },
          { label: "Spam", value: "spam" },
        ]}
        extra={{ kind, q }}
      />

      <FilterChips
        basePath="/admin/feedback"
        param="kind"
        current={kind}
        options={[
          { label: "Both kinds", value: undefined },
          { label: "Grievances", value: "grievance" },
          { label: "Suggestions", value: "suggestion" },
        ]}
        extra={{ status, q }}
      />
    </>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const { page, status, kind, q } = await searchParams;

  const result = await listFeedback({
    page: Number(page ?? 1),
    status: asFeedbackStatus(status),
    kind: asFeedbackKind(kind),
    query: q,
  });

  if (result.rows.length === 0) {
    return <Empty>Nothing matches. An empty open queue is the goal, not a bug.</Empty>;
  }

  return (
    <>
      <ul className="mt-3 grid gap-3 lg:grid-cols-2">
        {result.rows.map((item) => (
          <Card key={item.id} item={item} />
        ))}
      </ul>

      <Pager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/admin/feedback"
        params={{ status, kind, q }}
      />
    </>
  );
}

function Card({ item }: { item: FeedbackRow }) {
  const grievance = item.kind === "grievance";
  const open = item.status === "open";
  // Narrowed rather than cast. `kind` is a `text` column behind a check
  // constraint, so a value added to that constraint later would be a real string
  // this build has never heard of — it renders as itself instead of crashing on
  // a lookup that a cast had promised would succeed.
  const known = FEEDBACK_KINDS.find((k) => k === item.kind);
  const label = known ? FEEDBACK_LABELS[known].label : item.kind;

  return (
    <li
      className={[
        "flex flex-col rounded-lg border bg-surface p-3",
        // One accent, on the left edge, and only while it is still open. A card
        // that stays coloured after it has been dealt with makes the queue look
        // permanently on fire and trains everyone to stop seeing the colour.
        open && grievance
          ? "border-critical/30 border-l-2 border-l-critical"
          : open
            ? "border-warn/30 border-l-2 border-l-warn"
            : "border-line",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-ink">
          {item.email ?? <span className="text-ink-3 italic">no address given</span>}
          {item.fromAccount ? (
            <span className="ml-1.5 text-2xs font-normal text-ink-3">· signed in</span>
          ) : null}
        </span>

        <span className="flex shrink-0 gap-1">
          <Badge tone={grievance ? "critical" : "accent"}>{label}</Badge>
          <Badge tone={open ? "warn" : item.status === "resolved" ? "good" : "neutral"}>
            {item.status}
          </Badge>
        </span>
      </div>

      <p className="mt-0.5 text-2xs text-ink-3 tabular">{formatDateTime(item.createdAt)}</p>

      {/*
        `whitespace-pre-wrap` because people write in paragraphs and lists, and
        collapsing that into one block loses the structure they meant. `break-words`
        because a 2,000-character message can contain an unbroken URL, and one of
        those overflows the card and pushes the whole grid sideways.
      */}
      <p className="mt-2 flex-1 rounded-md border border-line bg-surface-2 p-2.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-2">
        {item.message}
      </p>

      <div className="mt-2.5 flex flex-wrap justify-end gap-1">
        {/*
          The buttons offered are the moves that make sense from here, so the row
          cannot be set to the state it is already in. Triage is skipped once
          something is resolved — reopening is what the Open button is for.
        */}
        {item.status !== "resolved" ? (
          <RowAction
            action={setFeedbackStatusAction}
            fields={{ id: item.id, status: "resolved" }}
            label="Resolve"
            variant="secondary"
          />
        ) : null}

        {open ? (
          <RowAction
            action={setFeedbackStatusAction}
            fields={{ id: item.id, status: "triaged" }}
            label="Triage"
          />
        ) : null}

        {item.status !== "open" ? (
          <RowAction
            action={setFeedbackStatusAction}
            fields={{ id: item.id, status: "open" }}
            label="Reopen"
          />
        ) : null}

        {item.status !== "spam" ? (
          <RowAction
            action={setFeedbackStatusAction}
            fields={{ id: item.id, status: "spam" }}
            label="Spam"
            confirm="Mark this as spam? It stays in the table and can be reopened."
          />
        ) : null}
      </div>
    </li>
  );
}
