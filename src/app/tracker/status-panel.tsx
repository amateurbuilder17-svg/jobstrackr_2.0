"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format/deadline";
import {
  EVENT_LABELS,
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
    <div className="mt-3 border-t border-line pt-3">
      {report ? (
        <Summary
          report={report}
          expanded={expanded}
          onToggle={() => {
            setExpanded((open) => !open);
          }}
        />
      ) : (
        <p className="text-xs text-ink-3">
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
    </div>
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
  const percent = progressOf(report.report);
  const stage = report.report.stage;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
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

        <span className="text-2xs text-ink-3" suppressHydrationWarning>
          {timeAgo(report.refreshedAt)}
        </span>
      </div>

      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progress: ${STAGE_LABELS[stage]}`}
      >
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      {report.report.summary ? (
        <p className={cn("mt-2 text-xs leading-5 text-ink-2", !expanded && "line-clamp-2")}>
          {report.report.summary}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 text-2xs font-medium text-accent hover:underline"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>
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

  return (
    <div className="mt-3 flex flex-col gap-3">
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
                  "rounded-md px-2.5 py-1 text-2xs font-medium transition-colors",
                  phase === n
                    ? "bg-accent text-on-accent"
                    : "border border-line text-ink-2 hover:bg-surface-2",
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
        <Section title="Dates">
          <ul className="flex flex-col gap-1">
            {report.report.events.map((event) => (
              <li
                key={`${event.type}-${event.date}-${String(event.phase ?? 0)}`}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="text-ink-2">
                  {EVENT_LABELS[event.type]}
                  {event.phase !== null && twoPhases ? (
                    <span className="text-ink-3">
                      {" "}
                      · {phaseOf(report.report, event.phase === 2 ? 2 : 1)?.name ?? ""}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-medium text-ink">
                  {formatDate(event.date)}
                  {/* A low-confidence date is a guess and is labelled as one.
                      The old app rendered guesses and facts identically. */}
                  {event.certainty === "low" ? (
                    <span className="ml-1 font-normal text-ink-3">(expected)</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.report.updates.length > 0 ? (
        <Section title="Recent">
          <ul className="flex flex-col gap-1">
            {report.report.updates.map((line) => (
              <li key={line} className="text-xs leading-5 text-ink-2">
                {line}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.report.recommendations.length > 0 ? (
        <Section title="What to do next">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {report.report.recommendations.map((line) => (
              <li key={line} className="text-xs leading-5 text-ink-2">
                {line}
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
                  className="inline-block max-w-45 truncate rounded-full border border-line px-2 py-0.5 text-2xs text-ink-2 hover:border-line-strong hover:text-ink"
                >
                  {source.title}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-2xs font-semibold tracking-wide text-ink-3 uppercase">
        {title}
      </h4>
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
    <dl className="flex flex-col gap-2 rounded-md border border-line bg-surface-2/50 p-3">
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
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-2">{term}</dt>
      <dd className="flex min-w-0 items-baseline gap-2 text-right">
        {detail ? <span className="truncate text-2xs text-ink-3">{detail}</span> : null}
        <Badge tone={tone}>{value}</Badge>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 text-2xs font-medium text-accent hover:underline"
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
