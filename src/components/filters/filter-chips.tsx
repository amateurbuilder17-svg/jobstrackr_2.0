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
 * Rendered as real buttons rather than a `<select>`: on mobile these are the
 * primary way people narrow a list, and a native select buries the options
 * behind a system sheet. `aria-pressed` carries the state for anyone not
 * seeing the fill.
 *
 * Scrolls sideways rather than wrapping. Eight categories wrapped to three
 * lines on a 375px screen, which pushed the first result below the fold — the
 * same measurement that reshaped `FilterBar`.
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

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "-mx-4 flex gap-2 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {options.map((option) => {
        const isActive = active === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              // Pressing the active chip clears it, which is what the close
              // icon promises and what a second tap should do anyway.
              set(param, isActive ? null : option.value);
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1",
              "text-xs font-medium whitespace-nowrap",
              "transition-colors duration-(--duration-fast)",
              isActive
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            {option.label}
            {isActive ? <CloseIcon className="size-3" /> : null}
          </button>
        );
      })}
    </div>
  );
}
