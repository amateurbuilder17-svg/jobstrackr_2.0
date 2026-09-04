import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserStats, listUsers } from "@/lib/db/queries/admin-people";
import { formatDate } from "@/lib/format/deadline";
import { Pager } from "../pager";
import {
  Empty,
  SearchForm,
  Section,
  since,
  Stat,
  StatRow,
  Td,
  TableFrame,
  Th,
  THead,
} from "../ui";

type SearchParams = Promise<{ page?: string; q?: string }>;

/**
 * Registered accounts.
 *
 * Six columns, and the list is the privacy policy rather than a layout choice.
 * `profiles` also holds an encrypted Aadhaar number, a PAN, a passport number,
 * a phone number, a date of birth and a postal address; none of them are on
 * this page, and — the part that matters — none of them are fetched and then
 * hidden. `admin_list_users` names its columns, so the other nine never leave
 * the database. A page that selects everything and renders six fields is one
 * "just show the raw row" away from a breach.
 *
 * The old page did `select id, user_id, email, full_name, created_at` over
 * every profile with no limit, plus a second unbounded read of
 * `education_qualifications` reduced in the browser to derive one badge.
 */
export default function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
        <Stats />
      </Suspense>

      <Section
        title="Accounts"
        hint="Newest first. Identity documents held on the profile are not read by this page."
      >
        <Suspense fallback={<div className="h-10" />}>
          <Search searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Table searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

async function Stats() {
  const stats = await getUserStats();

  return (
    <Section title="At a glance">
      <StatRow>
        <Stat label="Accounts" value={stats.totalUsers} />
        <Stat label="Today" value={stats.todayUsers} />
        <Stat label="Last 7 days" value={stats.weekUsers} />
        <Stat
          label="Onboarded"
          value={stats.onboardedUsers}
          hint={percent(stats.onboardedUsers, stats.totalUsers)}
        />
        <Stat label="AI calls today" value={stats.aiCallsToday} />
      </StatRow>
    </Section>
  );
}

async function Search({ searchParams }: { searchParams: SearchParams }) {
  const { q } = await searchParams;
  return (
    <div className="mt-3">
      <SearchForm action="/admin/users" value={q} placeholder="Search name or address" />
    </div>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page, q } = await searchParams;
  const result = await listUsers({ page: Number(page ?? 1), query: q });

  if (result.rows.length === 0) {
    return <Empty>{q ? "No account matches that." : "No accounts yet."}</Empty>;
  }

  return (
    <>
      <TableFrame minWidth="52rem">
        <THead>
          <Th>Name</Th>
          <Th width="15rem">Address</Th>
          <Th width="9rem">Qualification</Th>
          <Th align="right" width="5rem">
            AI calls
          </Th>
          <Th width="7rem">Joined</Th>
          <Th width="7rem">Last seen</Th>
        </THead>
        <tbody>
          {result.rows.map((user) => (
            <tr key={user.id} className="border-t border-line/60">
              <td className="max-w-0 px-3 py-2">
                <span className="block truncate font-medium text-ink">
                  {user.fullName ?? "—"}
                </span>
                {user.state ? (
                  <span className="block truncate text-2xs text-ink-3">{user.state}</span>
                ) : null}
              </td>
              <Td className="truncate text-ink-2">{user.email ?? "—"}</Td>
              <Td>
                {user.highestQualification ? (
                  <Badge>{user.highestQualification}</Badge>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Td>
              <Td align="right" className={user.aiCalls > 0 ? "text-ink" : "text-ink-3"}>
                {user.aiCalls.toLocaleString("en-IN")}
              </Td>
              <Td className="whitespace-nowrap text-ink-3">
                {formatDate(user.createdAt) ?? "—"}
              </Td>
              <Td className="whitespace-nowrap text-ink-3">{since(user.lastSignInAt)}</Td>
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <Pager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/admin/users"
        params={{ q }}
      />
    </>
  );
}

function percent(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${String(Math.round((part / whole) * 100))}% of accounts`;
}
