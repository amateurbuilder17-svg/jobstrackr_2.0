import Link from "next/link";

import { LockIcon } from "@/components/icons";

/**
 * The in-form counterpart to `<SignInRequired>`.
 *
 * Same idea at a smaller size: an action refused for want of an account says so
 * where the person is looking, rather than navigating them away from a form
 * they had already filled in. Rendered from `FormState.authRequired`, which
 * carries the path to come back to.
 *
 * Not a client component, and it does not need to be — it is a paragraph and a
 * link. Importing it from a Client Component bundles it there, which costs
 * nothing next to what it replaces.
 */
export function SignInPrompt({ message, next }: { message: string; next: string }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2/60 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <LockIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-ink-2">{message}</p>
      </div>

      <div className="flex shrink-0 gap-2">
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className={
            "inline-flex h-9 items-center justify-center rounded-xl bg-accent px-4 " +
            "text-sm font-semibold text-on-accent transition-colors " +
            "duration-(--duration-fast) hover:bg-accent-hover"
          }
        >
          Sign in
        </Link>
        <Link
          href={`/sign-up?next=${encodeURIComponent(next)}`}
          className={
            "inline-flex h-9 items-center justify-center rounded-xl border border-line " +
            "bg-surface px-4 text-sm font-medium text-ink transition-colors " +
            "duration-(--duration-fast) hover:border-line-strong hover:bg-surface-2"
          }
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
