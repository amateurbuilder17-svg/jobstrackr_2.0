"use client";

import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionResult, AdminFormState } from "@/lib/admin/actions";

/**
 * The admin console's only general-purpose client component.
 *
 * It exists for one reason: an admin needs to be told what a write actually
 * did. "Merged 3,912 duplicate listings" and "Merge failed: statement timeout"
 * are different outcomes, and a form that redirects and looks the same either
 * way makes them indistinguishable. `useActionState` keeps the returned message
 * on screen; `useFormStatus` inside `SubmitButton` stops a second click landing
 * a second merge.
 *
 * Which is what `canSubmit` is for, and it is subtler than it looks. These
 * actions call `revalidatePath`, so a successful write re-renders the page —
 * and on the write that clears the *last* row, a page that swapped the form out
 * for an "all clear" message would unmount this component and take the result
 * with it. The confirmation would vanish at exactly the moment it was most
 * worth reading: you would fix the final forty listings and be shown an empty
 * table, with no way to tell success from a silent no-op. So the calling pages
 * keep the form mounted and pass `canSubmit={false}` instead, which hides the
 * button and leaves the message where it is.
 *
 * Everything else on these pages is server-rendered HTML. This wrapper is
 * deliberately small enough that adding it to a page is not a bundle decision.
 */

type Action = (prev: AdminFormState, formData: FormData) => Promise<ActionResult>;

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "secondary",
  size = "sm",
  className,
  /** Rendered instead of a plain submit button, when the trigger is bespoke. */
  footer,
  /**
   * Whether there is anything left to submit. False hides the button and keeps
   * everything else — see below for why that is not the same as unmounting.
   */
  canSubmit = true,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  footer?: ReactNode;
  canSubmit?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}

      <div className="flex flex-wrap items-center gap-3">
        {canSubmit
          ? (footer ?? (
              <SubmitButton
                variant={variant}
                size={size}
                pendingLabel={pendingLabel ?? "Working…"}
              >
                {submitLabel}
              </SubmitButton>
            ))
          : null}
        <Result state={state} />
      </div>
    </form>
  );
}

/**
 * A one-line result, not a toast.
 *
 * `aria-live="polite"` because the message replaces nothing visible — a screen
 * reader would otherwise get no indication that pressing the button did
 * anything at all.
 */
export function Result({ state }: { state: AdminFormState }) {
  if (!state) return null;

  return (
    <p aria-live="polite" className={`text-xs ${state.ok ? "text-good" : "text-critical"}`}>
      {state.message}
    </p>
  );
}

/**
 * A single button that posts one hidden field — a row-level toggle.
 *
 * Its own form, so each row submits independently and the page needs no
 * client-side selection state at all.
 */
export function RowAction({
  action,
  fields,
  label,
  pendingLabel,
  variant = "ghost",
  confirm,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Native confirm for the destructive ones. Enough for a three-person tool. */
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="inline-flex items-center gap-2"
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size="sm" pendingLabel={pendingLabel ?? "…"}>
        {label}
      </SubmitButton>
      {state && !state.ok ? (
        <span aria-live="polite" className="text-2xs text-critical">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Re-exported so pages can render a bare button without importing two modules. */
export { Button };
