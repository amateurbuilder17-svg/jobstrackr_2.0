import { signInWithGoogleAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

/**
 * The "Continue with Google" block, shared by every signed-out credential
 * screen.
 *
 * It lived twice, copied between the sign-in and sign-up forms, which is how
 * `/forgot-password` ended up without it — the one screen where a Google user
 * is most likely to be stuck, because they never had a password to reset.
 * One component means adding a screen cannot quietly drop the option again.
 *
 * A server component with no state: it renders inside client forms and server
 * pages alike, and the action it posts to is the same either way.
 */
export function GoogleAuth({ next, label }: { next?: string | undefined; label?: string }) {
  return (
    <div className="flex flex-col gap-5">
      <form action={signInWithGoogleAction}>
        <input type="hidden" name="next" value={next ?? ""} />
        <Button type="submit" variant="secondary" size="lg" className="w-full">
          <GoogleMark />
          {label ?? "Continue with Google"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

/**
 * Google's mark, at its fixed brand colours — the one icon in the app that
 * cannot inherit `currentColor`, since recolouring it is against the terms
 * that let us show it at all. Sized in `em` so it tracks the button's text.
 */
function GoogleMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      width="1.15em"
      height="1.15em"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}
