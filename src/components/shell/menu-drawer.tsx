"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { CloseIcon } from "@/components/icons";
import { closeMenu, useMenuOpen } from "./menu-store";

/**
 * The sliding panel the menu button opens.
 *
 * Its children are server-rendered and passed straight through — the fifty-odd
 * links inside it never reach the browser as JavaScript. What ships from this
 * file is the open/close behaviour and the accessibility that a panel over the
 * page owes anyone using it: a focus trap, Escape, a restore, and a scroll lock.
 *
 * The panel stays mounted rather than being rendered on open. Mounting on open
 * would cost nothing in payload — the children are already in the flight data
 * either way — but it removes any possibility of animating in from a stable
 * position, and it means the first press of the button does layout work that
 * every later press does not.
 *
 * `inert` while closed is what makes that safe. Without it the panel is
 * offscreen but still in the tab order, so a keyboard user tabbing through a
 * job list falls into an invisible menu and cannot see where their focus went.
 */
export function MenuDrawer({ children }: { children: ReactNode }) {
  const open = useMenuOpen();
  const panelRef = useRef<HTMLDivElement>(null);
  /** Whatever had focus when the drawer opened, so it can be given back. */
  const restoreRef = useRef<HTMLElement | null>(null);

  // Closing on navigation is handled by `RouteWatcher`, not here. A
  // `usePathname()` in this component reads URL data from inside the root
  // layout, which under Cache Components stops every route carrying the shell
  // from prerendering.

  /* ── Focus in, focus back ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) {
      // Give focus back to whatever opened the drawer. Without this, closing
      // with Escape drops focus to the document body and the next Tab starts
      // again from the top of the page.
      const restore = restoreRef.current;
      restoreRef.current = null;
      // `isConnected` because the opener may have been unmounted by a
      // navigation that happened while the drawer was open.
      if (restore?.isConnected) restore.focus();
      return;
    }

    restoreRef.current = document.activeElement as HTMLElement | null;

    // The panel itself, not its first link. Focusing the first item skips the
    // dialog's own name, so a screen reader announces "My Exams" with no
    // indication that a menu just opened.
    panelRef.current?.focus();
  }, [open]);

  /* ── Lock the page behind it ──────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;

    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";

    return () => {
      body.style.overflow = previous;
    };
  }, [open]);

  /* ── Escape, and the tab loop ─────────────────────────────────────────── */
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeMenu();
      return;
    }

    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;

    // Queried on each Tab rather than cached on open. The account row swaps
    // between a sign-in card and a profile card when the session resolves,
    // which can happen while the drawer is already open.
    const focusable = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    const active = document.activeElement;

    // The panel holds focus itself on open, so a first Tab from the panel
    // should land on the first item rather than escaping to the page — the
    // same destination as wrapping round from the last item.
    if (!event.shiftKey && (active === last || active === panel)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    }
  }, []);

  return (
    // `lg:hidden` on the whole thing: above `lg` the sidebar is the navigation
    // and this panel has no reason to exist, let alone to be tabbable.
    <div data-shell="menu-drawer" className="lg:hidden" aria-hidden={!open || undefined}>
      {/* Backdrop. A plain div with a click handler rather than a button — it
          is not an action anyone should be able to tab to, and Escape already
          gives the keyboard the same exit. */}
      <div
        onClick={closeMenu}
        className={
          "fixed inset-0 z-40 bg-ink/40 transition-opacity duration-(--duration-base) " +
          "motion-reduce:transition-none " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open || undefined}
        aria-label="Menu"
        tabIndex={-1}
        inert={!open}
        onKeyDown={onKeyDown}
        className={
          "fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col bg-surface " +
          "border-r border-line shadow-xl outline-none " +
          "transition-transform duration-(--duration-base) motion-reduce:transition-none " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-base font-bold tracking-tight text-ink">JobsTrackr</span>
          <button
            type="button"
            onClick={closeMenu}
            aria-label="Close menu"
            className={
              "-mr-2 inline-flex size-10 items-center justify-center rounded-md text-ink-2 " +
              "transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink"
            }
          >
            <CloseIcon className="size-[1.25rem]" />
          </button>
        </div>

        {/* `overscroll-contain` so flicking past the end of the menu does not
            scroll the page underneath it, which on iOS reads as the drawer
            having lost its grip. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
