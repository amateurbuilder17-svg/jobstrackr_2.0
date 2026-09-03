"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { CalendarIcon, CheckIcon, CloseIcon, SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FormError, FormNotice } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { cn } from "@/lib/cn";
import type { SubjectSuggestion } from "@/lib/db/queries/attempts";
import { formatDate } from "@/lib/format/deadline";
import { saveAttemptAction } from "@/lib/tracker/actions";

/**
 * Kept in step with `SUGGEST_MIN_CHARS` in the query layer deliberately rather
 * than imported: that module is `server-only`, and reaching into it from here
 * would pull the Supabase client into the browser bundle.
 */
const MIN_CHARS = 3;

/** Long enough that a fast typist makes one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

export function AttemptForm({
  open: externalOpen,
  onClose: externalOnClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const [state, formAction] = useActionState(saveAttemptAction, EMPTY_FORM_STATE);
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = externalOpen !== undefined;
  const isOpen = isControlled ? externalOpen : internalOpen;

  const handleClose = () => {
    if (externalOnClose) externalOnClose();
    else setInternalOpen(false);
  };

  // Close once the row has landed, giving the confirmation a moment to be read.
  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(() => {
      if (externalOnClose) externalOnClose();
      else setInternalOpen(false);
    }, 1100);
    return () => {
      clearTimeout(timer);
    };
  }, [state.ok, externalOnClose]);

  if (!isOpen) {
    if (isControlled) return null;
    return (
      <div className="mt-8 flex justify-center">
        <Button
          variant="primary"
          onClick={() => {
            setInternalOpen(true);
          }}
          className="h-10 rounded-xl px-5 font-semibold shadow-pill transition-all hover:bg-brand-deep active:scale-95"
        >
          + Track another exam
        </Button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-exam-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="fixed inset-0" onClick={handleClose} aria-hidden="true" />

      <form
        action={formAction}
        className="relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="track-exam-modal-title"
              className="text-base font-bold text-foreground sm:text-lg"
            >
              Add an exam
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Type the name. Dates, admit cards and results are filled in for you.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close dialog"
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <FormError>{state.errors?.form}</FormError>
        {state.ok && state.message ? <FormNotice>{state.message}</FormNotice> : null}

        <SubjectField error={state.errors?.customName ?? state.errors?.jobId} />

        <div className="flex items-center justify-end gap-2.5 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            className="h-9 rounded-xl text-xs font-semibold"
          >
            Cancel
          </Button>
          <SubmitButton
            variant="primary"
            pendingLabel="Adding…"
            className="h-9 rounded-xl px-5 font-semibold shadow-pill"
          >
            Add exam
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

/* ── The one field ─────────────────────────────────────────────────────── */

/**
 * Name-with-suggestions, and the only input on the form.
 *
 * ── What it costs ─────────────────────────────────────────────────────────
 * Nothing until the third character, then at most one request per `DEBOUNCE_MS`
 * of quiet typing, and none at all for a term already searched this session —
 * see `searched` below. Requests that are overtaken are aborted rather than
 * left to resolve into a stale list. Behind the route the same term is a CDN
 * hit for ten minutes and a Next data-cache hit for six hours, so a repeat
 * search usually never reaches Postgres at all.
 *
 * Free text is a first-class answer. The suggestions only cover notifications
 * that have been ingested, and somebody sitting a state exam we have not
 * scraped should still be able to track it — so nothing here forces a
 * selection, and an unmatched name is submitted as `customName`.
 */
