"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { isActive } from "@/lib/navigation";

interface NavLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
}

/**
 * A link that knows whether it is current.
 *
 * This is a Client Component only because `usePathname` requires one. It is
 * kept deliberately tiny and takes its children as a slot, so the icons and
 * labels around it stay server-rendered and never reach the client bundle.
 *
 * `aria-current="page"` is the part that matters for anyone not looking at the
 * colour — a screen reader announces "current page", and the styling is then
 * driven off the same attribute rather than a second, separate source of truth.
 */
export function NavLink({
  href,
  children,
  className,
  activeClassName,
  inactiveClassName,
}: NavLinkProps) {
  const pathname = usePathname();
  const current = isActive(pathname, href);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(className, current ? activeClassName : inactiveClassName)}
    >
      {children}
    </Link>
  );
}
