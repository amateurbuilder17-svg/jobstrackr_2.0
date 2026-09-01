import Link from "next/link";
import { ClockIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { describeDeadline, type Deadline } from "@/lib/format/deadline";

function getOrgTone(org?: string | null): string {
  const o = (org ?? "").toUpperCase();
  if (["IBPS", "MPSC", "UPSC", "SSC", "RRB", "NTA", "SBI"].some((k) => o.includes(k))) {
    return "border-[#fcdad3] dark:border-[#522929] bg-[#fdf0ed] dark:bg-[#341b1b] text-[#b9382c] dark:text-[#f87171]";
  }
  return "border-border bg-brand-soft text-brand-deep";
}

export function OrganizationBadge({
  org,
  size = "md",
  className,
}: {
  org?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const display = (org ?? "EXAM").slice(0, 5).toUpperCase();
  const toneClass = getOrgTone(org);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-xl border font-extrabold tracking-tight",
        toneClass,
        size === "sm" ? "size-9 text-[10px]" : "size-11 text-[11px]",
        className,
      )}
    >
      {display}
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
  } else if (deadline.tone === "critical" || (deadline.daysLeft !== null && deadline.daysLeft <= 3 && deadline.daysLeft > 0)) {
    toneClass = "border border-[#fcdad3] dark:border-[#522929] bg-[#fdf0ed] dark:bg-[#341b1b] text-[#b92518] dark:text-[#fca5a5]";
  } else if (deadline.tone === "warn") {
    toneClass = "bg-warning-soft text-warning";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums shrink-0",
        toneClass,
        className,
      )}
    >
      <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
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
    <div className="mb-3.5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
      <div className="flex min-w-0 gap-3">
        <span aria-hidden="true" className="mt-0.5 w-[3px] shrink-0 rounded-full bg-brand" />
        <div className="min-w-0">
          <h2 id={id} className="truncate text-[17px] font-extrabold tracking-tight text-foreground">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actionLabel && href ? (
        <Link
          href={href}
          className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] font-bold text-brand transition-colors duration-200 hover:bg-brand-soft"
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
      <div className={cn("relative", isSm ? "size-10" : "size-12")}>
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
            isSm ? "text-[10px]" : "text-[11px]",
          )}
        >
          {value}/{total}
        </span>
      </div>
      <span className="text-[9.5px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}
