import { NAV_ITEMS } from "@/lib/navigation";
import { NavLink } from "./nav-link";

/**
 * Desktop navigation. A Server Component: only the individual links are
 * interactive, so only they cross into the client bundle.
 */
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line bg-surface lg:block">
      <div className="flex h-full flex-col gap-1 p-3">
        <div className="px-3 py-4">
          <span className="text-lg font-semibold tracking-tight text-ink">JobsTrackr</span>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
            <NavLink
              key={href}
              href={href}
              className={
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium " +
                "transition-colors duration-(--duration-fast)"
              }
              activeClassName="bg-accent-soft text-accent"
              inactiveClassName="text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <Icon className="size-[1.15rem] shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  );
}
