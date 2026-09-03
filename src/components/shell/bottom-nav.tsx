"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { isActive } from "@/lib/navigation";
import styles from "./bottom-nav.module.css";
import {
  CalendarNavIcon,
  HomeNavIcon,
  JobsNavIcon,
  TrackerNavIcon,
  UpdatesNavIcon,
  type NavIconProps,
} from "./nav-icons";

interface NavEntry {
  label: string;
  href: string;
  icon: ComponentType<NavIconProps>;
}

const PRIMARY_ENTRIES: NavEntry[] = [
  { label: "Home", href: "/", icon: HomeNavIcon },
  { label: "Jobs", href: "/jobs", icon: JobsNavIcon },
  { label: "Updates", href: "/updates", icon: UpdatesNavIcon },
  { label: "My Exams", href: "/tracker", icon: TrackerNavIcon },
  { label: "Calendar", href: "/calendar", icon: CalendarNavIcon },
];

/**
 * Ultra-Premium mobile bottom navigation.
 *
 * Implements a floating pill tab bar with a sliding cutout notch, raised
 * bubble indicator with specular highlight & glow, and crisp labels for
 * non-selected tabs.
 */
export function BottomNav() {
  const pathname = usePathname();
  const navCount = PRIMARY_ENTRIES.length;

  const activeIndex = PRIMARY_ENTRIES.findIndex((item) => isActive(pathname, item.href));
  const hasActiveItem = activeIndex !== -1;

  // Track slot width percentage (e.g. 20% for 5 items)
  const slotWidthPercent = 100 / (navCount || 1);

  return (
    <nav data-shell="bottom-nav" className={styles.navWrapper} aria-label="Primary">
      <div className={styles.navContainer}>
        <div className={styles.navBar}>
          {/* Animated sliding cutout and bubble layer */}
          <div
            className={styles.bgTrack}
            style={{
              width: `${String(slotWidthPercent)}%`,
              transform: hasActiveItem
                ? `translateX(${String(activeIndex * 100)}%)`
                : "translateX(0%)",
              opacity: hasActiveItem ? 1 : 0,
            }}
            aria-hidden="true"
          >
            <div className={styles.cutout} />
            <div className={styles.dot} />
          </div>

          {/* Navigation links list */}
          <ul className={styles.navList}>
            {PRIMARY_ENTRIES.map(({ label, href, icon: Icon }) => {
              const active = isActive(pathname, href);

              return (
                <li key={href} className={styles.navListItem}>
                  <Link
                    href={href}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    data-active={active ? "true" : undefined}
                    className={styles.navLink}
                  >
                    <span className={styles.iconSlot}>
                      <Icon active={active} />
                    </span>
                    <span className={styles.label}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
