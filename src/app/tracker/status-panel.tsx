"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CheckIcon, ChevronRightIcon, ExternalLinkIcon } from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import {
  EVENT_LABELS,
  EXAM_STAGES,
  STAGE_LABELS,
  examDateOf,
  hasSecondPhase,
  isConfident,
  isStale,
  phaseOf,
  progressOf,
  resultDateOf,
  type ExamStage,
  type ExamStatusReport,
  type StatusPhase,
} from "@/lib/exams/report";

/**
 * What the AI knows about one tracked exam, and the button that asks again.
 *
 * ## What this replaces
 *
 * The old app's version of this was a 1,321-line card. Most of that was not
 * layout: it was eleven helper functions guessing which shape a cached answer
 * had been stored in, a forty-entry list of phrases like "admit card link
 * activated" used to second-guess a boolean, and the same URL filter repeated
 * at a dozen render sites. All of it now happens once, on the way into the
 * database, so what is left here is display.
 *
 * ## Two decisions worth knowing about
 *
 * **Collapsed by default, and rendered from the cache.** The panel shows the
 * stored answer immediately — no fetch on mount, ever. The old card did the
 * same and it is the single most important thing about this feature's cost: a
 * page with eight tracked exams on it makes zero model calls to render.
 *
 * **The refresh button tells the truth about waiting.** Its cooldown is the
 * server's cooldown, so it never offers a refresh that would be refused, and a
 * refusal that carries a stale answer shows the answer rather than an error.
 *
 * ## Why the three lists look different from each other
 *
 * A report carries dates, news and advice, and they were all rendered as `<li>`
 * in `text-xs text-ink-2` — three kinds of information in one grey column, which
 * is the same as printing none of them. Dates are now a timeline with the
 * figures set in the ink the exam's own name uses; news items are boxed, one per
 * card, because each is a separate event; advice is a checklist. The reader can
 * tell which is which before reading a word, which is the whole job.
 */

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

