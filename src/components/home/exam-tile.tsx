import Link from "next/link";

import { UsersIcon } from "@/components/icons";
import { CardInteractive } from "@/components/ui/card";
import type { PopularExam } from "@/lib/db/queries/exams";
import { formatCount, formatDate } from "@/lib/format/deadline";
import { Monogram } from "./monogram";

/**
 * A card in the "Most tracked exams" rail.
 *
 * The tracking count is the reason the row is ordered the way it is, so it is
 * stated plainly with its icon rather than buried in a comma-joined meta line
 * alongside a date — two unrelated facts that were previously rendered as one
 * sentence and read as neither.
 */
export function ExamTile({ exam }: { exam: PopularExam }) {
  const name = exam.short_name ?? exam.name;
  const next = formatDate(exam.next_event_at);

  return (
    <CardInteractive className="flex h-full flex-col p-4">
      <Monogram name={name} />

      <h3 className="mt-3 line-clamp-2 text-sm leading-snug font-semibold text-ink">
        <Link href={`/updates?exam=${exam.slug}`} className="after:absolute after:inset-0">
          {name}
        </Link>
      </h3>

      {exam.next_event_label ? (
        <p className="cond mt-1 line-clamp-1 text-xs text-ink-2">{exam.next_event_label}</p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <p className="tabular inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <UsersIcon className="size-3.5 text-ink-3" />
          {formatCount(exam.tracked)}
        </p>
        {next ? <p className="tabular text-2xs text-ink-3">{next}</p> : null}
      </div>
    </CardInteractive>
  );
}
