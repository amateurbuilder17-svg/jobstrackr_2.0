"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

import { MenuIcon } from "@/components/icons";
import { openMenu } from "./menu-store";

/**
 * The menu button, top left, below `lg`.
 *
 * It is a link to `/menu` that happens to open a drawer, not a button that
 * happens to have a fallback. The distinction is what makes it work before
 * hydration: the shell is prerendered and served from a CDN, so on a slow
 * connection there is a real window in which the page is painted and no
 * JavaScript has run yet. A `<button>` in that window does nothing when
 * pressed — the worst kind of broken, because it looks fine.
 *
 * So the element is an anchor with a real `href`. Once hydrated, the click
 * handler intercepts and opens the drawer instead; middle-click, ⌘-click and
 * "open in new tab" keep working because those never reach `onClick` with
 * `button === 0` and no modifier.
 *
 * `aria-expanded` is deliberately absent. This control is a link to another
 * page until JavaScript changes its mind, and announcing "collapsed" for
 * something that navigates would be a lie in exactly the case — no JS — where
 * assistive technology is most likely to be what someone is relying on. The
 * drawer announces itself as a dialog when it opens instead.
 */
export function MenuButton() {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle anything that is not a plain left click: those
    // are deliberate requests for a new tab or window, and `/menu` is a real
    // page that answers them.
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    openMenu();
  }

  return (
    <Link
      href="/menu"
      onClick={handleClick}
      aria-label="Open menu"
      className={
        "-ml-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-2 " +
        "transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink lg:hidden"
      }
    >
      <MenuIcon className="size-[1.35rem]" />
    </Link>
  );
}
