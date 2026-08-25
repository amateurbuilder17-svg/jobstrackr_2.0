"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { SearchIcon } from "@/components/icons";

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
  const [isPending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The URL is the source of truth: if it changes elsewhere — the back button,
  // a cleared filter — the field follows rather than holding a stale term.
  //
  // Adjusted during render rather than in an effect. An effect would render
  // once with the stale value and again with the fresh one, and React's
  // cascading-render lint flags it for exactly that reason. This is the
  // documented "adjust state when a prop changes" pattern: it re-renders this
  // component immediately, before anything is painted.
  if (urlTerm !== syncedTerm) {
    setSyncedTerm(urlTerm);
    setValue(urlTerm);
  }

  function push(term: string) {
    const next = new URLSearchParams(params.toString());
    if (term.trim()) next.set("q", term.trim());
    else next.delete("q");
    // Any change to the query resets pagination; keeping the old cursor would
    // page through the previous result set.
    next.delete("after");
    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function onChange(term: string) {
    setValue(term);
    clearTimeout(debounce.current);
    // 250ms: long enough that a normal typing burst is one request, short
    // enough that the pause before results does not read as a stall.
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
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={label}
        className={
          "h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink " +
          "placeholder:text-ink-3 focus:border-accent-line " +
          "transition-colors duration-(--duration-fast)"
        }
      />
      {/* Announced politely so a screen reader hears that results are updating
          without interrupting whatever is being read. */}
      <span aria-live="polite" className="sr-only">
        {isPending ? "Searching" : ""}
      </span>
    </form>
  );
}
