import Link from "next/link";
import { ClockIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { describeDeadline, type Deadline } from "@/lib/format/deadline";
import { OrganizationLogo } from "./organization-logo";

function getOrgTone(org?: string | null): string {
  const o = (org ?? "").toUpperCase();
  if (["IBPS", "MPSC", "UPSC", "SSC", "RRB", "NTA", "SBI"].some((k) => o.includes(k))) {
    return "border-[#fcdad3] dark:border-[#522929] bg-[#fdf0ed] dark:bg-[#341b1b] text-[#b9382c] dark:text-[#f87171]";
  }
  return "border-border bg-brand-soft text-brand-deep";
}

/**
 * The organisation's mark: its emblem where one is known, its initials where
 * one is not.
 *
 * The initials are not a loading state — they are the answer for most rows and
 * always will be. The 164 imported logos cover about 530 of 3,744
 * organisations, because the long tail is district offices and single-post
 * recruitments with no emblem anywhere to find. So the tile is drawn as a
 * finished thing and the image sits on top of it when there is one: nothing
 * shifts, nothing blinks, and a missing logo looks deliberate because it is.
 */
export function OrganizationBadge({
  org,
  logoPath,
  size = "md",
  className,
}: {
  org?: string | null;
  /**
   * `organizations.logo_path` — a path in the public `logos` bucket.
   *
   * `| undefined` is spelled out because `exactOptionalPropertyTypes` is on and
   * every caller reads it off an optional join: `job.organization?.logo_path`
   * is `undefined` when there is no organisation and `null` when it has no
   * logo. Both mean "initials", and neither should need a `?? null` at the
   * call site to say so.
   */
  logoPath?: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const display = (org ?? "EXAM").slice(0, 5).toUpperCase();
  const toneClass = getOrgTone(org);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-xl border font-extrabold tracking-tight",
        toneClass,
        size === "sm"
          ? "size-[clamp(2rem,7.5vw,2.25rem)] text-card-2xs"
          : "size-[clamp(2.5rem,9vw,2.75rem)] text-card-2xs",
        className,
      )}
    >
      {display}
      {logoPath ? <OrganizationLogo path={logoPath} /> : null}
    </span>
  );
}

export function DeadlineBadge({
  date,
  deadline: passedDeadline,
  className,
}: {
  date?: string | null;
  deadline?: Deadline;
  className?: string;
}) {
  const deadline = passedDeadline ?? describeDeadline(date ?? null);

  // Exact matching to image:
  // "Last day" (today / 0 days) -> solid dark crimson pill with white text
  // "2-3 days left" (urgent) -> soft pink/red pill with dark red text
  // "Soon" (warn) -> soft yellow pill
  // "Normal" -> muted
  let toneClass = "bg-muted text-muted-foreground";
  if (deadline.daysLeft === 0 || deadline.label.toLowerCase().includes("last day")) {
    toneClass = "bg-[#b92518] text-white";
  } else if (
    deadline.tone === "critical" ||
    (deadline.daysLeft !== null && deadline.daysLeft <= 3 && deadline.daysLeft > 0)
  ) {
    toneClass =
      "border border-[#fcdad3] dark:border-[#522929] bg-[#fdf0ed] dark:bg-[#341b1b] text-[#b92518] dark:text-[#fca5a5]";
  } else if (deadline.tone === "warn") {
    toneClass = "bg-warning-soft text-warning";
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-card-2xs font-bold tabular-nums",
        "sm:gap-1.5 sm:px-2.5 sm:py-1",
        toneClass,
        className,
      )}
    >
      <ClockIcon className="size-[clamp(0.75rem,2.9vw,0.875rem)] shrink-0" aria-hidden="true" />
      <span className="sr-only">Application deadline: </span>
      {deadline.label}
    </span>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  href,
  id,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  href?: string;
  id?: string;
}) {
  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 sm:mb-3.5 sm:gap-3">
      <div className="flex min-w-0 gap-2.5 sm:gap-3">
        <span aria-hidden="true" className="mt-0.5 w-[3px] shrink-0 rounded-full bg-brand" />
        <div className="min-w-0">
          <h2
            id={id}
            className="truncate text-card-lg font-extrabold tracking-tight text-foreground"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-card-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actionLabel && href ? (
        <Link
          href={href}
          className="shrink-0 rounded-lg px-1.5 py-1 text-card-sm font-bold text-brand transition-colors duration-200 hover:bg-brand-soft sm:px-2 sm:py-1.5"
        >
          {actionLabel} <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}

export function ProgressRing({
  value,
  total,
  label,
  size = "md",
}: {
  value: number;
  total: number;
  label: string;
  size?: "sm" | "md";
}) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  const isSm = size === "sm";

  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      <div
        className={cn(
          "relative",
          isSm ? "size-[clamp(2.25rem,8.5vw,2.5rem)]" : "size-[clamp(2.75rem,10vw,3rem)]",
        )}
      >
        <svg viewBox="0 0 48 48" className="size-full -rotate-90" aria-hidden="true">
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            strokeWidth={isSm ? "4.5" : "4"}
            className="stroke-border"
          />
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            strokeWidth={isSm ? "4.5" : "4"}
            strokeLinecap="round"
            className="stroke-brand transition-[stroke-dashoffset] duration-300 ease-out"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        </svg>
        <span
          className={cn(
            "absolute inset-0 grid place-items-center font-extrabold tabular-nums text-brand-deep",
            isSm ? "text-card-2xs" : "text-card-xs",
          )}
        >
          {value}/{total}
        </span>
      </div>
      <span className="text-[clamp(0.5625rem,2.2vw,0.59375rem)] font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
