"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDownIcon,
  BuildingIcon,
  CheckIcon,
  CloseIcon,
  GraduationCapIcon,
  MapPinIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparkIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { FILTER_GROUPS, JOB_SORT_OPTIONS } from "@/lib/jobs/filters";
import { useFilterParams } from "./use-filter-params";

interface FilterModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: string;
}

interface TabConfig {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isSort?: boolean;
}

const TABS: TabConfig[] = [
  { key: "sort", label: "Sort by", icon: ArrowUpDownIcon, isSort: true },
  { key: "level", label: "Education", icon: GraduationCapIcon },
  { key: "stream", label: "Discipline", icon: SparkIcon },
  { key: "sector", label: "Sector", icon: BuildingIcon },
  { key: "state", label: "Location", icon: MapPinIcon },
];

export function FilterModal({ open, onClose, initialTab = "sort" }: FilterModalProps) {
  const { params, setMultiple } = useFilterParams();
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [searchTerm, setSearchTerm] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  // Draft filter selections synced from URL when opening
  const [draftSort, setDraftSort] = useState<string>(params.get("sort") ?? "closing");
  const [draftFilters, setDraftFilters] = useState<Record<string, string | null>>(() => ({
    level: params.get("level") ?? null,
    stream: params.get("stream") ?? null,
    sector: params.get("sector") ?? null,
    state: params.get("state") ?? null,
  }));

  // Sync draft state during render when modal opens
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraftSort(params.get("sort") ?? "closing");
      setDraftFilters({
        level: params.get("level") ?? null,
        stream: params.get("stream") ?? null,
        sector: params.get("sector") ?? null,
        state: params.get("state") ?? null,
      });
      setSearchTerm("");
      if (initialTab) setActiveTab(initialTab);
    }
  }

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  // Count active selections per category
  const activeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    counts.sort = draftSort && draftSort !== "closing" ? 1 : 0;
    for (const [key, val] of Object.entries(draftFilters)) {
      counts[key] = val ? 1 : 0;
    }
    return counts;
  }, [draftSort, draftFilters]);

  const totalActiveCount = useMemo(() => {
    return Object.values(activeCounts).reduce((acc, count) => acc + count, 0);
  }, [activeCounts]);

  // Current active group options
  const activeGroup = useMemo(() => {
    return FILTER_GROUPS.find((g) => g.param === activeTab);
  }, [activeTab]);

  // Filtered options based on inline search term
  const displayedOptions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return activeGroup?.options ?? [];
    }
    return (activeGroup?.options ?? []).filter((opt) =>
      opt.label.toLowerCase().includes(term) || opt.value.toLowerCase().includes(term)
    );
  }, [activeGroup, searchTerm]);

  const toggleFilter = (param: string, value: string) => {
    setDraftFilters((prev) => {
      const current = prev[param];
      return {
        ...prev,
        [param]: current === value ? null : value,
      };
    });
  };

  const handleApply = () => {
    const updates: Record<string, string | null> = {
      sort: draftSort === "closing" ? null : draftSort,
      ...draftFilters,
    };
    setMultiple(updates);
    onClose();
  };

  const handleReset = () => {
    setDraftSort("closing");
    setDraftFilters({
      level: null,
      stream: null,
      sector: null,
      state: null,
    });
    setSearchTerm("");
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div
        ref={modalRef}
        className={cn(
          "relative z-10 flex flex-col w-full sm:max-w-2xl bg-surface border border-line",
          "rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden",
          "h-[85vh] sm:h-[600px] max-h-[90vh]",
          "animate-in slide-in-from-bottom duration-300 sm:zoom-in-95",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-surface shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <SlidersHorizontalIcon className="size-4" />
            </div>
            <div>
              <h2 id="filter-modal-title" className="text-base font-semibold text-ink">
                Filters &amp; Sort
              </h2>
              <p className="text-xs text-ink-3">Refine government jobs across India</p>
            </div>
            {totalActiveCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-accent text-on-accent">
                {totalActiveCount} active
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {/* Two-Pane Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left Rail (Tabs) */}
          <div className="w-[140px] sm:w-[190px] shrink-0 border-r border-line bg-surface-2 overflow-y-auto">
            <nav className="flex flex-col py-1.5" aria-label="Filter Categories">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                const IconComponent = tab.icon;
                const count = activeCounts[tab.key] ?? 0;

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.key);
                      setSearchTerm("");
                    }}
                    className={cn(
                      "relative flex items-center justify-between gap-2 px-3 sm:px-4 py-3 text-left text-xs sm:text-sm font-medium transition-colors",
                      isActive
                        ? "bg-surface text-ink font-semibold shadow-xs"
                        : "text-ink-2 hover:bg-surface/50 hover:text-ink",
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1 bottom-1 w-1 bg-accent rounded-r" />
                    )}
                    <div className="flex items-center gap-2 min-w-0">
                      <IconComponent
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          isActive ? "text-accent" : "text-ink-3",
                        )}
                      />
                      <span className="truncate">{tab.label}</span>
                    </div>
                    {count > 0 && (
                      <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent text-[10px] font-bold">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Panel (Options) */}
          <div className="flex flex-1 flex-col min-w-0 bg-surface">
            {/* Search Input for categories with many options */}
            {activeTab !== "sort" && (
              <div className="px-4 pt-3 pb-2 border-b border-line shrink-0">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-3" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                    }}
                    placeholder={`Search ${TABS.find((t) => t.key === activeTab)?.label.toLowerCase() ?? ""}…`}
                    className="h-8.5 w-full rounded-lg border border-line bg-surface-2 pr-3 pl-8.5 text-xs text-ink placeholder:text-ink-3 focus:border-accent-line focus:bg-surface transition-colors"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm("");
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
                    >
                      <CloseIcon className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Options List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {activeTab === "sort" ? (
                // Sort Options
                JOB_SORT_OPTIONS.map((opt) => {
                  const isSelected = draftSort === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setDraftSort(opt.value);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between p-3 rounded-xl border text-left transition-all",
                        isSelected
                          ? "border-accent bg-accent-soft/30 text-ink shadow-xs"
                          : "border-line bg-surface hover:border-line-strong hover:bg-surface-2 text-ink-2",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", isSelected && "text-accent font-semibold")}>
                          {opt.label}
                        </p>
                        <p className="text-xs text-ink-3 mt-0.5">{opt.desc}</p>
                      </div>
                      <div
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          isSelected ? "border-accent bg-accent text-on-accent" : "border-line-strong",
                        )}
                      >
                        {isSelected && <span className="size-2 rounded-full bg-on-accent" />}
                      </div>
                    </button>
                  );
                })
              ) : (
                // Filter Category Options
                displayedOptions.length > 0 ? (
                  displayedOptions.map((opt) => {
                    const isSelected = draftFilters[activeTab] === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          toggleFilter(activeTab, opt.value);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between p-3 rounded-xl border text-left transition-all",
                          isSelected
                            ? "border-accent bg-accent-soft/30 text-ink shadow-xs"
                            : "border-line bg-surface hover:border-line-strong hover:bg-surface-2 text-ink-2",
                        )}
                      >
                        <span
                          className={cn(
                            "text-sm font-medium min-w-0 pr-2",
                            isSelected ? "text-accent font-semibold" : "text-ink",
                          )}
                        >
                          {opt.label}
                        </span>
                        <div
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                            isSelected
                              ? "border-accent bg-accent text-on-accent"
                              : "border-line-strong bg-surface",
                          )}
                        >
                          {isSelected && <CheckIcon className="size-3.5 stroke-[2.5]" />}
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center text-xs text-ink-3">
                    No options matching &ldquo;{searchTerm}&rdquo;
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-line bg-surface shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={totalActiveCount === 0}
            className="px-3 py-2 text-xs sm:text-sm font-medium text-ink-3 hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Clear all
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 text-xs sm:text-sm font-medium rounded-lg border border-line bg-surface text-ink hover:bg-surface-2 hover:border-line-strong active:translate-y-px transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="h-9 px-5 text-xs sm:text-sm font-semibold rounded-lg bg-accent text-on-accent hover:bg-accent-hover active:translate-y-px transition-colors shadow-xs flex items-center justify-center gap-1.5"
            >
              Apply filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}