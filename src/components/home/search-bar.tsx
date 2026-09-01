"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, CloseIcon, SearchIcon, SlidersHorizontalIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

export const FILTER_GROUPS = [
  {
    label: "Qualification",
    options: ["Class 10", "Class 12", "Graduate", "Engineering", "Diploma", "Post Graduate"],
  },
  {
    label: "Deadline",
    options: ["Closing today", "Within 3 days", "This month"],
  },
  {
    label: "Location",
    options: ["All India", "Maharashtra", "Odisha", "Bihar", "Delhi", "Uttar Pradesh"],
  },
];

export function SearchBar({
  value,
  onChange,
  filters,
  onToggleFilter,
  onClearAll,
}: {
  value: string;
  onChange: (v: string) => void;
  filters: string[];
  onToggleFilter: (option: string) => void;
  onClearAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const panelId = useId();

  // Close dropdown on click outside or escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative space-y-2">
      <div className="flex items-center gap-2">
        {/* Search Input Box */}
        <div
          className={cn(
            "group flex h-10 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 shadow-xs transition-all duration-200",
            "focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15 focus-within:shadow-card-hover",
          )}
        >
          <SearchIcon
            className="size-4 shrink-0 text-muted-foreground transition-colors duration-200 group-focus-within:text-brand"
            aria-hidden="true"
          />

          <label htmlFor={inputId} className="sr-only">
            Search exams, jobs, organizations
          </label>

          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            placeholder="Search exams, jobs, organizations..."
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/75"
          />

          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
              }}
              aria-label="Clear search text"
              className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <CloseIcon className="size-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* Separate Filters Button */}
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 text-xs font-bold shadow-xs transition-all duration-200 active:scale-95",
            open || filters.length > 0
              ? "border-brand bg-brand text-primary-foreground shadow-sm"
              : "text-foreground hover:border-brand/30 hover:bg-surface-2",
          )}
        >
          <SlidersHorizontalIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Filters</span>
          {filters.length > 0 ? (
            <span
              className={cn(
                "grid size-4 place-items-center rounded-full text-[10px] tabular-nums font-extrabold",
                open || filters.length > 0
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-brand-soft text-brand-deep",
              )}
            >
              {filters.length}
            </span>
          ) : null}
        </button>
      </div>

      {/* Active Filter Chips */}
      {filters.length > 0 ? (
        <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 py-0.5">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider shrink-0 pr-0.5">
            Active:
          </span>
          {filters.map((filter) => (
            <span
              key={filter}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand/20 bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand-deep shadow-xs animate-in fade-in duration-150"
            >
              {filter}
              <button
                type="button"
                onClick={() => {
                  onToggleFilter(filter);
                }}
                aria-label={`Remove filter ${filter}`}
                className="grid size-3.5 place-items-center rounded-full hover:bg-brand/15 text-brand-deep"
              >
                <CloseIcon className="size-2.5" aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => {
              if (onClearAll) {
                onClearAll();
              } else {
                filters.forEach((f) => {
                  onToggleFilter(f);
                });
              }
            }}
            className="shrink-0 text-xs font-bold text-muted-foreground hover:text-foreground underline underline-offset-2 px-1 transition-colors"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* Filter Popover Panel */}
      {open ? (
        <div
          id={panelId}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-30 rounded-xl border border-border bg-card p-3.5 shadow-card-hover animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="section-label">Filter & Refine</span>
              {filters.length > 0 ? (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-deep">
                  {filters.length} selected
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {filters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onClearAll) {
                      onClearAll();
                    } else {
                      filters.forEach((f) => {
                        onToggleFilter(f);
                      });
                    }
                  }}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  Reset
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => {
                  setOpen(false);
                }}
                className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
              >
                <CloseIcon className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            {FILTER_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-bold text-foreground">{group.label}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {group.options.map((option) => {
                    const isSelected = filters.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          onToggleFilter(option);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-150 active:scale-95",
                          isSelected
                            ? "bg-brand text-primary-foreground shadow-xs"
                            : "bg-secondary text-secondary-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {isSelected ? (
                          <CheckIcon className="size-3" aria-hidden="true" />
                        ) : null}
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3.5 pt-2.5 border-t border-border/60 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
              className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-pill hover:bg-brand-deep transition-colors active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
