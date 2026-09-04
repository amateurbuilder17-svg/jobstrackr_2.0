"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useId, useMemo, useRef, useState } from "react";

import { SignInPrompt } from "@/components/auth/sign-in-prompt";
import { BookOpenIcon, BriefcaseIcon, SearchIcon, SparklesIcon } from "@/components/icons";
import { FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { searchSyllabusAction } from "@/lib/syllabus/actions";
import type { Suggestion } from "./suggestions";

/**
 * The finder's search box, with the old app's typeahead.
 *
 * The behaviour is `SyllabusCheck.tsx`'s: type two characters, get a dropdown,
 * cached exams first and marked "Saved", pick one and go straight to it. What
 * is different is where the suggestions come from, and that difference is the
 * whole point on a free tier.
 *
 * The old box fired two Supabase selects on every keystroke behind a 300 ms
 * debounce — `syllabus_cache ILIKE` and `jobs ILIKE` — so a ten-character
 * search cost somewhere between two and twenty reads before anybody had
 * searched anything. Here the suggestions arrive already built, off the one
 * cached query the page was making anyway, and the filtering is a substring
 * test in this component. A keystroke costs nothing, and the debounce is gone
 * along with the network call it existed to hide.
 *
 * The visible consequence is that job titles are no longer suggested. They were
 * never syllabi — picking one spent an AI call on a guess that a job's title
 * was an exam name — so what is lost is a suggestion that mostly cost money.
 */

/** Two characters is not a search, same threshold as the old box. */
const MIN_CHARS = 2;

/**
 * How many suggestions to show before anything has been typed.
 *
 * Six, because the pool is ordered cached-first and the cached ones are the
 * whole point of showing a list to somebody who has not typed: they open a
 * static page with no model call behind it. Six is also what fits above the
 * fold on a phone without the dropdown covering the Popular tiles it overlaps.
 */
const BROWSE_COUNT = 6;

/**
 * The query, reduced to what `syllabusKey` produced for the suggestions.
 *
 * Deliberately not `syllabusKey` itself, which also strips years and noise
 * words and would be another module in a bundle with 0.3 kB of headroom. Those
 * rules matter for what gets *cached*; for deciding whether "ssc c" is a prefix
 * of "ssc cgl" they are not needed, and case-folding punctuation away is.
 */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function SyllabusSearchForm({ suggestions }: { suggestions: Suggestion[] }) {
  const [state, action, pending] = useActionState(searchSyllabusAction, EMPTY_FORM_STATE);
  const initialQuery = useSearchParams().get("q") ?? "";
  const id = useId();
  const fieldId = `${id}-q`;
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);

  const needle = normalise(query);

  /**
   * Whether the list is a set of suggestions or a set of results.
   *
   * Below two characters there is nothing to match on, and the old box showed
   * nothing at all there. It shows the head of the pool instead — the exams
   * already fetched, then the popular ones — so focusing the field answers
   * "what can I look up here" without a keystroke, and the answer leads with
   * the entries that cost nothing to open.
   */
  const browsing = needle.length < MIN_CHARS;

  /**
   * Two groups, because they answer two different questions.
   *
   * Exams come first and are what the page is for. Vacancies are the fallback
   * — the exam has no syllabus here yet, but there is an open recruitment for
   * it — and they are capped low so they can never push the exam matches out of
   * a list somebody is scanning for an exam.
   *
   * Vacancies are also suppressed while browsing: an empty box is a question
   * about what can be looked up here, and the answer to that is exams.
   */
  const { exams, vacancies } = useMemo(() => {
    if (browsing) {
      return { exams: suggestions.filter(isExam).slice(0, BROWSE_COUNT), vacancies: [] };
    }
    const hits = suggestions.filter((row) => row.key.includes(needle));
    return {
      exams: hits.filter(isExam).slice(0, 6),
      vacancies: hits.filter((row) => row.kind === "job").slice(0, 4),
    };
  }, [suggestions, needle, browsing]);

  const showList = open && (exams.length > 0 || vacancies.length > 0) && !pending;

  /** Picking a row with no href means "search for this". */
  function go(name: string) {
    setQuery(name);
    setOpen(false);
    inputRef.current?.form?.requestSubmit();
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      {/* A refusal for want of an account is an invitation, not an error — it
          gets the prompt rather than the red text, and the typed query stays in
          the box behind it. */}
      {state.authRequired ? (
        <SignInPrompt
          next={state.authRequired}
          message={state.errors?.form ?? "Sign in to look up a syllabus."}
        />
      ) : (
        <FormError>{state.errors?.form}</FormError>
      )}

      {/* Main Search Input Plate */}
      <div className="relative">
        <div className="rounded-2xl border border-line bg-surface p-1.5 sm:p-2 shadow-xs transition-all focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft">
          <div className="flex items-center gap-2">
            <div className="flex size-10 shrink-0 items-center justify-center text-ink-3 pl-1 sm:pl-2">
              <SearchIcon className="size-5 text-brand shrink-0" aria-hidden="true" />
            </div>

            <label htmlFor={fieldId} className="sr-only">
              Exam name or abbreviation
            </label>
            <input
              ref={inputRef}
              id={fieldId}
              name="q"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              // Closing on blur has to outlast the click that caused it, or the
              // suggestion unmounts before its own onClick runs.
              onBlur={() => {
                setTimeout(() => {
                  setOpen(false);
                }, 150);
              }}
              required
              autoComplete="off"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              disabled={pending}
              placeholder="Search exam syllabus (e.g. SSC CGL, RRB NTPC, UPSC)..."
              className="h-10 min-w-0 flex-1 bg-transparent text-sm sm:text-base font-medium text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
            />

            <SubmitButton
              variant="primary"
              pendingLabel="Searching…"
              className="h-10 sm:h-11 shrink-0 rounded-xl bg-brand px-4 sm:px-5 font-semibold text-white shadow-xs hover:bg-brand-deep transition-colors"
            >
              <SearchIcon className="size-4" />
              <span className="hidden sm:inline">Get Syllabus</span>
              <span className="sm:hidden">Search</span>
            </SubmitButton>
          </div>
        </div>

        {/* Suggestions Dropdown */}
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={browsing ? "Suggested exams" : "Matching exams and vacancies"}
            className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-72 overflow-hidden overflow-y-auto rounded-2xl border border-line bg-surface shadow-lg divide-y divide-line"
          >
            {browsing ? <GroupLabel>Suggested exams</GroupLabel> : null}
            {exams.map((row) => (
              <Row key={row.key} row={row} onGo={go} />
            ))}

            {vacancies.length > 0 ? (
              <>
                {/* Named for what it is. These go to a job page, not a
                    syllabus, and the heading is what stops that being a
                    surprise after a row above it opened one. */}
                <GroupLabel>Open vacancies</GroupLabel>
                {vacancies.map((row) => (
                  <Row key={row.key} row={row} onGo={go} />
                ))}
              </>
            ) : null}
          </ul>
        ) : null}
      </div>

      {state.errors?.q ? (
        <p className="text-xs font-medium text-critical">{state.errors.q}</p>
      ) : null}

      {/* Grounded AI Search Pending Progress Card */}
      {pending ? (
        <div
          role="status"
          className="mt-2 flex items-start gap-3 rounded-2xl border border-brand/25 bg-brand-soft/70 p-4 text-xs sm:text-sm text-ink-2 dark:bg-brand-soft/20 shadow-xs"
        >
          <SparklesIcon
            className="size-5 shrink-0 text-brand animate-pulse mt-0.5"
            aria-hidden="true"
          />
          <div>
            <p className="font-bold text-brand">
              Extracting syllabus from official notifications…
            </p>
            <p className="mt-0.5 leading-relaxed text-ink-2">
              Reading the conducting body&rsquo;s official sources. This takes about 25–30
              seconds.
            </p>
          </div>
        </div>
      ) : null}
    </form>
  );
}

