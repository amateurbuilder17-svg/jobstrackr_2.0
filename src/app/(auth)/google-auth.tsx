import { signInWithGoogleAction } from "@/lib/auth/actions";
import { SocialSubmit } from "./auth-submit";
import { AuthDivider } from "./auth-ui";

/**
 * "Continue with Google", in the credential card's own styling.
 *
 * The same shape as `@/components/auth/google-auth` — one form, one hidden
 * `next`, one server action — and it posts to exactly that action. What is not
 * shared is the chrome: the app's version renders a `Button` on paper, and the
 * divider it draws sits above the button rather than below it, which is the
 * wrong order for this card.
 *
 * A Server Component. It renders inside the client forms without pulling
 * anything into their bundles, because `children` crossing that boundary is
 * already-rendered output rather than code.
 */
export function GoogleAuth({ next, label }: { next?: string | undefined; label?: string }) {
  return (
    <>
      <AuthDivider label="or continue with" />
      <form action={signInWithGoogleAction}>
        <input type="hidden" name="next" value={next ?? ""} />
        <SocialSubmit>
          <GoogleMark />
          {label ?? "Continue with Google"}
        </SocialSubmit>
      </form>
    </>
  );
}

/**
 * Google's mark at its fixed brand colours — the one icon on these screens
 * that cannot inherit `currentColor`, because recolouring it is against the
 * terms that permit showing it at all. Sized in `em` so it tracks the button's
 * text at every viewport.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="1.15em" height="1.15em" aria-hidden focusable="false">
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
