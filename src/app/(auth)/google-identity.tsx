"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { getServerTheme, isDark, subscribeToTheme } from "@/components/shell/theme-store";
import styles from "./auth.module.css";

/** Google's own script. One copy per document, however many buttons ask for it. */
const GSI_SRC = "https://accounts.google.com/gsi/client";

/** Long enough to cover a slow first paint, short enough that nobody waits it out. */
const LOAD_TIMEOUT_MS = 6000;

/** How long Google gets to put something in the slot before we stop believing it. */
const RENDER_TIMEOUT_MS = 2500;

/** The label wording, in Google's vocabulary rather than ours. */
export type GoogleButtonText = "signin_with" | "signup_with" | "continue_with";

/**
 * The minimum of Google Identity Services this file touches. Written out rather
 * than pulled from `@types/google.accounts`, because a dependency for four
 * signatures is a dependency to keep upgraded for four signatures.
 */
interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        nonce?: string;
        context?: "signin" | "signup" | "use";
        ux_mode?: "popup" | "redirect";
        itp_support?: boolean;
        use_fedcm_for_prompt?: boolean;
        auto_select?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "small" | "medium" | "large";
          text?: GoogleButtonText;
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
        },
      ): void;
      cancel(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}

/**
 * "Continue with Google", asked for by this origin instead of by Supabase's.
 *
 * The consent screen is the whole reason this component exists. Supabase's
 * hosted auth server always sends Google a `redirect_uri` on
 * `<project-ref>.supabase.co`, and Google labels the account chooser with the
 * host of that URI — so every deployed sign-in read "to continue to
 * wqiffxkakigmtzrficrp.supabase.co". Locally the same client ID produced "to
 * continue to JobsTrackr", not because anything about the credentials differed
 * but because the local callback is on `127.0.0.1`, which Google cannot label a
 * page with, so it falls back to the consent screen's app name.
 *
 * Google Identity Services asks from here instead: this origin, this client ID,
 * no `supabase.co` anywhere in the round trip. The token it returns is posted to
 * `/auth/google`, which trades it for the same Supabase session the redirect
 * flow produced. See `docs/GOOGLE-SIGN-IN.md` for the console settings this needs.
 *
 * `fallback` is the old redirect form, rendered whenever this path cannot run —
 * script blocked, no client ID configured, the POST refused. A sign-in page that
 * has lost its fastest way in should degrade to the slower one, not to nothing.
 */
