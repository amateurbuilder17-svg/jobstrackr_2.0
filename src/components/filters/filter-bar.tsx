"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { CloseIcon, SlidersHorizontalIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { FilterOption } from "./filter-chips";
// Type-only, so it is erased at compile time and the sheet stays out of the
// first-load graph. It exists to type the shared promise below without an
// inline `import()` annotation, which the lint config forbids.
import type * as FilterModalModule from "./filter-modal";
import { useFilterParams } from "./use-filter-params";

export type { FilterOption };

/**
 * The filter sheet, kept out of first-load JavaScript.
 *
 * `FilterModal` is 400 lines and returns `null` until it is opened, so on the
 * four routes that carry this bar — `/jobs`, `/updates`, `/saved`, `/for-you` —
 * every byte of it was being downloaded and parsed to render nothing. It is the
 * same trade the printable syllabus sheet already makes (see the dynamic import
 * in `syllabus/[slug]/syllabus-actions.tsx`).
 *
 * The single shared promise is the point of writing this longhand. `dynamic()`
 * begins loading when its component first *renders*, not when a prop changes,
 * which is why `FilterBar` below must not mount the sheet until it is wanted —
 * and why the warm-up needs to resolve to the very same promise rather than
 * kicking off a second request.
 */
let sheetModule: Promise<typeof FilterModalModule> | undefined;
const loadSheet = () => (sheetModule ??= import("./filter-modal"));

/**
 * The same load, as a handler.
 *
 * `loadSheet` returns the promise because `dynamic()` needs it; an event
 * handler must not, or the returned promise goes unhandled. Hence two names for
 * one request rather than a floating `Promise` in the JSX.
 */
const warmSheet = () => {
  void loadSheet();
};

const FilterModal = dynamic(() => loadSheet().then((m) => m.FilterModal), {
  // Nothing to server-render: the sheet is closed on load, and it is only ever
  // mounted in response to a press.
  ssr: false,
  loading: () => <FilterSheetFallback />,
});

/**
 * Shown only if the press lands before the chunk does.
 *
 * A sheet-shaped placeholder rather than `null`, because `null` makes the
 * button look broken on a slow connection — the press appears to do nothing.
 * Deliberately a handful of elements: this one *does* ship in first-load JS,
 * so it has to cost less than the 400 lines it stands in for.
 */
function FilterSheetFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center lg:justify-center">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative h-[70vh] w-full rounded-t-2xl bg-surface lg:h-auto lg:max-w-lg lg:rounded-2xl">
        <div className="flex h-14 items-center border-b border-line px-5">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="flex flex-col gap-3 p-5">
          <div className="h-9 animate-pulse rounded-full bg-surface-2" />
          <div className="h-9 w-3/4 animate-pulse rounded-full bg-surface-2" />
          <div className="h-9 w-1/2 animate-pulse rounded-full bg-surface-2" />
        </div>
        <span className="sr-only" role="status">
          Loading filters
        </span>
      </div>
    </div>
  );
}

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
  /**
   * Whether the sheet has ever been opened.
   *
   * Separate from `isModalOpen` because it is one-way: once the sheet has been
   * mounted it stays mounted, so closing and reopening behaves exactly as it did
   * before this was deferred. What it prevents is the initial render mounting
   * the sheet — which would download the chunk on page load and undo the split.
   */
  const [hasOpenedModal, setHasOpenedModal] = useState(false);

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
    setHasOpenedModal(true);
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
          /**
           * Warm-up, so the split costs nothing anyone can feel.
           *
           * Three events rather than one, because they cover the three ways this
           * button gets pressed: `pointerenter` is the desktop hover, `focus` is
           * the keyboard, and `pointerdown` is touch — it fires before `click`,
           * which is the only pre-press signal a phone gives. Idle prefetching
           * was the alternative and is worse: it spends the bytes on every
           * visitor, including the majority who never open the filters.
           */
          onPointerEnter={warmSheet}
          onPointerDown={warmSheet}
          onFocus={warmSheet}
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

      {/* Enterprise Filter Modal — mounted on first open, then kept. */}
      {hasOpenedModal && (
        <FilterModal
          open={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
          }}
          initialTab={modalTab}
        />
      )}
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
