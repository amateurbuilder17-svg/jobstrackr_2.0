/**
 * Cache tag taxonomy.
 *
 * This is the mechanism the whole architecture rests on. Pages render once and
 * live on the CDN indefinitely; they are re-rendered only when ingestion
 * invalidates a tag they carry. Traffic therefore stops driving Supabase reads,
 * and data changes start driving them instead.
 *
 * Two rules keep it honest:
 *
 *   1. Tags are built here and nowhere else. A hand-written tag string that
 *      does not match what the page registered fails silently — the page simply
 *      never updates — and silent staleness is close to unfindable. Typed
 *      builders make the mismatch a compile error instead.
 *
 *   2. Every page tags both its entity and its collection. Editing one job must
 *      refresh that job's page *and* every list it appears on.
 */

export const tags = {
  /** One job's detail page. */
  job: (slug: string) => `job:${slug}` as const,
  /** Every job list, feed and rail. Invalidated whenever any job changes. */
  jobList: () => "jobs:list" as const,

  examUpdate: (slug: string) => `update:${slug}` as const,
  examUpdateList: () => "updates:list" as const,

  organization: (slug: string) => `org:${slug}` as const,
  organizationList: () => "orgs:list" as const,

  exam: (slug: string) => `exam:${slug}` as const,
  examList: () => "exams:list" as const,

  /** The sitemap, which changes whenever any indexable entity does. */
  sitemap: () => "sitemap" as const,
} as const;

export type CacheTag = ReturnType<(typeof tags)[keyof typeof tags]>;

/**
 * The tags a sync run may invalidate. The revalidation endpoint validates
 * incoming tags against this, so a typo in the ingestion worker is rejected
 * loudly rather than accepted and quietly doing nothing.
 */
export const TAG_PREFIXES = [
  "job",
  "jobs",
  "update",
  "updates",
  "org",
  "orgs",
  "exam",
  "exams",
  "sitemap",
] as const;

export function isKnownTag(tag: string): boolean {
  const prefix = tag.includes(":") ? tag.slice(0, tag.indexOf(":")) : tag;
  return (TAG_PREFIXES as readonly string[]).includes(prefix);
}
