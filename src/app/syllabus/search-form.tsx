"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useId } from "react";

import { SearchIcon } from "@/components/icons";
import { Field, FormError, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { searchSyllabusAction } from "@/lib/syllabus/actions";

/**
 * The search box.
 *
 * On a miss this submit takes 25–35 seconds — a grounded model call reads the
 * web before it answers, and there is no honest way to make that fast. So the
 * pending state is not a spinner on a button; it is a sentence that says what
 * is happening and roughly how long it will take, because a control that looks
 * stuck for half a minute gets pressed again.
 *
 * The default comes from the URL so the sign-in round trip preserves the
 * search: a guest who searches, gets bounced to sign in, and comes back to an
 * empty box has been made to do the work twice.
 *
 * It is read here with `useSearchParams` rather than passed down from the page,
 * and that is a Cache Components requirement rather than a preference. Awaiting
 * `searchParams` in the page makes the whole route dynamic — the build refuses
 * it outright — so the query is read on the client, inside the `<Suspense>`
 * boundary the page puts around this component. `SearchField` in the top bar
 * does the same thing for the same reason.
 */
export function SyllabusSearchForm() {
  const [state, action, pending] = useActionState(searchSyllabusAction, EMPTY_FORM_STATE);
  const initialQuery = useSearchParams().get("q") ?? "";
  const id = useId();
  const fieldId = `${id}-q`;

  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <FormError>{state.errors?.form}</FormError>

      <Field
        id={fieldId}
        label="Exam name"
        error={state.errors?.q}
        hint="The name or its abbreviation — SSC CGL, RRB NTPC, UPSC CSE."
      >
        <div className="flex gap-2">
          <Input
            id={fieldId}
            name="q"
            type="search"
            defaultValue={initialQuery}
            required
            autoComplete="off"
            disabled={pending}
            error={state.errors?.q}
            placeholder="SSC CGL"
            className="flex-1"
          />
          <SubmitButton variant="primary" pendingLabel="Searching…">
            <SearchIcon className="size-4" />
            Search
          </SubmitButton>
        </div>
      </Field>

      {pending ? (
        // `role="status"` rather than an alert: this is progress, not a
        // problem, and it should be announced without interrupting.
        <p role="status" className="!mt-0 text-sm text-ink-2">
          Reading official sources for this exam. This takes about half a minute — the answer is
          fetched fresh and then kept for everyone.
        </p>
      ) : null}
    </form>
  );
}
