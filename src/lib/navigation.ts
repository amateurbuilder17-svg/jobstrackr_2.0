import type { ComponentType, SVGProps } from "react";

import {
  BookmarkIcon,
  CalendarIcon,
  GraduationCapIcon,
  HomeIcon,
  MegaphoneIcon,
  SearchIcon,
  SparklesIcon,
  UserIcon,
} from "@/components/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Shown in the mobile bottom bar. Five is the practical ceiling for thumbs. */
  primary?: boolean;
}

/**
 * One navigation source of truth, consumed by the sidebar, the bottom bar and
 * the command palette. Defining it three times is how a route ends up reachable
 * on desktop and invisible on mobile.
 *
 * Labels are what a person would call the thing, not what the table is named:
 * "Updates", not "exam_updates"; "My Exams", not "Tracker".
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/", icon: HomeIcon, primary: true },
  { label: "Jobs", href: "/jobs", icon: SearchIcon, primary: true },
  { label: "Updates", href: "/updates", icon: MegaphoneIcon, primary: true },
  { label: "My Exams", href: "/tracker", icon: GraduationCapIcon, primary: true },
  { label: "Calendar", href: "/calendar", icon: CalendarIcon, primary: true },
  { label: "For You", href: "/for-you", icon: SparklesIcon },
  { label: "Saved", href: "/saved", icon: BookmarkIcon },
  { label: "Profile", href: "/profile", icon: UserIcon },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => item.primary);

/**
 * Whether a nav item should read as current.
 *
 * Prefix matching, except for "/" — otherwise Home is active on every page,
 * which is the single most common bug in hand-rolled navigation.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
