"use client";

import { CloseIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { useFilterParams } from "./use-filter-params";

export interface FilterOption {
  label: string;
  value: string;
}

/**
 * A single-select filter row, written to the URL.
 *
 * Matching the FilterBar design language from the jobs page:
 * - Height 9 (h-9) rounded-full buttons.
 * - Active filter pill with close icon and accent highlight.
 * - "Clear all" link button when a filter is active.
 * - Horizontal smooth scrolling with hidden scrollbars.
 */
export function FilterChips({
  param,
  options,
  label,
}: {
  param: string;
  options: FilterOption[];
  label: string;
}) {
  const { params, set } = useFilterParams();
  const active = params.get(param);

  const activeOption = options.find((o) => o.value === active);

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1.5 lg:mx-0 lg:px-0",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {/* Active Filter Removable Pill */}
      {active && activeOption && (
        <>
          <button
            type="button"
            onClick={() => {
              set(param, null);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft/70"
          >
            <span>{activeOption.label}</span>
            <CloseIcon className="size-3" />
            <span className="sr-only">— remove {activeOption.label} filter</span>
          </button>

          <button
            type="button"
            onClick={() => {
              set(param, null);
            }}
            className="h-9 shrink-0 px-2 text-xs font-semibold text-ink-3 underline-offset-4 hover:text-accent hover:underline"
          >
            Clear all
          </button>

          <div className="h-4 w-px bg-line shrink-0 mx-0.5" />
        </>
      )}

      {/* Filter Options */}
      {options.map((option) => {
        const isActive = active === option.value;
        if (isActive) return null; // Already rendered as active pill above

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={false}
            onClick={() => {
              set(param, option.value);
            }}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full border border-line px-3.5",
              "bg-surface text-xs font-medium whitespace-nowrap text-ink-2",
              "transition-colors duration-(--duration-fast)",
              "hover:border-line-strong hover:text-ink hover:bg-surface-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
