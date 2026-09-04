"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { requestSearchFocus } from "@/lib/search-handoff";
import { SearchBar } from "./search-bar";

/**
 * The home page's chip filters, and a tally of what survives them.
 *
 * The search term used to live here too, alongside a lowercased `query` every
 * feed matched its own rows against. It is gone: the field hands off to `/jobs`
 * on the first touch, so the term never has a second render to be read on, and
 * whatever is typed before the navigation lands belongs to the input alone.
 * What remains is the chips — the one thing on this page that really does
 * filter what is already on it.
 */
interface HomeSearchContextValue {
  filters: string[];
  toggleFilter: (option: string) => void;
  clearAllFilters: () => void;
  /**
   * How many rows a section is showing. Only the sections the chips can act on
   * report in, which is what makes `totalResults === 0` mean "the chips hid
   * everything" rather than "the page is empty".
   */
  registerResults: (id: string, count: number) => void;
  unregisterResults: (id: string) => void;
  totalResults: number;
}

const HomeSearchContext = createContext<HomeSearchContextValue | null>(null);

export function HomeSearchProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<string[]>([]);
  const [resultsMap, setResultsMap] = useState<Record<string, number>>({});

  const toggleFilter = (option: string) => {
    setFilters((prev) =>
      prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option],
    );
  };

  const clearAllFilters = () => {
    setFilters([]);
  };

  const registerResults = (id: string, count: number) => {
    setResultsMap((prev) => {
      if (prev[id] === count) return prev;
      return { ...prev, [id]: count };
    });
  };

  const unregisterResults = (id: string) => {
    setResultsMap((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _, ...next } = prev;
      return next;
    });
  };

  const totalResults = useMemo(() => {
    return Object.values(resultsMap).reduce((sum, count) => sum + count, 0);
  }, [resultsMap]);

  const value = useMemo(
    () => ({
      filters,
      toggleFilter,
      clearAllFilters,
      registerResults,
      unregisterResults,
      totalResults,
    }),
    [filters, totalResults],
  );

  return <HomeSearchContext.Provider value={value}>{children}</HomeSearchContext.Provider>;
}

export function useHomeSearch() {
  const ctx = useContext(HomeSearchContext);
  if (!ctx) {
    throw new Error("useHomeSearch must be used within HomeSearchProvider");
  }
  return ctx;
}

/**
 * The home search bar, which searches `/jobs`.
 *
 * Typing here used to filter the rows already on the page: six curated sections
 * of at most six cards each, so a search for a department that had nothing in
 * the closing-soon or just-published windows returned "No matches found" from a
 * page holding ~30 of the ~2,700 open jobs. The reader read that as *there is
 * nothing*, when the real answer was three routes away.
 *
 * Focusing the field now hands the search to `/jobs`, where the query reaches
 * Postgres against the whole table. The handoff happens on focus rather than on
 * the first keystroke for one reason, and it is a mobile one: the tap that
 * focuses this field is what opens the on-screen keyboard, and a keyboard that
 * is already up survives the field underneath it being replaced. Waiting for a
 * keystroke means navigating *after* the reader has committed to typing, which
 * loses the first character or two into a field that is on its way out.
 *
 * `/jobs` is prefetched on mount so the tap lands on a page that is already
 * in the router cache — the bar is above the fold on the app's most-visited
 * route, and it is the one destination reachable from it in a single gesture.
 *
 * Anything already typed rides along in `?q=`, and `requestSearchFocus` asks the
 * field over there to take the caret, so the sequence reads as one field that
 * happened to change pages rather than two fields, one of them abandoned.
 */
export function HomeSearchBar() {
  const { filters, toggleFilter, clearAllFilters } = useHomeSearch();
  const router = useRouter();
  // Local, not context state. Nothing on this page reads the term any more —
  // it exists to keep the input controlled for the moment or two before the
  // navigation lands, and then leaves with the page.
  const [search, setSearch] = useState("");
  const handedOff = useRef(false);

  useEffect(() => {
    router.prefetch("/jobs");
  }, [router]);

  const handOffToJobs = (term: string) => {
    const q = term.trim();
    const href = q ? `/jobs?q=${encodeURIComponent(q)}` : "/jobs";

    // A second call means characters landed in this field while the navigation
    // was still in flight. They belong in the query, but not in the history:
    // `replace` keeps the back button pointing at the home page rather than at
    // one entry per keystroke.
    if (handedOff.current) {
      router.replace(href, { scroll: false });
      return;
    }

    handedOff.current = true;
    requestSearchFocus("/jobs");
    router.push(href);
  };

  return (
    <SearchBar
      value={search}
      onChange={(next) => {
        setSearch(next);
        handOffToJobs(next);
      }}
      onSearchFocus={(viaPointer) => {
        // A tap or a click is someone going to search, and the keyboard it
        // raises is what makes the handoff feel like one field rather than two.
        // Focus arriving any other way is not: a keyboard user tabbing down the
        // page would be thrown off the home page before reaching anything below
        // the search bar. They get the handoff on their first keystroke, from
        // `onChange`, with the character they typed riding along in `?q=`.
        if (viaPointer) handOffToJobs(search);
      }}
      filters={filters}
      onToggleFilter={toggleFilter}
      onClearAll={clearAllFilters}
    />
  );
}

/**
 * Shown when the chips have hidden every job row on the page.
 *
 * The copy names jobs only. It used to say "No exams, jobs, or updates match",
 * which was written when the search term filtered all six sections; the chips
 * never touched the tracked-exams, popular-exams or updates rows, so the
 * sentence was claiming to have searched three things it had not — while two of
 * them sat visible directly above it.
 *
 * It offers `/jobs` rather than only "clear the filters", because these chips
 * refine six curated cards and that page holds every open listing. Someone who
 * filtered their way to nothing is asking a question the home page cannot
 * answer.
 */
export function HomeEmptyFilterResults() {
  const { filters, totalResults } = useHomeSearch();

  if (filters.length === 0 || totalResults > 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card animate-in fade-in duration-200">
      <p className="text-base font-bold text-foreground">No jobs match these filters</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Nothing in these highlights fits the selected filters. Search every open job to see the
        full list.
      </p>
      <Link
        href="/jobs"
        className="mt-4 inline-block text-sm font-bold text-brand hover:underline"
      >
        Browse all jobs
      </Link>
    </div>
  );
}
