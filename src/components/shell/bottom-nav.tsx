import { PRIMARY_NAV } from "@/lib/navigation";
import { NavLink } from "./nav-link";

/**
 * Mobile navigation.
 *
 * `pb-[env(safe-area-inset-bottom)]` keeps the bar clear of the iOS home
 * indicator; without it the last few pixels of every tap target sit under the
 * system gesture area and the bar feels unreliable rather than merely ugly.
 *
 * Targets are 44px tall, which is the documented minimum for a comfortable
 * touch target and not a number worth shaving to fit a fifth item.
 */
export function BottomNav() {
  return (
    <nav
      className={
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 " +
        "pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
      }
      aria-label="Primary"
    >
      <ul className="flex">
        {PRIMARY_NAV.map(({ label, href, icon: Icon }) => (
          <li key={href} className="flex-1">
            <NavLink
              href={href}
              className={
                "flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium " +
                "transition-colors duration-(--duration-fast)"
              }
              activeClassName="text-accent"
              inactiveClassName="text-ink-3"
            >
              <Icon className="size-[1.3rem]" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
