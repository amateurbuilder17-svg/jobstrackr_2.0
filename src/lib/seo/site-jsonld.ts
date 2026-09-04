/**
 * Site-level structured data.
 *
 * `JobPosting` (see `job-jsonld.ts`) is what puts a listing into Google Jobs.
 * These are the two things that operate one level up, and they are worth
 * separating because they answer different questions:
 *
 *   `WebSite` tells an engine what to call the site and how to search it,
 *   which is what a sitelinks search box is built from.
 *
 *   `BreadcrumbList` tells it where a page sits. Google renders it in place of
 *   the raw URL under a result — "jobstrackr.in › Jobs › SSC CGL 2026" reads
 *   as a place in a structure rather than as a string, and it is one of the
 *   few markup types that changes what a person sees before they click.
 *
 * Both are emitted server-side, in the prerendered HTML. A crawler that runs
 * no JavaScript — which includes most of the assistant crawlers — sees them.
 */

export interface Breadcrumb {
  name: string;
  /** Path relative to the site root, e.g. `/jobs`. Omitted on the last item. */
  path?: string;
}

/**
 * The site itself, plus the publisher behind it.
 *
 * Emitted on the home page only. Repeating it on every page is a common
 * mistake and a harmless-looking one — it costs bytes on 5,000 documents to
 * restate a fact that is true once, and gives an engine several copies to
 * reconcile.
 *
 * `potentialAction` describes /jobs?q=, which robots.txt disallows. That is not
 * a contradiction: the disallow stops a crawler enumerating query URLs of its
 * own accord, while this tells the engine the shape to use when a *person*
 * types into a sitelinks search box. The two rules address different actors.
 */
export function websiteJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: siteUrl,
    name: "JobsTrackr",
    description:
      "Government job notifications, exam updates, and eligibility tracking for Indian competitive exams.",
    inLanguage: "en-IN",
    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "JobsTrackr",
      url: siteUrl,
      logo: `${siteUrl}/brand/app-icon-192.png`,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/jobs?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * A trail, ending at the current page.
 *
 * The last item carries no `item` URL, which is what schema.org asks for: the
 * page a reader is already on is not somewhere to navigate to. Including it
 * anyway is the usual way this markup gets flagged as invalid.
 */
export function breadcrumbJsonLd(
  siteUrl: string,
  trail: readonly Breadcrumb[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(crumb.path ? { item: `${siteUrl}${crumb.path}` } : {}),
    })),
  };
}
