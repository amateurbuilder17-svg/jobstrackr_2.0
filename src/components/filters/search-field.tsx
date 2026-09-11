"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { SearchIcon } from "@/components/icons";
import { consumeSearchFocus } from "@/lib/search-handoff";

/**
 * Search input, backed by the URL.
 *
 * Keeping the term in `?q=` rather than in component state is what makes a
 * result page shareable, bookmarkable and correct under the back button — and
 * it lets the server do the searching, which is the whole point: the old app
 * shipped 5,200 rows to the browser so JavaScript could filter them.
 *
 * `useTransition` keeps the previous results on screen while the next set is
 * fetched, instead of blanking to a skeleton on every keystroke.
 *
 * The destination is the current path. It used to be the literal `"/jobs"`,
 * which was invisible while `/jobs` was the only route with a search field and
 * would have silently redirected `/updates` the moment it got one.
 *
 * ## The box belongs to the reader
 *
 * What is typed is never overwritten by the search it started. The field used
 * to copy every URL change back into itself, including its own navigations
 * landing — and those carry an older, trimmed term. So "ssc " with a pause
 * came back as "ssc", eating the space the reader had just typed, and a
 * navigation that landed mid-word rewound the box to wherever the debounce had
 * fired. That is what made typing feel throttled: the input was fine, and the
 * URL kept reaching into it.
 *
 * Now the field remembers which terms it sent (`inFlight`) and lets those land
 * without touching the input. Only a change it did not make — the back button,
 * a "Clear all filters" link — is copied into the box.
 */
export function SearchField({
  placeholder = "Search by post, department or qualification",
  label = "Search jobs",
}: {
  placeholder?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlTerm = params.get("q") ?? "";
  const [value, setValue] = useState(urlTerm);
  const [syncedTerm, setSyncedTerm] = useState(urlTerm);
  /** Terms this field has sent to the URL that have not landed yet, oldest first. */
  const [inFlight, setInFlight] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  // Picks up a caret handed over by another route's search field — today the
  // home page's, which navigates here on focus. Only when one was actually left
  // for *this* path: an unconditional autofocus would yank the page down to the
  // header on every arrival at /jobs, including a tap on a job card and back.
  //
  // The caret goes to the end rather than selecting the term, because the reader
  // was mid-thought when the page changed; a selection would mean their next
  // keystroke deletes what they already typed.
  useEffect(() => {
    if (!consumeSearchFocus(pathname)) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
    // Mount only: this is a one-time handoff, not a reaction to the term.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adjusted during render rather than in an effect. An effect would render
  // once with the stale value and again with the fresh one, and React's
  // cascading-render lint flags it for exactly that reason. This is the
  // documented "adjust state when a prop changes" pattern: it re-renders this
  // component immediately, before anything is painted.
  if (urlTerm !== syncedTerm) {
    setSyncedTerm(urlTerm);
    const ours = inFlight.indexOf(urlTerm);
    if (ours === -1) {
      // Someone else moved the URL. The box follows rather than holding a
      // term the results below no longer answer.
      setValue(urlTerm);
      setInFlight([]);
    } else {
      // Our own search arriving. The box already holds something at least as
      // new, so it is left alone; anything sent before this one was superseded.
      setInFlight(inFlight.slice(ours + 1));
    }
  }

  /**
   * Whether what is on screen still answers what has been typed.
   *
   * Derived, not stored, and deliberately not `useTransition`'s `isPending`.
   * That flag is what this component used to report, and it never once turned
   * true: `router.replace` resolves its navigation outside the transition's
   * own render, so React had nothing to stay pending on.
   *
   * This comparison cannot drift, because it *is* the question the reader is
   * asking: the results below reflect `urlTerm`, so anything else in the box
   * means they are looking at an answer to an older query. It covers the
   * debounce window too — feedback arrives on the first keystroke rather than
   * after the last one.
   */
  const isStale = value.trim() !== urlTerm;

  function push(term: string) {
    const trimmed = term.trim();
    // Already asked for, or already showing. A trailing space or a letter
    // typed and deleted is not a new search, and costs no request.
    if (trimmed === (inFlight.at(-1) ?? urlTerm)) return;

    const next = new URLSearchParams(params.toString());
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    // Any change to the query resets pagination; keeping the old cursor would
    // page through the previous result set.
    next.delete("after");
    const query = next.toString();

    setInFlight((prev) => [...prev, trimmed]);
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function onChange(term: string) {
    // The keystroke lands in the box immediately and unconditionally. Only the
    // search behind it waits.
    setValue(term);
    clearTimeout(debounce.current);
    // 250ms of quiet before searching: a typing burst is one request against
    // the free-tier budget rather than one per letter, and the box itself
    // never waits for it.
    debounce.current = setTimeout(() => {
      push(term);
    }, 250);
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(debounce.current);
        push(value);
      }}
      className="relative"
    >
      {/* Measured on the deployed site, keystroke to repainted results is
          ~1.14s on a fast desktop — 250ms of it the debounce, ~220ms the round
          trip, the rest the route transition — and for all of it the list sits
          unchanged, which reads as a box that has stopped working. So the field
          acknowledges it instead of hiding it.

          The spinner replaces the search icon rather than joining it: same
          box, same position, so nothing reflows and the signal appears exactly
          where the eye already is. Reduced motion is handled globally in
          `globals.css`, which flattens the spin — the ring still reads as
          "not the magnifier", which is the part that carries the meaning. */}
      {isStale ? (
        <span
          aria-hidden="true"
          className={
            "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 " +
            "animate-spin rounded-full border-2 border-line border-t-accent"
          }
        />
      ) : (
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      )}
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className={
          "h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink " +
          "placeholder:text-ink-3 focus:border-accent-line " +
          "transition-colors duration-(--duration-fast)"
        }
      />
      {/* Announced politely so a screen reader hears that results are updating
          without interrupting whatever is being read. */}
      <span aria-live="polite" className="sr-only">
        {isStale ? "Searching" : ""}
      </span>
    </form>
  );
}
