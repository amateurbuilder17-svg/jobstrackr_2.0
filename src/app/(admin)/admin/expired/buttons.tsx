"use client";

import { useFormStatus } from "react-dom";

/**
 * Archive and delete, as two submits of the same form.
 *
 * Each carries `name="intent"`, and a submit button contributes its value to the
 * FormData only when it is the one that was pressed — so the server action can
 * tell which was clicked without the page holding any selection state of its
 * own. See `expiredJobsAction` for why this rather than two `formAction`s.
 *
 * A client component purely for `useFormStatus`, which needs to be inside the
 * form to read it. Disabling both while one is in flight is the point: these
 * operate on a checkbox selection, and a double-click that fired archive twice
 * would be harmless while one that fired delete twice would not be.
 */
export function ExpiredButtons({ deletable, total }: { deletable: number; total: number }) {
  const { pending } = useFormStatus();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        name="intent"
        value="archive"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? "Working…" : "Archive selected"}
      </button>

      {/*
        Visually a danger button, and that is not decoration. These two sit one
        keystroke apart above a table of hundreds of rows, and at the moment of
        pressing, the only thing separating "reversible" from "gone" is how they
        look.
      */}
      <button
        type="submit"
        name="intent"
        value="delete"
        disabled={pending || deletable === 0}
        aria-busy={pending}
        className="inline-flex h-8 items-center rounded-md bg-critical px-3 text-xs font-medium text-white transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
      >
        Delete selected
      </button>

      <span className="text-2xs text-ink-3">
        {deletable === total
          ? "nothing on this page is held by anyone"
          : `${String(total - deletable)} of ${String(total)} here are saved or reminded on, and can only be archived`}
      </span>
    </div>
  );
}
