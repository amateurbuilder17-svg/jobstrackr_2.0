/**
 * The old app's Popular Exams list, carried across from
 * `src/pages/SyllabusCheck.tsx` — same six exams, same badges, same
 * descriptions, same colours.
 *
 * It is a constant and not a query on purpose. These are the six exams worth
 * putting in front of somebody who has not typed anything yet, and deriving
 * them from traffic would mean a read on every render of the finder to
 * rediscover an answer that changes about once a year.
 *
 * The colours are literal hex rather than theme tokens because they are the
 * conducting body's identity, not the app's: SSC is green in the old app, in
 * this one, and on the badge somebody is looking for. They are used only as a
 * tint behind the badge and as its text colour, so both themes read the same.
 */
export interface PopularExam {
  /** What gets searched — and, via the slug rules, what gets cached. */
  name: string;
  /** The short form on the tile. */
  badge: string;
  description: string;
  color: string;
}

export const POPULAR_EXAMS: readonly PopularExam[] = [
  {
    name: "UPSC Civil Services",
    badge: "UPSC",
    description: "Union Public Service Commission",
    color: "#3B82F6",
  },
  { name: "SSC CGL", badge: "SSC", description: "Combined Graduate Level", color: "#22C55E" },
  { name: "IBPS PO", badge: "IBPS", description: "Probationary Officer", color: "#14B8A6" },
  {
    name: "RRB NTPC",
    badge: "RRB",
    description: "Railway Recruitment Board",
    color: "#F97316",
  },
  { name: "SBI Clerk", badge: "SBI", description: "Junior Associates", color: "#8B5CF6" },
  { name: "GATE", badge: "GATE", description: "Engineering Aptitude Test", color: "#EF4444" },
] as const;
