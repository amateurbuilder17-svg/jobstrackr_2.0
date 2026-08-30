"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the menu drawer is open.
 *
 * A module-level store rather than context, for the same reason `ThemeToggle`
 * reads the DOM through `useSyncExternalStore`: the button that opens the
 * drawer lives in the top bar and the drawer itself lives at the bottom of the
 * frame, so the state has to be shared by two components that are siblings
 * rather than ancestor and descendant.
 *
 * Context would work, but it would put a provider around the whole shell whose
 * value changes on every open — re-rendering the top bar, the sidebar and the
 * bottom nav to move one panel. This re-renders the two subscribers and
 * nothing else, in about forty lines with no provider.
 */

let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  return open;
}

/**
 * Always closed on the server.
 *
 * The drawer is part of the static shell, so its markup is prerendered into
 * every page. Returning `false` here is what guarantees the prerender matches
 * the first client render — a snapshot that read anything request-specific
 * would be a hydration mismatch on 2,700 cached pages.
 */
function getServerSnapshot(): boolean {
  return false;
}

export function useMenuOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function openMenu(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeMenu(): void {
  if (!open) return;
  open = false;
  emit();
}
