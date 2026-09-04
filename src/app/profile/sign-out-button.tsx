import { signOutAction } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { SignOutIcon } from "@/components/icons";

/**
 * A form rather than a link, because signing out is a state change. As a GET
 * link it would be followed by any prefetcher or link-scanner that touched the
 * page, signing the user out without them clicking anything.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SubmitButton
        variant="ghost"
        size="sm"
        pendingLabel="Signing out…"
        className="rounded-xl border border-line bg-surface text-ink-2 hover:border-critical/40 hover:bg-critical-soft/30 hover:text-critical transition-colors"
      >
        <SignOutIcon className="size-3.5" aria-hidden="true" />
        <span>Sign out</span>
      </SubmitButton>
    </form>
  );
}