function SubjectField({ error }: { error?: string | undefined }) {
  const listId = useId();
  const inputId = useId();

  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<SubjectSuggestion | null>(null);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);

  /**
   * Every term searched this mount, as its results.
   *
   * State rather than a ref, and the single source the list renders from —
   * which is what keeps the effect below free of a synchronous `setState`.
   * Nothing is evicted: somebody adding an exam types a handful of distinct
   * prefixes and then stops, and re-searching one of them should cost nothing.
   */
  const [searched, setSearched] = useState<Record<string, SubjectSuggestion[]>>({});
  const abort = useRef<AbortController | null>(null);

  const query = term.trim();
  // Empty means "not searching": below the threshold, or the user has already
  // picked and the box now holds an answer rather than a query.
  const key = query.length >= MIN_CHARS && !picked ? query.toLowerCase() : "";

  const items = searched[key] ?? [];
  const loading = key !== "" && searched[key] === undefined;

  useEffect(() => {
    if (key === "" || searched[key] !== undefined) return;

    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      fetch(`/api/tracker/suggest?q=${encodeURIComponent(key)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : { items: [] }))
        .then((body: { items?: SubjectSuggestion[] }) => {
          setSearched((prev) => ({ ...prev, [key]: body.items ?? [] }));
        })
        .catch(() => {
          // An abort is the expected path rather than a failure — the newer
          // keystroke owns the list, and its own entry will arrive. A real
          // network error records an empty result so the row stops saying
          // "Searching…"; typing the name by hand still works, which is the
          // whole reason free text is accepted.
          if (!controller.signal.aborted) {
            setSearched((prev) => ({ ...prev, [key]: [] }));
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [key, searched]);

  const showList = key !== "" && !dismissed;
  // Results can arrive shorter than the highlight that was set against the
  // previous list, and `aria-activedescendant` must not name a missing option.
  const activeIndex = active < items.length ? active : -1;

  const choose = (item: SubjectSuggestion) => {
    setPicked(item);
    setTerm(item.title);
    setActive(-1);
  };

  const clear = () => {
    setPicked(null);
    setTerm("");
    setActive(-1);
    setDismissed(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Closes the list first, the dialog second — Escape should undo the most
      // recent thing that opened.
      if (showList && items.length > 0) {
        event.stopPropagation();
        setDismissed(true);
      }
      return;
    }
    if (!showList || items.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      // Only when something is highlighted, so Enter on a typed-out custom name
      // still submits the form rather than being swallowed.
      event.preventDefault();
      const item = items[activeIndex];
      if (item) choose(item);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Exam or notification name
      </label>

      {/* The picked suggestion travels as an id; the visible input is only ever
          the free-text fallback, so a stale title cannot be written to the row. */}
      <input type="hidden" name="jobId" value={picked?.jobId ?? ""} />

      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id={inputId}
          name="customName"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            // Editing the text means the previous choice no longer describes
            // what is in the box.
            setPicked(null);
            setActive(-1);
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoFocus
          role="combobox"
          aria-expanded={showList && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${String(activeIndex)}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
          placeholder="e.g. SSC CGL, RRB ALP, UPSC CDS"
          className={cn(
            "h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-base text-ink",
            "placeholder:text-ink-3 transition-[border-color,box-shadow] duration-(--duration-fast)",
            "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
            "aria-[invalid=true]:border-critical aria-[invalid=true]:ring-critical/25",
          )}
        />

        {picked ? (
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-brand"
            aria-hidden="true"
          >
            <CheckIcon className="size-4" />
          </span>
        ) : term ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear"
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* ── The suggestions ─────────────────────────────────────────────── */}
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching exams"
          className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-card"
        >
          {items.map((item, index) => (
            <li
              key={item.jobId}
              id={`${listId}-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  choose(item);
                }}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
                  index === activeIndex ? "bg-brand-soft" : "hover:bg-muted",
                )}
              >
                <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                  {item.title}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {item.organization ? (
                    <span className="truncate max-w-[16rem]">{item.organization}</span>
                  ) : null}
                  {/* The closing date is what tells this year's cycle from last
                      year's when two notifications share a name. */}
                  {item.lastDate ? (
                    <>
                      {item.organization ? <span aria-hidden="true">·</span> : null}
                      <CalendarIcon className="size-3" aria-hidden="true" />
                      <span>{formatDate(item.lastDate)}</span>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          ))}

          {items.length === 0 ? (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              {loading
                ? "Searching…"
                : `No notification found. “${query}” will be tracked by name.`}
            </li>
          ) : null}
        </ul>
      ) : null}

      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-critical" role="alert">
          {error}
        </p>
      ) : (
        <p id={`${inputId}-hint`} className="text-xs text-ink-3">
          {picked
            ? "Matched to a live notification — its dates and updates come across automatically."
            : `Suggestions appear after ${String(MIN_CHARS)} characters. No match is fine — we will track the name you type.`}
        </p>
      )}
    </div>
  );
}