export function StatusPanel({ attemptId, name, initial }: Props) {
  const router = useRouter();
  const [report, setReport] = useState<ExamStatusReport | null>(initial);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  // Tone travels with the text. "Already up to date" and "that is all ten
  // refreshes for today" are both notices, and rendering the first one in the
  // critical colour would report success as a failure.
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
        // Forced: pressing a button labelled Refresh and being handed
        // yesterday's answer back is not a refresh. The server still decides
        // whether that is affordable.
        body: JSON.stringify({ attemptId, force: true }),
      });

      const data = (await response.json()) as RefreshResponse;

      // A refusal may still carry the cached answer — see the quota branch in
      // the route. Showing it is better than blanking the panel.
      if (data.report) setReport(data.report);

      if (!data.ok) {
        setNotice({ text: data.message ?? "Could not refresh just now.", bad: true });
        startCooldown(Math.min(data.retryAfter ?? COOLDOWN_SECONDS, 300));
        return;
      }

      setExpanded(true);
      startCooldown(COOLDOWN_SECONDS);

      // The server answered from the shared cache — someone else asked about
      // this exam minutes ago. Saying so is the difference between "the button
      // is broken" and "there is nothing new".
      if (data.cached) {
        setNotice({ text: "Already up to date.", bad: false });
      }

      // A refresh can move the row itself — "Tracking" to "Admit card out", a
      // blank exam date to a real one. Those are rendered by the Server
      // Component above this one, so without a refresh the panel would say the
      // admit card is out beside a badge still reading "Tracking". This is a
      // soft refresh: the tree re-renders from the server, and the state in
      // this component survives it.
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
    <section className="border-t border-line bg-surface-2/40 px-4 py-3">
      {/* A band with its own name on it. Everything above this line is what the
          person typed; everything below it is what a model wrote, and the two
          should never be mistaken for each other. */}
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="cond text-2xs font-semibold tracking-wider text-ink-3 uppercase">
          Status check
        </h4>
        {report ? (
          <span className="tabular text-2xs text-ink-3" suppressHydrationWarning>
            {timeAgo(report.refreshedAt)}
          </span>
        ) : null}
      </div>

      {report ? (
        <Summary
          report={report}
          expanded={expanded}
          onToggle={() => {
            setExpanded((open) => !open);
          }}
        />
      ) : (
        <p className="mt-2 text-xs leading-5 text-ink-3">
          No status yet. Check for the admit card, exam date and result.
        </p>
      )}

      {expanded && report ? <Detail report={report} name={name} /> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={report ? "secondary" : "primary"}
          onClick={() => void refresh()}
          disabled={pending || cooldown > 0}
        >
          {label}
        </Button>

        {report && isStale(report.refreshedAt, report.confidence) ? (
          <span className="text-2xs text-ink-3">Last checked a while ago</span>
        ) : null}

        {/* Assertive would interrupt a screen reader mid-sentence for what is,
            most of the time, "wait 20 seconds". */}
        <span
          role="status"
          aria-live="polite"
          className={cn("text-2xs", notice?.bad ? "text-critical" : "text-ink-3")}
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
}: {
  report: ExamStatusReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stage = report.report.stage;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={toneForStage(stage)}>{STAGE_LABELS[stage]}</Badge>

        {!isConfident(report.confidence) ? (
          <Badge tone="warn" title="The sources for this were thin or out of date.">
            Uncertain
          </Badge>
        ) : null}

        {!report.grounded ? (
          <Badge tone="neutral" title="Answered without a live web search.">
            Not searched
          </Badge>
        ) : null}
      </div>

      <StageRail stage={stage} report={report} />

      {report.report.summary ? (
        <p className={cn("mt-2.5 text-sm leading-6 text-ink-2", !expanded && "line-clamp-3")}>
          {report.report.summary}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-0.5 text-2xs font-semibold text-accent hover:underline"
      >
        {expanded ? "Hide details" : "Show details"}
        <ChevronRightIcon
          className={cn(
            "size-3.5 transition-transform duration-(--duration-fast)",
            expanded && "rotate-90",
          )}
        />
      </button>
    </div>
  );
}

/**
 * The seven stages of an exam as seven segments, rather than as one filled bar.
 *
 * `progressOf` already derives a percentage from the stage's index, and a bar
 * drawn from it is honest but says nothing: 67% of what? A segment per stage
 * shows the sequence the exam actually moves through, and the filled count is
 * the same number the percentage was. The percentage stays on the ARIA node,
 * where a screen reader can use it.
 */
function StageRail({ stage, report }: { stage: ExamStage; report: ExamStatusReport }) {
  const reached = EXAM_STAGES.indexOf(stage);

  return (
    <div
      className="mt-2.5 flex gap-1"
      role="progressbar"
      aria-valuenow={progressOf(report.report)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progress: ${STAGE_LABELS[stage]}`}
    >
      {EXAM_STAGES.map((step, i) => (
        <span
          key={step}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i <= reached ? "bg-accent" : "bg-surface-3",
          )}
        />
      ))}
    </div>
  );
}

function toneForStage(stage: ExamStage): "neutral" | "accent" | "warn" | "good" {
  if (stage === "result_declared") return "good";
  if (stage === "admit_card_available") return "warn";
  if (stage === "registration_open") return "accent";
  return "neutral";
}

/* ── Expanded ──────────────────────────────────────────────────────────── */

function Detail({ report, name }: { report: ExamStatusReport; name: string }) {
  const [phase, setPhase] = useState<1 | 2>(1);
  const twoPhases = hasSecondPhase(report.report);
  const active = phaseOf(report.report, phase);
  const today = useToday();

  return (
    <div className="mt-4 flex flex-col gap-4">
      {twoPhases ? (
        <div className="flex gap-1" role="tablist" aria-label={`Stages of ${name}`}>
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
                  "rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors",
                  phase === n
                    ? "bg-accent text-on-accent"
                    : "border border-line bg-surface text-ink-2 hover:bg-surface-2",
                )}
              >
                {stage?.name ?? `Stage ${String(n)}`}
              </button>
            );
          })}
        </div>
      ) : null}

      {active ? <PhaseFacts report={report} phase={phase} data={active} /> : null}

      {report.report.events.length > 0 ? (
        <Section title="Key dates">
          {/* A rail with a dot per date. The figures carry the ink the exam's
              own name uses, because on this page they are the answer. */}
          <ol className="flex flex-col gap-2.5 border-l border-line pl-4">
            {report.report.events.map((event) => {
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
                      "absolute top-1.5 -left-5 size-2 rounded-full",
                      ahead ? "bg-accent" : "bg-line-strong",
                    )}
                  />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs font-medium text-ink-2">
                      {EVENT_LABELS[event.type]}
                      {event.phase !== null && twoPhases ? (
                        <span className="text-ink-3">
                          {" "}
                          · {phaseOf(report.report, event.phase === 2 ? 2 : 1)?.name ?? ""}
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular shrink-0 text-right text-sm font-semibold text-ink">
                      {formatDate(event.date)}
                      {/* A low-confidence date is a guess and is labelled as
                          one. The old app rendered guesses and facts
                          identically. */}
                      {event.certainty === "low" ? (
                        <span className="ml-1 text-2xs font-normal text-ink-3">(expected)</span>
                      ) : null}
                    </span>
                  </div>
                  {days !== null ? (
                    <p className="tabular text-2xs text-ink-3">
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
        <Section title="Latest news">
          {/* One card per item. These are separate events that happened on
              separate days; run together as bare list items they read as one
              paragraph of hedging. */}
          <ul className="flex flex-col gap-1.5">
            {report.report.updates.map((line) => (
              <li
                key={line}
                className="rounded-md border border-line bg-surface px-3 py-2 text-xs leading-5 text-ink-2"
              >
                {line}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.report.recommendations.length > 0 ? (
        <Section title="What to do next">
          {/* Advice, so it looks like a checklist rather than like more prose. */}
          <ul className="flex flex-col gap-1.5 rounded-md border border-accent-line bg-accent-soft px-3 py-2.5">
            {report.report.recommendations.map((line) => (
              <li key={line} className="flex items-start gap-2 text-xs leading-5 text-ink-2">
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.sources.length > 0 ? (
        <Section title="Sources">
          <ul className="flex flex-wrap gap-1.5">
            {report.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  // `noreferrer` as well as `noopener`: these are links the
                  // model chose, and they should not learn where the reader
                  // came from. `nofollow` because this app does not vouch for
                  // them.
                  rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-45 items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-2xs text-ink-2 hover:border-line-strong hover:text-ink"
                >
                  <ExternalLinkIcon className="size-3 shrink-0 text-ink-3" />
                  <span className="truncate">{source.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-2xs leading-4 text-ink-3">
        Written by {report.model}
        {report.grounded ? " from a web search" : " without a web search"}. Always confirm on
        the official website before you act on it.
      </p>
    </div>
  );
}

/**
 * A section heading with the rule drawn from the end of its own words.
 *
 * The rule is what separates four blocks of small text that would otherwise
 * run together — cheaper than a border box round each, and it keeps the
 * content flush with the panel's left edge so the eye has one column to follow.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="cond mb-2 flex items-center gap-2 text-2xs font-semibold tracking-wider text-ink-3 uppercase">
        {title}
        <span className="h-px flex-1 bg-line" aria-hidden />
      </h5>
      {children}
    </div>
  );
}

/**
 * The three things somebody opens this panel to find out.
 *
 * Each is a claim with a link attached only when the claim is "yes" — the
 * parser strips a link whose document is not out, so a "Download" that leads
 * to a 404 is not reachable from here.
 */
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
    <dl className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
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
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="cond shrink-0 text-2xs font-semibold tracking-wider text-ink-3 uppercase">
        {term}
      </dt>
      <dd className="flex min-w-0 items-baseline gap-2 text-right">
        {detail ? <span className="truncate text-2xs text-ink-3">{detail}</span> : null}
        <Badge tone={tone} className="tabular">
          {value}
        </Badge>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 text-2xs font-semibold text-accent hover:underline"
          >
            {hrefLabel}
          </a>
        ) : null}
      </dd>
    </div>
  );
}

/* ── Time ──────────────────────────────────────────────────────────────── */

/**
 * "2 hours ago", via `Intl` rather than a date library.
 *
 * This page is per-user and never CDN-cached, so the server's "now" and the
 * hydrating client's are seconds apart — but the two can still land either
 * side of a minute boundary, which React reports as a hydration mismatch. The
 * span carries `suppressHydrationWarning` for exactly that.
 */
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
