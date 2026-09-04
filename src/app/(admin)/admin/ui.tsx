import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The admin console's shared furniture.
 *
 * Server Components without exception. An admin page is a table and some
 * buttons, and the only JavaScript in this route group is the two client
 * components that genuinely need it — the action forms and the logo picker's
 * canvas. Everything here renders to HTML and ships nothing.
 */

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  /** Top-right slot — a filter row, a maintenance button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {hint ? <p className="mt-0.5 max-w-prose text-xs text-ink-3">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string | undefined;
  tone?: "warn" | "critical" | "good" | undefined;
}) {
  // A number only earns a colour when it is actually saying something. A
  // permanently red "0 failures" teaches everyone to stop reading the colour.
  const alarmed = tone !== undefined && value !== 0 && value !== "0";

  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-3">
      <dt className="truncate text-2xs font-medium tracking-wide text-ink-3 uppercase">
        {label}
      </dt>
      <dd
        className={[
          "mt-1 text-xl font-semibold tabular",
          alarmed && tone === "critical" ? "text-critical" : "",
          alarmed && tone === "warn" ? "text-warn" : "",
          alarmed && tone === "good" ? "text-good" : "",
          alarmed ? "" : "text-ink",
        ].join(" ")}
      >
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
      </dd>
      {hint ? <p className="mt-0.5 text-2xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{children}</dl>
  );
}

/**
 * A table that scrolls inside itself rather than pushing the page sideways.
 * `min-w` is on the table, not the wrapper, so the wrapper can be narrower than
 * its content and still contain the overflow.
 */
export function TableFrame({
  minWidth = "40rem",
  children,
}: {
  minWidth?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align,
  width,
}: {
  children: ReactNode;
  align?: "right" | "center";
  width?: string;
}) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={`px-3 py-2 font-medium ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align,
  className = "",
}: {
  children: ReactNode;
  align?: "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 tabular ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-surface-2 text-2xs tracking-wide text-ink-3 uppercase">
      <tr>{children}</tr>
    </thead>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">
      {children}
    </p>
  );
}

/**
 * Filter chips as links, not buttons.
 *
 * The filter lives in the URL, so a filtered table can be shared ("the
 * ambiguous ones"), bookmarked, and left with the back button. Client state
 * would lose all three and would ship JavaScript to a route group whose whole
 * point is that it does not need any.
 */
export function FilterChips({
  basePath,
  param,
  current,
  options,
  extra,
}: {
  basePath: string;
  param: string;
  current: string | undefined;
  options: { label: string; value: string | undefined }[];
  /** Other query params to carry across, so switching filter keeps the search. */
  extra?: Record<string, string | undefined>;
}) {
  const href = (value: string | undefined) => {
    const next = new URLSearchParams();
    for (const [key, v] of Object.entries(extra ?? {})) {
      if (v) next.set(key, v);
    }
    if (value) next.set(param, value);
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === current || (!option.value && !current);
        return (
          <Link
            key={option.label}
            href={href(option.value)}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
            ].join(" ")}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A search box that submits with GET.
 *
 * A form with `method="get"` puts its field into the query string by itself —
 * no `onChange`, no debounce, no state. The cost is pressing Enter; the saving
 * is every keystroke not becoming a database query, which is the habit that
 * made the old admin expensive.
 */
export function SearchForm({
  action,
  name = "q",
  value,
  placeholder,
  hidden,
}: {
  action: string;
  name?: string;
  value: string | undefined;
  placeholder: string;
  /** Filters to preserve when a search is submitted. */
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} method="get" className="flex gap-2">
      {Object.entries(hidden ?? {}).map(([key, v]) =>
        v ? <input key={key} type="hidden" name={key} value={v} /> : null,
      )}
      <input
        type="search"
        name={name}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-56 rounded-md border border-line bg-surface px-3 text-xs text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
      />
      <button
        type="submit"
        className="h-8 rounded-md border border-line bg-surface px-3 text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
      >
        Search
      </button>
    </form>
  );
}

/** Relative time, for "last seen" columns where the exact minute is noise. */
export function since(value: string | null): string {
  if (!value) return "never";

  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return `${String(Math.floor(days / 30))}mo ago`;
}
