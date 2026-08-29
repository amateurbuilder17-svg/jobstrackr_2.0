"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { CheckIcon, ChevronRightIcon, SparkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { QUESTIONS } from "@/lib/quiz/questions";
import type { QuizAnswers, ScoredExam } from "@/lib/quiz/score";

/**
 * The quiz: ten questions, then a ranked list.
 *
 * All of it runs in the browser. There is no account, no server call and
 * nothing stored — the answers describe somebody's age, caste category and
 * income expectation, which is a profile worth having and not worth keeping
 * when the whole feature works without it. The old app made the same choice by
 * accident (it was a static page); this one makes it on purpose.
 *
 * The catalogue is loaded on demand, not with the page. Fifty exams of
 * eligibility data is ~30 kB that the opening screen has no use for, and
 * shipping it up front put /quiz 2.8 kB over its budget. The `import()` fires
 * when somebody starts the quiz, so it downloads while they read question one
 * and is never fetched at all by a visitor who opens the page and leaves.
 */

type Phase = "intro" | "asking" | "scoring" | "results";

export function QuizRunner() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [results, setResults] = useState<ScoredExam[] | null>(null);

  const question = QUESTIONS[step];

  /**
   * Start fetching the catalogue the moment somebody commits to the quiz.
   *
   * Not awaited here: they have ten questions to answer, which is far longer
   * than the download, so by the time scoring happens the module is warm. If it
   * somehow is not, `finish` awaits the same promise and the import cache
   * returns it immediately.
   */
  const warm = useCallback(() => {
    void import("@/lib/quiz/score");
  }, []);

  const finish = useCallback(async () => {
    setPhase("scoring");
    const [{ rankExams }, { EXAMS }] = await Promise.all([
      import("@/lib/quiz/score"),
      import("@/lib/quiz/exams"),
    ]);
    setResults(rankExams([...EXAMS], answers));
    setPhase("results");
  }, [answers]);

  const answered = useCallback(
    (id: string) => {
      const value = answers[id as keyof QuizAnswers];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    },
    [answers],
  );

  function choose(id: string, value: string, multi: boolean) {
    setAnswers((prev) => {
      if (!multi) return { ...prev, [id]: value };
      const current = (prev[id as keyof QuizAnswers] as string[] | undefined) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [id]: next };
    });
  }

  function next() {
    if (step < QUESTIONS.length - 1) setStep((s) => s + 1);
    else void finish();
  }

  function restart() {
    setAnswers({});
    setResults(null);
    setStep(0);
    setPhase("intro");
  }

  /* ── Intro ───────────────────────────────────────────────────────────── */
  if (phase === "intro") {
    return (
      <div className="flex flex-col gap-6">
        <p className="leading-relaxed text-ink-2">
          Ten questions about your education, age and what you want from a job. At the end you
          get every exam in our catalogue that you are actually eligible for, ranked, with the
          reason each one matched.
        </p>
        <ul className="flex flex-col gap-2 text-sm text-ink-2">
          {[
            "About two minutes.",
            "No account, and nothing is saved — the answers stay in this tab.",
            "Eligibility is checked properly: an exam you are barred from is not shown at all.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
              {line}
            </li>
          ))}
        </ul>
        <div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              warm();
              setPhase("asking");
            }}
          >
            <SparkIcon className="size-4" />
            Start the quiz
          </Button>
        </div>
      </div>
    );
  }

  /* ── Scoring ─────────────────────────────────────────────────────────── */
  if (phase === "scoring") {
    return (
      <p role="status" className="py-10 text-center text-ink-2">
        Working out your matches…
      </p>
    );
  }

  /* ── Results ─────────────────────────────────────────────────────────── */
  if (phase === "results" && results) {
    return <Results results={results} onRestart={restart} />;
  }

  /* ── A question ──────────────────────────────────────────────────────── */
  if (!question) return null;

  const multi = question.type === "multi";
  const stored = answers[question.id as keyof QuizAnswers];
  const selected = stored ?? (multi ? [] : "");

  return (
    <div className="flex flex-col gap-5">
      {/* Progress. `<progress>` rather than a styled div: it announces itself
          to a screen reader with its position, which a div cannot. */}
      <div className="flex items-center gap-3">
        <progress
          value={step + 1}
          max={QUESTIONS.length}
          className={
            "h-1.5 flex-1 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-surface-3 " +
            "[&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent"
          }
        />
        <span className="text-xs tabular-nums text-ink-3">
          {step + 1} / {QUESTIONS.length}
        </span>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="pb-3 font-cond text-2xl font-bold tracking-tight text-balance text-ink">
          <span aria-hidden="true" className="mr-2">
            {question.emoji}
          </span>
          {question.question}
        </legend>
        {multi ? <p className="pb-2 text-sm text-ink-3">Choose as many as apply.</p> : null}

        <div className="flex flex-col gap-2">
          {question.options.map((option) => {
            const isOn = multi
              ? (selected as string[]).includes(option.value)
              : selected === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3",
                  "transition-colors duration-(--duration-fast)",
                  isOn
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-surface hover:border-line-strong",
                  "has-focus-visible:ring-2 has-focus-visible:ring-accent/25",
                )}
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={question.id}
                  value={option.value}
                  checked={isOn}
                  onChange={() => {
                    choose(question.id, option.value, multi);
                  }}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-4.5 shrink-0 items-center justify-center border",
                    multi ? "rounded-sm" : "rounded-full",
                    isOn ? "border-accent bg-accent text-on-accent" : "border-line-strong",
                  )}
                >
                  {isOn ? <CheckIcon className="size-3" /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-ink">{option.label}</span>
                  <span className="text-xs text-ink-3">{option.sub}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => {
            if (step === 0) setPhase("intro");
            else setStep((s) => s - 1);
          }}
        >
          Back
        </Button>
        <Button variant="primary" disabled={!answered(question.id)} onClick={next}>
          {step === QUESTIONS.length - 1 ? "See my matches" : "Next"}
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ── Results ───────────────────────────────────────────────────────────── */

