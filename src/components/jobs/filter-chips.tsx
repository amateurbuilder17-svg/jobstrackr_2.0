"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { CloseIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

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
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get(param);

  function select(value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== active) next.set(param, value);
    else next.delete(param);
    next.delete("after"); // a changed filter invalidates the current cursor
    router.replace(next.toString() ? `/jobs?${next.toString()}` : "/jobs", { scroll: false });
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = active === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              select(option.value);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium",
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
