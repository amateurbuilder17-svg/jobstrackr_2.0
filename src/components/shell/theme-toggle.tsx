"use client";

import { useCallback, useSyncExternalStore } from "react";

import { MoonIcon, SunIcon } from "@/components/icons";
import {
  getServerTheme,
  isDark as isDarkNow,
  setTheme,
  subscribeToTheme,
} from "@/components/shell/theme-store";

/**
 * Light/dark toggle.
 *
 * The theme lives on `document.documentElement`, set by ThemeScript before
 * first paint — so it is external mutable state, not React state.
 * `useSyncExternalStore` is the API for exactly that: it reads the DOM during
 * render on the client and returns the server snapshot during SSR, with no
 * effect and no cascading re-render.
 *
 * The obvious alternative — `useState` seeded in a mount effect — trips
 * React's cascading-render lint for good reason: it renders once with a guess,
 * then again with the truth, and on this particular control the intermediate
 * frame is a visibly wrong icon.
 *
 * The store it reads from is shared (`theme-store.ts`) rather than private to
 * this file, because the credential screens also write the theme — see
 * `AuthDarkDefault`. A write that did not notify these subscribers would leave
 * this button showing the wrong icon on the sign-in page.
 */
export function ThemeToggle() {
  const isDark = useSyncExternalStore<boolean | null>(
    subscribeToTheme,
    isDarkNow,
    getServerTheme,
  );

  const toggle = useCallback(() => {
    setTheme(!isDarkNow(), { persist: true });
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        isDark === null ? "Toggle theme" : isDark ? "Switch to light" : "Switch to dark"
      }
      className={
        "inline-flex size-10 items-center justify-center rounded-md text-ink-2 " +
        "transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink"
      }
    >
      {isDark === null ? (
        <span className="size-[1.15rem]" />
      ) : isDark ? (
        <SunIcon className="size-[1.15rem]" />
      ) : (
        <MoonIcon className="size-[1.15rem]" />
      )}
    </button>
  );
}
