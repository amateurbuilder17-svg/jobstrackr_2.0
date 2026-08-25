"use client";

import { CloseIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { FilterOption } from "./filter-chips";
import { useFilterParams } from "./use-filter-params";

export type { FilterOption };

export interface FilterGroup {
  /** URL parameter this group writes to. */
  param: string;
  /** Announced to screen readers, and the sheet's section heading. */
  label: string;
  options: FilterOption[];
}

/**
 * The filter row.
 *
 * One horizontally scrolling line, not four wrapped ones.
 *
 * The previous version rendered each group as its own wrapping `flex-wrap` row.
 * On a 375px screen that came to twelve chips over four lines which, with the
 * page heading and the description sentence above them, pushed the first job
 * below the fold — the list of jobs opened with no jobs on it. Nothing said
 * which chips were qualifications and which were states either, because the two
 * groups rendered identically.
 *
 * So: active filters come first, as removable chips, then the rest scroll
 * sideways. A person who has filtered sees what they filtered by without
 * scrolling; a person who has not sees the common starting points.
 *
 * `overflow-x-auto` on this element alone — the page body must never scroll
 * sideways, which is both a GIGW test and the difference between a list that
 * feels solid and one that feels broken.
 */
export function FilterBar({ groups }: { groups: FilterGroup[] }) {
  const { params, push, set } = useFilterParams();

  const active = groups.flatMap((group) => {
    const value = params.get(group.param);
    if (!value) return [];
    const option = group.options.find((o) => o.value === value);
    return [{ group, value, label: option?.label ?? value }];
  });

  const activeParams = new Set(active.map((a) => a.group.param));
  const inactive = groups.filter((group) => !activeParams.has(group.param));

  return (
    <div
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 lg:mx-0 lg:px-0",
        // Hides the scrollbar without hiding the scroll. The row is short and a
        // permanent bar under it reads as a stray rule.
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {active.map(({ group, label }) => (
        <button
          key={group.param}
          type="button"
          onClick={() => {
            set(group.param, null);
          }}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5",
            "border-accent-line bg-accent-soft text-xs font-semibold text-accent",
            "transition-colors duration-(--duration-fast) hover:bg-accent-soft/70",
          )}
        >
          {label}
          <CloseIcon className="size-3" />
          <span className="sr-only">— remove this {group.label.toLowerCase()} filter</span>
        </button>
      ))}

      {active.length > 1 ? (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            for (const group of groups) next.delete(group.param);
            push(next);
          }}
          className="h-9 shrink-0 px-1.5 text-xs font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
        >
          Clear all
        </button>
      ) : null}

      {inactive.map((group) => (
        <div key={group.param} role="group" aria-label={group.label} className="contents">
          {group.options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                set(group.param, option.value);
              }}
              className={cn(
                "inline-flex h-9 shrink-0 items-center rounded-full border border-line px-3.5",
                "bg-surface text-xs font-medium whitespace-nowrap text-ink-2",
                "transition-colors duration-(--duration-fast)",
                "hover:border-line-strong hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export interface SortOption {
  value: string;
  label: string;
}

/**
 * A two-way sort switch, written to the URL.
 *
 * Two options per route, not five. Every additional sort key multiplies the
 * prerendered variants — and combined with filters that becomes a
 * combinatorial set of cached pages, each of which costs a cold database read
 * the first time anyone asks for it.
 *
 * The first option is the default and is represented by the *absence* of the
 * parameter, so the canonical URL of a list is the bare path rather than one
 * carrying a redundant `?sort=`.
 */
export function SortToggle({
  param = "sort",
  options,
  label = "Sort by",
}: {
  param?: string;
  options: readonly [SortOption, SortOption];
  label?: string;
}) {
  const { params, set } = useFilterParams();

  const [fallback, alternate] = options;
  const current = params.get(param) === alternate.value ? alternate.value : fallback.value;

  return (
    <div className="flex shrink-0 items-center gap-1 text-xs">
      <span className="sr-only" id={`${param}-label`}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${param}-label`}
        className="flex rounded-full border border-line bg-surface p-0.5"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={current === option.value}
            onClick={() => {
              set(param, option.value === fallback.value ? null : option.value);
            }}
            className={cn(
              "flex h-8 items-center rounded-full px-3 font-medium whitespace-nowrap",
              "transition-colors duration-(--duration-fast)",
              current === option.value
                ? "bg-accent-soft text-accent"
                : "text-ink-3 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
