"use client";

import { useEffect } from "react";

import { setTheme, storedTheme, systemPrefersDark } from "@/components/shell/theme-store";

/**
 * Holds the credential screens dark for anyone who has not chosen a theme.
 *
 * `ThemeScript` already does this on a hard load, before first paint. It
 * cannot do it on a client-side navigation — it runs once per document, so
 * arriving here from a link inside the app would keep whatever the previous
 * route resolved to. This closes that gap.
 *
 * Two rules keep it from leaking:
 *
 *  - an explicit choice always wins, so this does nothing when the user has
 *    stored one, and the toggle on the screen still works normally;
 *  - it does not persist, and it puts the theme back on the way out, so the
 *    rest of the app keeps following the system preference.
 *
 * Renders nothing. It is a side effect with a component's shape, which is the
 * only way a Server Component layout can run one.
 */
export function AuthDarkDefault() {
  useEffect(() => {
    if (storedTheme() !== null) return;

    setTheme(true, { persist: false });

    return () => {
      // Re-checked rather than captured: the user may have used the toggle
      // while they were here, and that choice outranks this default.
      if (storedTheme() === null) setTheme(systemPrefersDark(), { persist: false });
    };
  }, []);

  return null;
}
