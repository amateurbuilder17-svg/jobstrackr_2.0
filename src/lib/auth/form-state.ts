/**
 * Form plumbing shared by the actions and the forms.
 *
 * Separate from `actions.ts` because a `"use server"` module may only export
 * async functions — Next turns each export into a callable server endpoint, so
 * a plain constant or a synchronous helper there is a build error rather than a
 * style question. Everything that is not itself an action lives here.
 */

/**
 * The shape every form in this milestone reads back from `useActionState`.
 *
 * `errors` is keyed by field name so an input can render its own message, with
 * `form` reserved for failures that belong to no single field. Success is
 * usually a redirect rather than a returned state — the exceptions are the
 * flows that stay on the page and say something ("check your email").
 */
export interface FormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  /**
   * Set when the action stopped because there is no signed-in user, holding the
   * path to return to afterwards.
   *
   * An action in that position used to `redirect` to /sign-in. That is the same
   * mistake the protected pages made: the person typed something, and what came
   * back was a password field with no explanation and their input gone. A form
   * that reads this renders `<SignInPrompt>` beside the field instead — the
   * reason, a button, and the query still where they left it.
   */
  authRequired?: string;
}

export const EMPTY_FORM_STATE: FormState = { ok: false };

/**
 * Constrains a `next` parameter to a path on this site.
 *
 * `next` arrives from the query string, which anyone can write. Passing it to
 * `redirect` unchecked is an open redirect: a link to
 * `jobstrackr.in/sign-in?next=https://evil.example` would sign a user in and
 * then hand them to an attacker's page, carrying this site's credibility with
 * it. Only a single-slash-prefixed relative path survives — `//evil.example` is
 * protocol-relative and is rejected with the rest.
 */
export function safeNext(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string") return "/profile";
  if (!value.startsWith("/") || value.startsWith("//")) return "/profile";
  return value;
}
