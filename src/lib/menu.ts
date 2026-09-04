import type { ComponentType, SVGProps } from "react";

import {
  BookOpenIcon,
  BookTextIcon,
  BookmarkIcon,
  CompassIcon,
  CopyIcon,
  CreditCardIcon,
  GraduationCapIcon,
  HeadphonesIcon,
  HelpCircleIcon,
  LockIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  ScaleIcon,
  ScanTextIcon,
  SendIcon,
  Share2Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  TimerIcon,
  UserIcon,
} from "@/components/icons";

/**
 * The menu, as data.
 *
 * Two surfaces render this — the drawer in the shell and the `/menu` page
 * behind it — and they must not drift. The old app had the same list written
 * once in `More.tsx` and again in `DesktopSidebar.tsx`, which is how a feature
 * ended up reachable on one and invisible on the other.
 *
 * Icons are components rather than strings so the renderer stays a Server
 * Component: each one inlines to SVG in the HTML and costs the browser nothing.
 */

export type MenuItemState =
  /** Built and reachable. */
  | "ready"
  /** Planned, module not landed. Rendered inert with a label, never as a link. */
  | "soon";

export interface MenuItem {
  label: string;
  /** What this is for, one line. Shown on the page; omitted in the drawer. */
  hint?: string;
  href?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  state?: MenuItemState;
  /** Hidden from guests, who are sent to sign-in instead of a dead end. */
  requiresAuth?: boolean;
  /** Hidden from everyone but admins. Filled in on the client — see MenuList. */
  requiresAdmin?: boolean;
  /**
   * A client-side action rather than a navigation. The renderer maps this to
   * the one component that implements it, so this module stays data and does
   * not pull a click handler into the server tree.
   */
  action?: "share";
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

/**
 * The module each "soon" item is waiting on, so the label can say something
 * truer than "coming soon" and a reader can find the plan entry.
 */
export const MENU_SECTIONS: MenuSection[] = [
  {
    title: "Quick navigation",
    items: [
      {
        label: "My Exams",
        hint: "Track an exam and follow its status",
        href: "/tracker",
        icon: GraduationCapIcon,
        requiresAuth: true,
      },
      {
        label: "Updates",
        hint: "Admit cards, results, answer keys",
        href: "/updates",
        icon: MegaphoneIcon,
      },
      { label: "Saved jobs", hint: "Your shortlist", href: "/saved", icon: BookmarkIcon },
      {
        label: "For You",
        hint: "Jobs matching your qualification and age",
        href: "/for-you",
        icon: SparklesIcon,
        requiresAuth: true,
      },
    ],
  },
  {
    title: "Smart tools",
    items: [
      // Both were named after the machinery rather than the job. "Application
      // guidance" guided nobody, and "Your documents" described a filing
      // cabinet — what people come here to do is stop typing the same twelve
      // fields into every form.
      {
        label: "Copy my details",
        hint: "Your saved details, one tap each, for any form",
        href: "/my-details",
        icon: CopyIcon,
        requiresAuth: true,
      },
      {
        label: "Scan a document",
        hint: "Read a marksheet or ID and fill your profile",
        href: "/documents",
        icon: ScanTextIcon,
        requiresAuth: true,
      },
      {
        label: "Syllabus finder",
        hint: "Search and read an exam syllabus",
        href: "/syllabus",
        icon: BookOpenIcon,
      },
      {
        label: "Telegram alerts",
        hint: "Job and exam updates on Telegram",
        href: "/settings/notifications",
        icon: SendIcon,
        state: "soon",
        requiresAuth: true,
      },
      {
        label: "Exam countdown",
        hint: "Live countdowns you can share",
        href: "/countdown",
        icon: TimerIcon,
      },
      {
        label: "Which job suits you?",
        hint: "A two-minute quiz",
        href: "/quiz",
        icon: CompassIcon,
      },
    ],
  },
  {
    title: "Resources and support",
    items: [
      {
        label: "Sector preferences",
        hint: "Tune what For You shows you",
        href: "/profile",
        icon: SlidersHorizontalIcon,
        requiresAuth: true,
      },
      {
        label: "User manual",
        hint: "How each part of the app works",
        href: "/user-manual",
        icon: BookTextIcon,
      },
      {
        label: "FAQ",
        hint: "The questions people ask most",
        href: "/faq",
        icon: HelpCircleIcon,
      },
      {
        label: "Feedback and grievances",
        hint: "Tell us what is wrong or missing",
        href: "/feedback",
        icon: MessageSquareTextIcon,
      },
      { label: "Help and support", hint: "Get in touch", href: "/help", icon: HeadphonesIcon },
      {
        label: "Share this app",
        hint: "Send JobsTrackr to a friend",
        icon: Share2Icon,
        action: "share",
      },
      {
        label: "Admin",
        hint: "Ingestion, egress and content",
        href: "/admin",
        icon: ShieldCheckIcon,
        requiresAdmin: true,
      },
    ],
  },
  {
    title: "Legal",
    items: [
      { label: "Privacy policy", href: "/privacy-policy", icon: LockIcon },
      { label: "Terms of service", href: "/terms-of-service", icon: ScaleIcon },
      { label: "Refund policy", href: "/refund-policy", icon: CreditCardIcon },
    ],
  },
];

/** The account row at the top, which is a card rather than a list item. */
export const ACCOUNT_ITEM = {
  signedIn: { href: "/profile", icon: UserIcon },
  guest: { href: "/sign-in", icon: UserIcon },
} as const;
