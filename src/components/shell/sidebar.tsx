import Link from "next/link";

import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { MENU_SECTIONS, type MenuItem } from "@/lib/menu";
import { NAV_ITEMS } from "@/lib/navigation";
import { MenuAccount } from "./menu-account";
import { MenuScope } from "./menu-scope";
import { MenuSessionActions } from "./menu-session";
import { NavLink } from "./nav-link";
import { ShareAppButton } from "./share-app-button";
import { ThemeToggle } from "./theme-toggle";

/**
 * Desktop navigation.
 *
 * The sidebar now carries the same content the mobile menu has — the primary
 * nav items followed by every section from `MENU_SECTIONS` — so nothing is
 * reachable on a phone and invisible on a monitor.
 *
 * Styled with restrained spacing, subtle dividers and no colour beyond the
 * accent on the active item. Scroll is contained within the sidebar itself,
 * and the brand + primary nav are sticky at the top.
 */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-line bg-surface lg:flex lg:flex-col">
      {/* ── Brand ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-6 pb-4">
        <Link href="/" className="group inline-flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight text-ink transition-colors group-hover:text-accent">
            JobsTrackr
          </span>
        </Link>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {/* Primary nav */}
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
            <NavLink
              key={href}
              href={href}
              className={
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem] font-semibold " +
                "transition-all duration-(--duration-fast)"
              }
              activeClassName="bg-accent-soft text-accent"
              inactiveClassName="text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <Icon className="size-[1.125rem] shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* ── Menu sections ──────────────────────────────────────────────── */}
        {/* The first section ("Quick navigation") duplicates items already in
            the primary nav above, so it is skipped on desktop. */}
        <MenuScope>
          {MENU_SECTIONS.filter((s) => s.title !== "Quick navigation").map((section) => (
            <section key={section.title} className="mt-6">
              <h2 className="mb-1.5 px-3 text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-px">
                {section.items.map((item) => (
                  <li
                    key={item.label}
                    className={cn(
                      item.requiresAdmin && "group-data-[admin=no]/session:hidden",
                    )}
                  >
                    <SidebarRow item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {/* ── Appearance ──────────────────────────────────────────────── */}
          <section className="mt-6">
            <h2 className="mb-1.5 px-3 text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-3 uppercase">
              Appearance
            </h2>
            <div className="flex items-center justify-between rounded-lg px-3 py-1.5">
              <span className="text-[0.8125rem] font-medium text-ink">Theme</span>
              <ThemeToggle />
            </div>
          </section>

          {/* ── Session actions ─────────────────────────────────────────── */}
          <div className="mt-4">
            <MenuSessionActions />
          </div>
        </MenuScope>
      </div>

      {/* ── Account card, pinned to the bottom ─────────────────────────────── */}
      <div className="shrink-0 border-t border-line p-3">
        <MenuAccount />
      </div>
    </aside>
  );
}

/* ── One menu row ────────────────────────────────────────────────────────── */

const ROW =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2 " +
  "text-[0.8125rem] font-medium text-ink-2 " +
  "transition-all duration-(--duration-fast)";

function SidebarRow({ item }: { item: MenuItem }) {
  const { icon: Icon, label, href, state } = item;

  if (item.action === "share") {
    return (
      <ShareAppButton
        className={cn(ROW, "hover:bg-surface-2 hover:text-ink")}
      />
    );
  }

  // "Soon" items — rendered inert with a subtle badge.
  if (state === "soon" || !href) {
    return (
      <div className={cn(ROW, "cursor-default opacity-50")} aria-disabled="true">
        <Icon className="size-[1.05rem] shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span
          className={
            "shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 text-[0.625rem] font-semibold " +
            "tracking-wide text-ink-3 uppercase"
          }
        >
          Soon
        </span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(ROW, "group/row hover:bg-surface-2 hover:text-ink")}
    >
      <Icon className="size-[1.05rem] shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-ink-3/0 transition-colors group-hover/row:text-ink-3" />
    </Link>
  );
}
