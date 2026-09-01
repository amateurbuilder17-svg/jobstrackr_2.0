"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { SearchBar } from "./search-bar";

interface HomeSearchContextValue {
  search: string;
  setSearch: (v: string) => void;
  filters: string[];
  toggleFilter: (option: string) => void;
  clearAllFilters: () => void;
  query: string;
  registerResults: (id: string, count: number) => void;
  unregisterResults: (id: string) => void;
  totalResults: number;
}

const HomeSearchContext = createContext<HomeSearchContextValue | null>(null);

export function HomeSearchProvider({ children }: { children: React.ReactNode }) {
  const [search, setSearch] = useState("");
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

  const query = search.toLowerCase().trim();

  const totalResults = useMemo(() => {
    return Object.values(resultsMap).reduce((sum, count) => sum + count, 0);
  }, [resultsMap]);

  const value = useMemo(
    () => ({
      search,
      setSearch,
      filters,
      toggleFilter,
      clearAllFilters,
      query,
      registerResults,
      unregisterResults,
      totalResults,
    }),
    [search, filters, query, totalResults],
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

export function HomeSearchBar() {
  const { search, setSearch, filters, toggleFilter, clearAllFilters } = useHomeSearch();
  return (
    <SearchBar
      value={search}
      onChange={setSearch}
      filters={filters}
      onToggleFilter={toggleFilter}
      onClearAll={clearAllFilters}
    />
  );
}

export function HomeEmptySearchResults() {
  const { query, filters, totalResults } = useHomeSearch();
  const isFiltering = Boolean(query) || filters.length > 0;

  if (!isFiltering || totalResults > 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card animate-in fade-in duration-200">
      <p className="text-base font-bold text-foreground">No matches found</p>
      <p className="mt-1 text-sm text-muted-foreground">
        No exams, jobs, or updates match {query ? `"${query}"` : "the selected filters"}. Try adjusting your keywords or filters.
      </p>
    </div>
  );
}
