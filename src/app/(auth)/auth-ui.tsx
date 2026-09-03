import { clsx } from "clsx";
import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

import styles from "./auth.module.css";

/**
 * The credential screens' own field primitives.
 *
 * `@/components/ui/field` is the app's set and stays the app's set; these
 * screens paint a different surface — frosted glass over artwork rather than
 * a card on paper — and every control needs a leading icon, which that API has
 * no slot for. Overriding all of it through `className` would have left the
 * shared component's defaults fighting these on specificity, which fails
 * silently and looks like a CSS bug rather than a design decision.
 *
 * What is copied rather than re-derived is the accessibility contract, because
 * that part is not decorative: a label bound to its control by `id`, the error
 * text referenced through `aria-describedby`, `aria-invalid` set whenever
 * there is a message, and `role="alert"` on anything that appears in response
 * to a submission. `aria()` below is the single place that wiring happens, so
 * a field cannot be added without it.
 *
 * Every export here is a Server Component. The two on these screens that are
 * not — the password reveal and the submit button — are in their own files.
 */

/* ── Card copy ─────────────────────────────────────────────────────────── */

/**
 * The mockup's split heading: "Welcome" in ink, "back" in the accent. Taking
 * the accented word as a separate prop rather than parsing the title keeps it
 * one `<h1>` for assistive tech while still being two colours on screen.
 */
export function AuthHeader({
  title,
  accent,
  subtitle,
}: {
  title: string;
  accent: string;
  subtitle: string;
}) {
  return (
    <header>
      <h1 className={styles.title}>
        {title}
        <span className={styles.titleAccent}>{accent}</span>
      </h1>
      <p className={styles.subtitle}>{subtitle}</p>
    </header>
  );
}

/**
 * Sign in / Sign up, as links.
 *
 * `aria-current="page"` rather than a pressed state: these navigate, and a
 * screen reader should hear "you are here", not "this button is on". The
 * `next` parameter is carried across so a visitor bounced out of `/tracker`
 * into sign-in still lands back on `/tracker` if they decide to register.
 */
export function AuthTabs({
  active,
  next,
}: {
  active: "signin" | "signup";
  next?: string | undefined;
}) {
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <nav className={styles.tabs} aria-label="Sign in or create an account">
      <Link
        href={`/sign-in${query}`}
        className={clsx(styles.tab, active === "signin" && styles.tabActive)}
        aria-current={active === "signin" ? "page" : undefined}
      >
        Sign in
      </Link>
      <Link
        href={`/sign-up${query}`}
        className={clsx(styles.tab, active === "signup" && styles.tabActive)}
        aria-current={active === "signup" ? "page" : undefined}
      >
        Sign up
      </Link>
    </nav>
  );
}

export function BackToSignIn() {
  return (
    <Link href="/sign-in" className={styles.backLink}>
      <ArrowLeftIcon />
      Back to sign in
    </Link>
  );
}

export function AuthBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}

export function AuthFooter({ children }: { children: ReactNode }) {
  return <p className={styles.footer}>{children}</p>;
}

export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.link}>
      {children}
    </Link>
  );
}

/* ── Feedback ──────────────────────────────────────────────────────────── */

/** A failure belonging to the form rather than to one field. */
export function AuthFormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className={styles.formError}>
      {children}
    </p>
  );
}

/** "Check your email" — the flows whose success is a message, not a redirect. */
export function AuthFormNotice({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className={styles.formNotice}>
      {children}
    </p>
  );
}

/* ── Fields ────────────────────────────────────────────────────────────── */

export function AuthField({
  id,
  label,
  error,
  hint,
  action,
  children,
}: {
  id: string;
  label: string;
  // Spelled `| undefined` rather than left optional because the project
  // compiles with `exactOptionalPropertyTypes`, under which passing an
  // explicit `undefined` — which `state.errors?.email` evaluates to — is a
  // type error against a plain `error?: string`.
  error?: string | undefined;
  hint?: string | undefined;
  /** Rendered opposite the label. Used for "Forgot password?". */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {action}
      </div>

      <div className={styles.control}>{children}</div>

      {/* One line of small print, never two: an error replaces the hint rather
          than stacking under it, because the moment there is something wrong
          is the moment a second sentence stops being read. */}
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Derives the `aria-*` pair from the presence of an error, so callers cannot
    forget it. Exported for the password input, which is a Client Component and
    has to build the same attributes. */
export function ariaFor(id: string, error?: string, hint?: string) {
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export interface AuthInputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  icon: ReactNode;
  error?: string | undefined;
  hint?: string | undefined;
}

/**
 * The icon is rendered *after* the input, not before it. That is what lets
 * `.input:focus ~ .icon` in the stylesheet tint it on focus — CSS has no
 * previous-sibling combinator — and it is positioned back to the left edge
 * absolutely, so the visual order is unchanged. The icon is decorative and
 * carries `aria-hidden`, so its position in the reading order is moot.
 */
export function AuthInput({ id, icon, error, hint, className, ...props }: AuthInputProps) {
  return (
    <>
      <input
        id={id}
        name={props.name ?? id}
        className={clsx(styles.input, className)}
        {...ariaFor(id, error, hint)}
        {...props}
      />
      <span className={styles.icon} aria-hidden>
        {icon}
      </span>
    </>
  );
}

/* ── Divider ───────────────────────────────────────────────────────────── */

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className={styles.divider}>
      <span className={styles.dividerRule} />
      <span className={styles.dividerLabel}>{label}</span>
      <span className={styles.dividerRule} />
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────────
   Drawn here rather than pulled from `@/components/icons` because these are
   1.8px-stroke line icons sized to the input, and that set is the app's
   navigation weight. Inline SVG, so there is no request and they inherit
   `currentColor` in both themes. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" {...STROKE}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <polyline points="3 7 12 13 21 7" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" {...STROKE}>
      <rect x="4" y="11" width="16" height="11" rx="3" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" {...STROKE}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" {...STROKE} strokeWidth={2.2}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/* ── Suspense fallback ─────────────────────────────────────────────────── */

/**
 * Holds the card's height while the boundary resolves.
 *
 * The measurement matters more than the appearance: the card is centred in the
 * viewport, so a fallback shorter than its content moves the whole card when it
 * swaps in. `lines` is the number of input rows the real form has — two for
 * sign-in, three for sign-up — which is the only dimension that differs.
 *
 * It does not shimmer. The app's `skeleton` utility animates a travelling
 * highlight, which is right for a list of records arriving over the network;
 * this boundary resolves in the same tick as the response, and an animation
 * that plays for one frame reads as a flicker.
 */
export function AuthCardSkeleton({ lines }: { lines: number }) {
  return (
    <div className={styles.fallback} aria-hidden>
      <span className={styles.fallbackTabs} />
      <span className={styles.fallbackTitle} />
      <span className={styles.fallbackSub} />
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className={styles.fallbackField} />
      ))}
      <span className={styles.fallbackButton} />
    </div>
  );
}