/** Cached syllabi and popular exams — everything that is not a vacancy. */
function isExam(row: Suggestion): boolean {
  return row.kind !== "job";
}

/**
 * A group caption.
 *
 * `role="presentation"`, not an option: arrowing onto it would be arrowing onto
 * something that cannot be chosen, and assistive technology counting it as one
 * of N results would be counting wrong.
 */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li
      role="presentation"
      className="bg-surface-2/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-3"
    >
      {children}
    </li>
  );
}

/**
 * One suggestion.
 *
 * A row with an `href` is a link — a cached syllabus or an open vacancy, both
 * of which are static pages that cost nothing to open, and both of which
 * should therefore behave like links: middle-clickable, openable in a new tab,
 * and visible to a crawler as a destination. A row without one submits the
 * search, because there is nothing to link to yet and the next step spends a
 * model call.
 */
function Row({ row, onGo }: { row: Suggestion; onGo: (name: string) => void }) {
  const icon =
    row.kind === "cached" ? (
      <BookOpenIcon className="size-4 shrink-0 text-brand" aria-hidden="true" />
    ) : row.kind === "job" ? (
      <BriefcaseIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
    ) : (
      <SearchIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
    );

  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.name}</span>
      {row.kind === "cached" ? (
        <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
          {row.note}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-ink-3">{row.note}</span>
      )}
    </>
  );

  const className =
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2";

  return (
    <li role="option" aria-selected="false">
      {row.href === null ? (
        <button
          type="button"
          onClick={() => {
            onGo(row.name);
          }}
          className={className}
        >
          {body}
        </button>
      ) : (
        <Link href={row.href} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}
