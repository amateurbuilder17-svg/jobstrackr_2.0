import { signOutAction } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * A form rather than a link, because signing out is a state change. As a GET
 * link it would be followed by any prefetcher or link-scanner that touched the
 * page, signing the user out without them clicking anything.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SubmitButton variant="ghost" size="sm" pendingLabel="Signing out…">
        Sign out
      </SubmitButton>
    </form>
  );
}
