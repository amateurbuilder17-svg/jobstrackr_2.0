import Link from "next/link";

export interface HubIndexGroup {
  title?: string;
  links: { href: string; label: string; count: number }[];
}

/**
 * An index of hubs — every state, every category, every organisation — with
 * how many items each holds. The footer links here from every page on the
 * site, which is what puts every hub, and so every detail page, a few clicks
 * from anywhere.
 */
export function HubIndex({
  heading,
  intro,
  groups,
}: {
  heading: string;
  intro: string;
  groups: HubIndexGroup[];
}) {
  const empty = groups.every((g) => g.links.length === 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
        <Link href="/" className="hover:text-ink hover:underline underline-offset-4">
          Home
        </Link>
      </nav>

      <h1 className="mt-3 font-cond text-2xl font-bold tracking-tight text-balance text-ink sm:text-3xl">
        {heading}
      </h1>
      <p className="mt-3 leading-relaxed text-ink-2">{intro}</p>

      {empty ? (
        <p className="mt-8 rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-ink-2">
          Nothing is listed here right now.
        </p>
      ) : (
        groups
          .filter((g) => g.links.length > 0)
          .map((group) => (
            <section key={group.title ?? "all"} className="mt-8">
              {group.title ? (
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                  {group.title}
                </h2>
              ) : null}
              <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {group.links.map(({ href, label, count }) => (
                  <li key={href} className="border-b border-line">
                    <Link
                      href={href}
                      prefetch={false}
                      className="flex items-baseline justify-between gap-3 py-2.5 text-ink underline-offset-4 hover:text-brand hover:underline"
                    >
                      <span className="font-medium">{label}</span>
                      <span className="shrink-0 text-xs text-ink-3 tabular">{count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
}
