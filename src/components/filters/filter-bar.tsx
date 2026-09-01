"use client";

import { useState } from "react";

import { CloseIcon, SlidersHorizontalIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { FilterModal } from "./filter-modal";
import type { FilterOption } from "./filter-chips";
import { useFilterParams } from "./use-filter-params";

export type { FilterOption };

export interface FilterGroup {
  /** URL parameter this group writes to. */
  param: string;
  /** Announced to screen readers, and the sheet's section heading. */
  label: string;
  iconName?: string;
  options: FilterOption[];
}

/**
 * The filter row.
 *
 * One horizontally scrolling line with a prominent Filter modal trigger,
 * active filter removable pills, and quick filter shortcuts.
 */
export function FilterBar({ groups }: { groups: FilterGroup[] }) {
  const { params, set, clearAll } = useFilterParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<string>("sort");

  // Collect all active filters from the URL
  const active = groups.flatMap((group) => {
    const value = params.get(group.param);
    if (!value) return [];
    const option = group.options.find((o) => o.value === value);
    return [{ group, value, label: option?.label ?? value }];
  });

  const sortValue = params.get("sort");
  const isSortActive = sortValue && sortValue !== "closing";
  const totalActiveCount = active.length + (isSortActive ? 1 : 0);

  const openFilter = (tab = "sort") => {
    setModalTab(tab);
    setIsModalOpen(true);
  };

  // Quick filter shortcuts to display when inactive
  const quickShortcuts = [
    { param: "level", value: "bachelor", label: "Graduate" },
    { param: "level", value: "class_10", label: "10th Pass" },
    { param: "stream", value: "engineering", label: "Engineering" },
    { param: "sector", value: "railway", label: "Railways" },
    { param: "sector", value: "banking", label: "Banking" },
    { param: "sector", value: "defence", label: "Defence" },
    { param: "state", value: "All India", label: "All India" },
    { param: "state", value: "Delhi", label: "Delhi" },
    { param: "state", value: "Maharashtra", label: "Maharashtra" },
    { param: "state", value: "Uttar Pradesh", label: "Uttar Pradesh" },
  ];

  return (
    <>
      <div
        className={cn(
          "-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1.5 lg:mx-0 lg:px-0",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {/* Primary Filter Button */}
        <button
          type="button"
          onClick={() => {
            openFilter("sort");
          }}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold shadow-xs",
            "transition-all duration-(--duration-fast)",
            totalActiveCount > 0
              ? "border-accent bg-accent text-on-accent hover:bg-accent-hover active:translate-y-px"
              : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
          )}
        >
          <SlidersHorizontalIcon className="size-3.5" />
          <span>Filters</span>
          {totalActiveCount > 0 && (
            <span className="flex size-4.5 items-center justify-center rounded-full bg-on-accent text-accent text-[10px] font-bold">
              {totalActiveCount}
            </span>
          )}
        </button>

        {/* Active Filter Removable Pills */}
        {isSortActive && (
          <button
            type="button"
            onClick={() => {
              set("sort", null);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft/70"
          >
            <span>Sort: {sortValue === "vacancy" ? "Highest vacancy" : "Newest"}</span>
            <CloseIcon className="size-3" />
            <span className="sr-only">— remove sort filter</span>
          </button>
        )}

        {active.map(({ group, label }) => (
          <button
            key={group.param}
            type="button"
            onClick={() => {
              set(group.param, null);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft/70"
          >
            <span>{label}</span>
            <CloseIcon className="size-3" />
            <span className="sr-only">— remove this {group.label.toLowerCase()} filter</span>
          </button>
        ))}

        {totalActiveCount > 0 && (
          <button
            type="button"
            onClick={() => {
              clearAll(["q"]);
            }}
            className="h-9 shrink-0 px-2 text-xs font-semibold text-ink-3 underline-offset-4 hover:text-accent hover:underline"
          >
            Clear all
          </button>
        )}

        {/* Separator if active filters exist */}
        {totalActiveCount > 0 && <div className="h-4 w-px bg-line shrink-0 mx-0.5" />}

        {/* Quick Filter Shortcuts */}
        {quickShortcuts.map((shortcut) => {
          const isSelected = params.get(shortcut.param) === shortcut.value;
          if (isSelected) return null; // Already rendered in active list above

          return (
            <button
              key={`${shortcut.param}-${shortcut.value}`}
              type="button"
              onClick={() => {
                set(shortcut.param, shortcut.value);
              }}
              className={cn(
                "inline-flex h-9 shrink-0 items-center rounded-full border border-line px-3.5",
                "bg-surface text-xs font-medium whitespace-nowrap text-ink-2",
                "transition-colors duration-(--duration-fast)",
                "hover:border-line-strong hover:text-ink hover:bg-surface-2",
              )}
            >
              {shortcut.label}
            </button>
          );
        })}
      </div>

      {/* Enterprise Filter Modal */}
      <FilterModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
        }}
        initialTab={modalTab}
      />
    </>
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
