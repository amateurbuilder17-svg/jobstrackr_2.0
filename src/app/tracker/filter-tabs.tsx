"use client";

import { cn } from "@/lib/cn";

export type FilterKey = "all" | "action" | "upcoming" | "completed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Action" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
];

export function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: FilterKey;
  onChange: (key: FilterKey) => void;
  counts?: Partial<Record<FilterKey, number>>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter exams"
      className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1"
    >
      {FILTERS.map((f) => {
        const active = f.key === value;
        const count = counts?.[f.key];

        return (
          <button
            key={f.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => {
              onChange(f.key);
            }}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.97]",
              active
                ? "bg-brand text-primary-foreground shadow-pill"
                : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <span>{f.label}</span>
            {count !== undefined && count > 0 ? (
              <span
                className={cn(
                  "grid size-4.5 place-items-center rounded-full text-[10px] tabular-nums font-bold",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
