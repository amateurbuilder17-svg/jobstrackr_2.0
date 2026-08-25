"use client";

import { useCallback, useSyncExternalStore } from "react";

import { MoonIcon, SunIcon } from "@/components/icons";

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
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * The server cannot know the theme — it is resolved from localStorage in the
 * browser. Returning `null` lets the button render a same-sized placeholder,
 * so the icon appears without the layout moving.
 */
function getServerSnapshot(): null {
  return null;
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore<boolean | null>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private mode, or storage disabled. The toggle still works for this page
      // view; it simply will not be remembered.
    }
    for (const listener of listeners) listener();
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
