import Link from "next/link";

import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { MENU_SECTIONS, type MenuItem } from "@/lib/menu";
import { MenuAccount } from "./menu-account";
import { MenuScope } from "./menu-scope";
import { MenuSessionActions } from "./menu-session";
import { ShareAppButton } from "./share-app-button";
import { ThemeToggle } from "./theme-toggle";

/**
 * The menu, rendered once and shown in two places: the drawer in the shell and
 * the `/menu` page behind it.
 *
 * A Server Component. Every row here — the icon, the label, the link — is HTML
 * by the time it reaches the browser. The only JavaScript in the menu is the
 * five controls that genuinely need it: the account card, the admin gate, the
 * share sheet, the theme toggle and the two session forms.
 *
 * `dense` is the drawer. Hints are dropped there because twenty two-line rows
 * do not fit a phone screen, and a drawer you have to scroll to reach "Sign
 * out" is a drawer people stop using. The page has the room and keeps them.
 *
 * Items behind sign-in are linked directly rather than pointed at
 * `/sign-in?next=…`. A guest who taps "My Exams" lands on that page and gets
 * its `<SignInRequired>` card — the name of the thing, why it needs an account
 * and a button — which is a better answer than a bare password field, and is
 * decided in one place rather than duplicated here.
 */
export function MenuList({ dense = false }: { dense?: boolean }) {
  return (
    <MenuScope>
      <div className={cn("flex flex-col gap-6", dense ? "p-3" : "p-0")}>
        <MenuAccount />

        {MENU_SECTIONS.map((section) => (
          <section key={section.title} className="flex flex-col gap-1">
            <h2
              className={cn(
                "px-3 text-2xs font-semibold tracking-[0.12em] text-ink-3 uppercase",
                dense ? "pb-0.5" : "pb-1",
              )}
            >
              {section.title}
            </h2>

            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <li
                  key={item.label}
                  // The admin row, and only the admin row, hides itself from
                  // everyone else. See MenuScope for why this is a CSS variant
                  // rather than a conditional render.
                  className={cn(item.requiresAdmin && "group-data-[admin=no]/session:hidden")}
                >
                  <Row item={item} dense={dense} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="flex flex-col gap-1">
          <h2 className="px-3 pb-1 text-2xs font-semibold tracking-[0.12em] text-ink-3 uppercase">
            Appearance
          </h2>
          <div className="flex items-center justify-between rounded-md px-3 py-1.5">
            <span className="text-sm font-medium text-ink">Theme</span>
            <ThemeToggle />
          </div>
        </section>

        <MenuSessionActions />
      </div>
    </MenuScope>
  );
}

/* ── One row ─────────────────────────────────────────────────────────────── */

const ROW =
  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 " +
  "transition-colors duration-(--duration-fast)";

function Row({ item, dense }: { item: MenuItem; dense: boolean }) {
  const { icon: Icon, label, hint, href, state } = item;

  if (item.action === "share") {
    return <ShareAppButton className={cn(ROW, "hover:bg-surface-2")} />;
  }

  const body = (
    <>
      <Icon className="size-[1.15rem] shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{label}</span>
        {!dense && hint ? (
          <span className="block truncate text-xs text-ink-3">{hint}</span>
        ) : null}
      </span>
    </>
  );

  // Not yet built. Rendered as text with a badge rather than a link to a 404 —
  // the menu is complete from the day it ships, and every row in it is honest
  // about whether it goes anywhere.
  if (state === "soon" || !href) {
    return (
      <div className={cn(ROW, "cursor-default opacity-60")} aria-disabled="true">
        {body}
        <span
          className={
            "shrink-0 rounded-sm bg-surface-3 px-1.5 py-0.5 text-2xs font-semibold " +
            "tracking-wide text-ink-3 uppercase"
          }
        >
          Soon
        </span>
      </div>
    );
  }

  return (
    <Link href={href} className={cn(ROW, "hover:bg-surface-2")}>
      {body}
      <ChevronRightIcon className="size-4 shrink-0 text-ink-3" />
    </Link>
  );
}
