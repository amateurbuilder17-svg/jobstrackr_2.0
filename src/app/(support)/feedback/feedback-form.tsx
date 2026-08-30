"use client";

import { useActionState, useId, useState } from "react";

import { Field, FormError, FormNotice, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useSession } from "@/components/session/session-provider";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { submitFeedbackAction } from "@/lib/feedback/actions";
import { FEEDBACK_KINDS, FEEDBACK_LABELS, MESSAGE_MAX } from "@/lib/feedback/kinds";

/**
 * Suggestion or grievance, with or without a name attached.
 *
 * The kind is a radio group styled as two buttons, not a `<select>` and not a
 * pair of `<button>`s with state. There are two options, both should be visible
 * without a tap, and the browser already gives a radio group arrow-key
 * navigation and a single tab stop — which two divs with click handlers would
 * have had to reimplement, and usually do not.
 *
 * The address is filled from the session and disabled when signed in. That is a
 * convenience, not a control: the action reads the address from the session
 * too, and ignores whatever this field posts. Disabling an input in the browser
 * decides nothing about what arrives at the server.
 *
 * The character counter is the one piece of genuinely local state. It exists
 * because the limit is enforced in three places — this component, the Zod
 * schema, and a database constraint — and someone who writes past it should
 * find out while typing rather than on submit.
 */
export function FeedbackForm() {
  const [state, action] = useActionState(submitFeedbackAction, EMPTY_FORM_STATE);
  const { ready, signedIn, identity } = useSession();
  const [length, setLength] = useState(0);
  const [anonymous, setAnonymous] = useState(false);

  const id = useId();
  const emailId = `${id}-email`;
  const messageId = `${id}-message`;

  // Known only after the session resolves. Until then the field is editable and
  // empty, which is the correct state for a guest and a harmless half-second
  // for everyone else — the alternative is disabling an empty field and making
  // it look broken.
  const sessionEmail = ready && signedIn ? identity?.email : null;
  const emailLocked = Boolean(sessionEmail) && !anonymous;

  if (state.ok) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <FormNotice>{state.message}</FormNotice>
        <p className="!mt-0 text-sm text-ink-3">
          Nothing else is needed from you. If you left an address and the message needs a reply,
          it will come from our support address.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-6 flex flex-col gap-5">
      <FormError>{state.errors?.form}</FormError>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="pb-1.5 text-sm font-medium text-ink">What are you sending?</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {FEEDBACK_KINDS.map((kind, index) => (
            <label
              key={kind}
              className={
                "flex cursor-pointer flex-col gap-0.5 rounded-md border border-line " +
                "bg-surface px-3 py-2.5 transition-colors duration-(--duration-fast) " +
                "hover:border-line-strong " +
                "has-checked:border-accent has-checked:bg-accent-soft " +
                "has-focus-visible:ring-2 has-focus-visible:ring-accent/25"
              }
            >
              <span className="flex items-center gap-2">
                {/* Visually hidden rather than `display: none` — a hidden radio
                    is not focusable, which would take the whole group out of
                    the keyboard order. */}
                <input
                  type="radio"
                  name="kind"
                  value={kind}
                  defaultChecked={index === 0}
                  className="sr-only"
                />
                <span className="text-sm font-semibold text-ink">
                  {FEEDBACK_LABELS[kind].label}
                </span>
              </span>
              <span className="text-xs text-ink-3">{FEEDBACK_LABELS[kind].hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label
        className={
          "flex items-start gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5"
        }
      >
        <input
          type="checkbox"
          name="anonymous"
          checked={anonymous}
          onChange={(event) => {
            setAnonymous(event.target.checked);
          }}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-ink">Send anonymously</span>
          <span className="text-xs text-ink-3">
            No address and no account is recorded with the message. We will not be able to
            reply.
          </span>
        </span>
      </label>

      {anonymous ? null : (
        <Field
          id={emailId}
          label="Your email"
          error={state.errors?.email}
          hint={
            emailLocked
              ? "The address on your account. We use this one, whatever the field says."
              : "So we can reply."
          }
        >
          <Input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={sessionEmail ?? ""}
            disabled={emailLocked}
            error={state.errors?.email}
            placeholder="name@example.com"
          />
        </Field>
      )}

      <Field id={messageId} label="Your message" error={state.errors?.message}>
        <Textarea
          id={messageId}
          name="message"
          rows={6}
          maxLength={MESSAGE_MAX}
          required
          error={state.errors?.message}
          onChange={(event) => {
            setLength(event.target.value.length);
          }}
          placeholder="What happened, or what would make this better?"
        />
      </Field>

      <div className="flex items-center justify-between gap-4">
        {/* `aria-live="off"`: this updates on every keystroke, and announcing a
            new number each time would make the field unusable with a screen
            reader. It is a visual aid; the real limit is enforced twice more. */}
        <span
          aria-live="off"
          className={
            "text-xs tabular-nums " +
            (length > MESSAGE_MAX - 100 ? "text-critical" : "text-ink-3")
          }
        >
          {length} / {MESSAGE_MAX}
        </span>
        <SubmitButton variant="primary" pendingLabel="Sending…">
          Send
        </SubmitButton>
      </div>
    </form>
  );
}