function Results({ results, onRestart }: { results: ScoredExam[]; onRestart: () => void }) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-cond text-2xl font-bold tracking-tight text-ink">
          Nothing in this catalogue fits
        </h2>
        <p className="leading-relaxed text-ink-2">
          Every exam we hold has an age or education requirement your answers do not meet. That
          is a limit of this catalogue — fifty of the largest national exams — not of what is
          open to you. The jobs list carries state and departmental recruitment with different
          rules.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/jobs">
            <Button variant="primary">Browse all jobs</Button>
          </Link>
          <Button variant="secondary" onClick={onRestart}>
            Start again
          </Button>
        </div>
      </div>
    );
  }

  const top = results.slice(0, 12);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-cond text-2xl font-bold tracking-tight text-balance text-ink">
          {results.length} exams you are eligible for
        </h2>
        <p className="mt-2 leading-relaxed text-ink-2">
          Ranked by how well each fits what you told us. Eligibility is checked against age and
          education, so everything here is an exam you can actually sit — but confirm against
          the official notification before you commit to one.
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {top.map(({ exam, score, reasons }, index) => (
          <li key={exam.id} className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-ink-3">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-semibold text-ink">{exam.name}</h3>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">
                  {exam.body} · {exam.tag}
                </p>
              </div>
              {/* Colour by band rather than a gradient: three states a reader
                  can name beat a continuous scale nobody can read off. */}
              <Badge tone={score >= 80 ? "good" : score >= 65 ? "accent" : "neutral"}>
                {score}% match
              </Badge>
            </div>

            <p className="mt-2.5 text-sm leading-relaxed text-ink-2">{exam.desc}</p>

            {reasons.length > 0 ? (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {reasons.map((reason) => (
                  <li
                    key={reason}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-ink-2"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
              <span>
                ₹{exam.salaryRange[0].toLocaleString("en-IN")} – ₹
                {exam.salaryRange[1].toLocaleString("en-IN")}
              </span>
              <span>{exam.educationTags.join(", ")}</span>
            </p>

            <p className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link
                href={`/jobs?q=${encodeURIComponent(exam.name)}`}
                className="font-medium text-accent hover:underline"
              >
                Open notifications
              </Link>
              <Link
                href={`/syllabus?q=${encodeURIComponent(exam.name)}`}
                className="font-medium text-accent hover:underline"
              >
                Syllabus
              </Link>
            </p>
          </li>
        ))}
      </ol>

      {results.length > top.length ? (
        <p className="text-sm text-ink-3">
          {results.length - top.length} more matched further down. The twelve above are the ones
          worth your time first.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Button variant="secondary" onClick={onRestart}>
          Start again
        </Button>
        <Link href="/for-you">
          <Button variant="primary">
            <SparkIcon className="size-4" />
            Match against real vacancies
          </Button>
        </Link>
      </div>
    </div>
  );
}
