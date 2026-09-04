/**
 * The theme as external mutable state.
 *
 * The theme lives on `document.documentElement`, put there by `ThemeScript`
 * before first paint — so it is not React state, and anything that reads or
 * writes it has to go through the same place or the readers go stale. That is
 * why this is a module and not a hook: `ThemeToggle` subscribes to it, and
 * `AuthDarkDefault` writes to it from an effect, and the toggle's icon has to
 * follow that write.
 *
 * Every function here touches the DOM or `localStorage` and so is
 * client-only; `getServerTheme` is the one exception and exists precisely to
 * give `useSyncExternalStore` something safe to render on the server.
 */

const listeners = new Set<() => void>();

export function subscribeToTheme(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Whether the document is currently dark. The single source of truth. */
export function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * The server cannot know the theme — it is resolved from localStorage in the
 * browser. `null` lets a consumer render a same-sized placeholder, so the
 * icon appears without the layout moving.
 */
export function getServerTheme(): null {
  return null;
}

/** The user's explicit choice, or `null` if they have never made one. */
export function storedTheme(): "dark" | "light" | null {
  try {
    const value = localStorage.getItem("theme");
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // Private mode, or storage disabled.
    return null;
  }
}

export function systemPrefersDark(): boolean {
  return matchMedia("(prefers-color-scheme:dark)").matches;
}

/**
 * Apply a theme to the document and tell every subscriber.
 *
 * `persist` is the difference between a choice and a default: the toggle
 * records what the user picked, while a route-level default only dresses the
 * page and must leave `localStorage` untouched, or the next route would
 * inherit a preference nobody expressed.
 */
export function setTheme(dark: boolean, { persist }: { persist: boolean }) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";

  if (persist) {
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // The theme still applies to this page view; it simply will not be
      // remembered.
    }
  }

  for (const listener of listeners) listener();
}
