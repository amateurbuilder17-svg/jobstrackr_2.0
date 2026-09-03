"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, SparkIcon } from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import {
  EVENT_LABELS,
  examDateOf,
  hasSecondPhase,
  isStale,
  phaseOf,
  resultDateOf,
  type ExamStatusReport,
  type StatusPhase,
} from "@/lib/exams/report";

interface Props {
  attemptId: string;
  name: string;
  initial: ExamStatusReport | null;
}

/** Matches `COOLDOWN_SECONDS` in the route. The two must not drift apart. */
const COOLDOWN_SECONDS = 30;

interface RefreshResponse {
  ok: boolean;
  cached?: boolean;
  message?: string;
  retryAfter?: number;
  report?: ExamStatusReport;
}

function shortenPhaseName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("prelim")) return "Prelims";
  if (lower.includes("main")) return "Mains";
  if (lower.includes("tier 3") || lower.includes("tier iii")) return "Tier 3";
  if (lower.includes("tier 2") || lower.includes("tier ii")) return "Tier 2";
  if (lower.includes("tier 1") || lower.includes("tier i")) return "Tier 1";
  if (lower.includes("interview") || lower.includes("personality")) return "Interview";
  if (name.length > 20) return name.slice(0, 18) + "…";
  return name;
}

export function StatusPanel({ attemptId, name, initial }: Props) {
  const router = useRouter();
  const [report, setReport] = useState<ExamStatusReport | null>(initial);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function startCooldown(seconds: number) {
    if (timer.current) clearInterval(timer.current);
    setCooldown(seconds);
    timer.current = setInterval(() => {
      setCooldown((remaining) => {
        if (remaining <= 1) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
  }

  async function refresh() {
    if (pending || cooldown > 0) return;

    setPending(true);
    setNotice(null);

    try {
      const response = await fetch("/api/exam-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId, force: true }),
      });

      const data = (await response.json()) as RefreshResponse;

      if (data.report) setReport(data.report);

      if (!data.ok) {
        setNotice({ text: data.message ?? "Could not refresh just now.", bad: true });
        startCooldown(Math.min(data.retryAfter ?? COOLDOWN_SECONDS, 300));
        return;
      }

      setExpanded(true);
      startCooldown(COOLDOWN_SECONDS);

      if (data.cached) {
        setNotice({ text: "Already up to date.", bad: false });
      }

      router.refresh();
    } catch {
      setNotice({ text: "No connection. Try again when you are back online.", bad: true });
      startCooldown(10);
    } finally {
      setPending(false);
    }
  }

  const label = pending
    ? "Checking…"
    : cooldown > 0
      ? `Wait ${String(cooldown)}s`
      : report
        ? "Refresh status"
        : "Check status";

  return (
    <section className="border-t border-line/60 bg-gradient-to-b from-surface-2/40 via-surface-2/20 to-transparent p-4 sm:p-5 dark:from-surface-2/25 dark:to-transparent">
      {/* Header Band */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          <h4 className="cond text-2xs font-bold tracking-wider text-ink uppercase">
            AI Status Intelligence
          </h4>
        </div>
        {report ? (
          <span
            className="tabular text-[10px] font-medium text-ink-3 bg-surface/80 px-2.5 py-0.5 rounded-full border border-line/80 shadow-2xs dark:bg-surface/60"
            suppressHydrationWarning
          >
            Checked {timeAgo(report.refreshedAt)}
          </span>
        ) : null}
      </div>

      {report ? (
        <Summary
          report={report}
          expanded={expanded}
          name={name}
          onToggle={() => {
            setExpanded((open) => !open);
          }}
        />
      ) : (
        <p className="mt-2.5 text-xs leading-5 text-ink-3">
          No automated status report yet. Click below to verify admit cards, exam dates, and
          official announcements.
        </p>
      )}

      {expanded && report ? <Detail report={report} /> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          variant={report ? "secondary" : "primary"}
          onClick={() => void refresh()}
          disabled={pending || cooldown > 0}
          className="h-8.5 rounded-lg px-3.5 font-medium shadow-2xs"
        >
          <SparkIcon className="size-3.5 text-accent" />
          {label}
        </Button>

        {report && isStale(report.refreshedAt, report.confidence) ? (
          <span className="text-2xs text-ink-3">Last checked a while ago</span>
        ) : null}

        <span
          role="status"
          aria-live="polite"
          className={cn("text-2xs font-medium", notice?.bad ? "text-critical" : "text-ink-3")}
        >
          {notice?.text}
        </span>
      </div>
    </section>
  );
}

/* ── Collapsed ─────────────────────────────────────────────────────────── */

function Summary({
  report,
  expanded,
  onToggle,
  name,
}: {
  report: ExamStatusReport;
  expanded: boolean;
  onToggle: () => void;
  name: string;
}) {
  const [phase, setPhase] = useState<1 | 2>(1);
  const twoPhases = hasSecondPhase(report.report);
  const active = phaseOf(report.report, phase);

  return (
    <div className="mt-3">
      {/* Phase tabs */}
      {twoPhases ? (
        <div
          className="inline-flex rounded-xl border border-line/70 bg-surface-2/80 p-1 gap-1 shadow-2xs dark:border-white/10 dark:bg-surface-3/50"
          role="tablist"
          aria-label={`Stages of ${name}`}
        >
          {([1, 2] as const).map((n) => {
            const stage = phaseOf(report.report, n);
            return (
              <button
                key={n}
                type="button"
                role="tab"
                aria-selected={phase === n}
                onClick={() => {
                  setPhase(n);
                }}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-semibold transition-all",
                  phase === n
                    ? "bg-surface text-ink shadow-2xs dark:bg-surface-2 dark:text-ink"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                {stage?.name ?? `Stage ${String(n)}`}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Phase facts (admit card, exam date, result) */}
      {active ? <PhaseFacts report={report} phase={phase} data={active} /> : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
      >
        <span>{expanded ? "Hide detailed breakdown" : "Show detailed breakdown"}</span>
        <ChevronRightIcon
          className={cn("size-3.5 transition-transform duration-200", expanded && "rotate-90")}
        />
      </button>
    </div>
  );
}

/* ── Expanded ──────────────────────────────────────────────────────────── */

function Detail({ report }: { report: ExamStatusReport }) {
  const twoPhases = hasSecondPhase(report.report);
  const today = useToday();

  return (
    <div className="mt-4.5 flex flex-col gap-4.5">
      {/* AI summary text */}
      {report.report.summary ? (
        <div className="rounded-xl border border-line/70 bg-surface/90 p-3 shadow-2xs dark:border-white/5 dark:bg-surface/60">
          <p className="text-xs leading-relaxed text-ink-2">{report.report.summary}</p>
        </div>
      ) : null}

      {report.report.events.length > 0 ? (
        <Section title="Key dates timeline">
          <ol className="relative ml-2 flex flex-col gap-3 border-l-2 border-line/80 pl-4">
            {[...report.report.events]
              .sort((a, b) => a.date.localeCompare(b.date))
              .filter((ev, i, arr) => i === 0 || ev.date >= (arr[i - 1]?.date ?? ev.date))
              .map((event) => {
                const days = today === null ? null : daysUntilFrom(today, event.date);
                const ahead = days !== null && days >= 0;

                return (
                  <li
                    key={`${event.type}-${event.date}-${String(event.phase ?? 0)}`}
                    className="relative"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-surface dark:ring-surface",
                        ahead ? "bg-accent" : "bg-line-strong",
                      )}
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-medium text-ink-2">
                        {event.phase !== null && twoPhases ? (
                          <>
                            {shortenPhaseName(
                              phaseOf(report.report, event.phase === 2 ? 2 : 1)?.name ?? "",
                            )}
                            {" · "}
                          </>
                        ) : null}
                        {EVENT_LABELS[event.type]}
                      </span>
                      <span className="tabular shrink-0 text-right text-xs sm:text-sm font-bold text-ink">
                        {formatDate(event.date)}
                        {event.certainty === "low" ? (
                          <span className="ml-1 text-2xs font-normal text-ink-3">
                            (expected)
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {days !== null ? (
                      <p className="tabular text-[11px] font-medium text-ink-3 mt-0.5">
                        {days === 0
                          ? "today"
                          : ahead
                            ? `in ${String(days)} ${days === 1 ? "day" : "days"}`
                            : `${String(Math.abs(days))} ${Math.abs(days) === 1 ? "day" : "days"} ago`}
                      </p>
                    ) : null}
                  </li>
                );
              })}
          </ol>
        </Section>
      ) : null}

      {report.report.updates.length > 0 ? (
        <Section title="Latest announcements">
          <ul className="flex flex-col gap-2">
            {report.report.updates.map((line) => (
              <li
                key={line}
                className="rounded-xl border border-line/70 border-l-2 border-l-accent/70 bg-surface/90 p-3 text-xs leading-relaxed text-ink-2 shadow-2xs dark:border-white/5 dark:bg-surface/60"
              >
                {line}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.report.recommendations.length > 0 ? (
        <Section title="Recommended next steps">
          <ul className="flex flex-col gap-2 rounded-xl border border-accent-line/80 bg-gradient-to-br from-accent-soft/90 to-accent-soft/40 p-3.5 sm:p-4 shadow-2xs">
            {report.report.recommendations.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-2"
              >
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.sources.length > 0 ? (
        <Section title="Official sources">
          <ul className="flex flex-wrap gap-2">
            {report.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-56 items-center gap-1.5 rounded-full border border-line/80 bg-surface/90 px-3 py-1 text-2xs font-medium text-ink-2 shadow-2xs hover:border-line-strong hover:text-ink dark:border-white/10 dark:bg-surface/60"
                >
                  <ExternalLinkIcon className="size-3 shrink-0 text-ink-3" />
                  <span className="truncate">{source.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-[11px] leading-4 text-ink-3">
        Researched automatically by {report.model}
        {report.grounded ? " with real-time web verification" : ""}. Always verify details on
        the conducting body&rsquo;s official portal.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="cond mb-2.5 flex items-center gap-2 text-2xs font-bold tracking-wider text-ink-3 uppercase">
        <span>{title}</span>
        <span className="h-px flex-1 bg-line/80" aria-hidden />
      </h5>
      {children}
    </div>
  );
}

function PhaseFacts({
  report,
  phase,
  data,
}: {
  report: ExamStatusReport;
  phase: 1 | 2;
  data: StatusPhase;
}) {
  const examDate = examDateOf(report.report, phase);
  const resultDate = resultDateOf(report.report, phase);

  return (
    <dl className="flex flex-col divide-y divide-line/60 rounded-xl border border-line/70 bg-surface/90 shadow-2xs overflow-hidden dark:border-white/5 dark:bg-surface/60">
      <Fact
        term="Admit card"
        value={data.admitCardAvailable ? "Out now" : "Not out yet"}
        tone={data.admitCardAvailable ? "good" : "neutral"}
        href={data.admitCardLink}
        hrefLabel="Download"
      />
      <Fact
        term="Exam date"
        value={formatDate(examDate) ?? "Not announced"}
        tone={examDate ? "accent" : "neutral"}
        detail={data.examDetails}
      />
      <Fact
        term="Result"
        value={
          data.resultAvailable ? "Declared" : (formatDate(resultDate) ?? "Not declared yet")
        }
        tone={data.resultAvailable ? "good" : "neutral"}
        href={data.resultLink}
        hrefLabel="Check"
      />
    </dl>
  );
}

function Fact({
  term,
  value,
  tone,
  detail,
  href,
  hrefLabel,
}: {
  term: string;
  value: string;
  tone: "neutral" | "accent" | "good";
  detail?: string | null;
  href?: string | null;
  hrefLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <dt className="cond shrink-0 text-2xs font-bold tracking-wider text-ink-3 uppercase">
        {term}
      </dt>
      <dd className="flex min-w-0 items-center gap-2 text-right">
        {detail ? (
          <span className="truncate text-xs text-ink-3 font-medium">{detail}</span>
        ) : null}
        <Badge tone={tone} className="tabular font-medium shadow-2xs">
          {value}
        </Badge>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 text-xs font-semibold text-accent hover:underline"
          >
            {hrefLabel}
          </a>
        ) : null}
      </dd>
    </div>
  );
}

/* ── Time ──────────────────────────────────────────────────────────────── */

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((then - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