export function GoogleIdentity({
  clientId,
  next,
  text,
  fallback,
}: {
  clientId: string;
  next?: string | undefined;
  text: GoogleButtonText;
  fallback: ReactNode;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "fallback">("pending");
  const [error, setError] = useState<string | null>(null);

  // The raw nonce stays here and is sent to our own route; Google is given its
  // SHA-256, and Supabase re-hashes the raw one to check the token's claim. That
  // is what binds a token to the button press that asked for it, so a token
  // captured elsewhere cannot be replayed into this session.
  const rawNonce = useRef<string>("");

  // A ref rather than state, and the two effects below are why: the draw effect
  // lists a superset of the configure effect's dependencies, so React runs them
  // in order in the same commit and this is already true by the time it is
  // read. Making it state would only add a render between the two.
  const configured = useRef(false);
  const [hashedNonce, setHashedNonce] = useState<string | null>(null);

  // The theme lives on `document.documentElement`, not in React, and Google's
  // button takes its colours as an argument rather than from CSS — so a theme
  // change has to redraw the button rather than restyle it. `getServerTheme`
  // returns null, which renders as light and is corrected on hydration; the
  // button does not exist before hydration anyway.
  const dark = useSyncExternalStore(subscribeToTheme, isDark, getServerTheme) ?? false;
  const [width, setWidth] = useState<number>(0);

  /* Nonce, once. */
  useEffect(() => {
    let live = true;
    rawNonce.current = randomNonce();
    void sha256Hex(rawNonce.current).then((hash) => {
      if (live) setHashedNonce(hash);
    });
    return () => {
      live = false;
    };
  }, []);

  /* Width, because Google's button takes a pixel number and the card is fluid. */
  useEffect(() => {
    const element = slot.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.width ?? 0;
      // Google clamps to 200-400 itself and refuses anything outside it, so the
      // clamp happens here where a refusal would otherwise be a missing button.
      if (measured > 0) setWidth(Math.round(Math.min(400, Math.max(200, measured))));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  /* The script. */
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      if (live && !window.google) setStatus("fallback");
    }, LOAD_TIMEOUT_MS);

    loadGsi()
      .then(() => {
        if (live) setStatus((current) => (current === "fallback" ? current : "ready"));
      })
      .catch(() => {
        if (live) setStatus("fallback");
      });

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  /* Configure the client, once the script and the nonce are both in hand. */
  useEffect(() => {
    const google = window.google;
    if (status !== "ready" || !google || !hashedNonce) return;

    google.accounts.id.initialize({
      client_id: clientId,
      nonce: hashedNonce,
      context: text === "signup_with" ? "signup" : "signin",
      ux_mode: "popup",
      // Safari's storage partitioning breaks the default flow; this is Google's
      // own switch for it, and it is a no-op everywhere else.
      itp_support: true,
      // No One Tap on these screens. The user is already on a sign-in page and
      // has already chosen a path; a second prompt appearing over it is noise.
      auto_select: false,
      callback: (response) => {
        const credential = response.credential;
        if (!credential) {
          setError("Google did not return a sign-in token. Please try again.");
          return;
        }
        void completeSignIn(credential, rawNonce.current, next, setError);
      },
    });

    configured.current = true;
    return () => {
      configured.current = false;
      google.accounts.id.cancel();
    };
    // Deliberately excludes `dark` and `width`. Those redraw the button below;
    // re-initialising for them makes Google warn that only the last instance
    // counts, which is true and would be a real bug the day the two effects
    // disagree about which callback is live.
  }, [status, clientId, hashedNonce, text, next]);

  /* Draw it, and redraw whenever the theme or the width moves under it. */
  useEffect(() => {
    const element = slot.current;
    const google = window.google;
    if (!configured.current || !element || !google || width === 0) return;

    element.replaceChildren();
    google.accounts.id.renderButton(element, {
      type: "standard",
      // Google offers no "match my design system"; `outline` on light and
      // `filled_black` on dark are the two that sit on this card without
      // fighting it.
      theme: dark ? "filled_black" : "outline",
      size: "large",
      shape: "pill",
      text,
      logo_alignment: "center",
      width,
    });

    // Google refuses an origin it does not recognise by logging to the console
    // and drawing nothing — there is no callback and no thrown error. An empty
    // container a moment later is the only signal available, and without this
    // check a missing "Authorised JavaScript origin" shows up as a sign-in page
    // with no Google button at all rather than as the redirect fallback.
    const drawn = setTimeout(() => {
      if (element.childElementCount === 0) setStatus("fallback");
    }, RENDER_TIMEOUT_MS);

    return () => {
      clearTimeout(drawn);
    };
    // A superset of the configure effect's dependencies, plus the two that only
    // affect how the button looks. Anything that re-initialises must redraw, or
    // the button on screen belongs to a callback that no longer exists.
  }, [status, clientId, hashedNonce, next, width, dark, text]);

  if (status === "fallback") return <>{fallback}</>;

  return (
    <>
      {/* Sized and centred so the pending state occupies exactly what the
          button will, and the card does not jump when Google fills it in. */}
      <div ref={slot} className={styles.gsiSlot} aria-busy={status === "pending"} />
      {error ? (
        <p className={styles.gsiError} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/* ── Plumbing ──────────────────────────────────────────────────────────── */

/**
 * Trades Google's ID token for this app's session, then leaves the page.
 *
 * A full navigation rather than a router push: the session cookie was set by
 * that response, and every server component above this one — the shell, the top
 * bar, the avatar — has to be rendered against it.
 */
async function completeSignIn(
  credential: string,
  nonce: string,
  next: string | undefined,
  setError: (message: string | null) => void,
): Promise<void> {
  setError(null);
  try {
    const response = await fetch("/auth/google", {
      method: "POST",
      // Not a convenience: `application/json` is what forces a preflight on a
      // cross-origin caller, and the route depends on it. See its comment.
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential, nonce, next: next ?? "" }),
    });

    const payload = (await response.json()) as { redirect?: string; error?: string };
    if (!response.ok || !payload.redirect) {
      setError(payload.error ?? "Google sign-in failed. Please try again.");
      return;
    }

    window.location.assign(payload.redirect);
  } catch {
    setError("Could not reach the server. Check your connection and try again.");
  }
}

let gsiPromise: Promise<void> | undefined;

/**
 * Loads Google's script at most once per document, however many components ask.
 * `next/script` would do this too, but it owns the timing, and this needs to
 * know about failure — a blocked script is the case the fallback exists for.
 */
function loadGsi(): Promise<void> {
  if (window.google) return Promise.resolve();

  gsiPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement("script");

    script.addEventListener("load", () => {
      resolve();
    });
    script.addEventListener("error", () => {
      gsiPromise = undefined;
      reject(new Error("Google Identity Services failed to load"));
    });

    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return gsiPromise;
}

/** 32 bytes of randomness as hex. Never leaves the browser except to our route. */
function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** Hex, because that is the encoding Supabase compares the `nonce` claim in. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
