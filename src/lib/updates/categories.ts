/**
 * Update categories, mirrored from the `update_category` enum in 0002.
 *
 * Zero imports, so a Client Component can read the labels without dragging Zod
 * or a server module into the browser bundle — the same rule as
 * `profile/enums.ts` and `tracker/enums.ts`.
 */

export const UPDATE_CATEGORIES = [
  "admit_card",
  "result",
  "answer_key",
  "syllabus",
  "notification",
  "exam_date",
  "cutoff",
  "news",
] as const;

export type UpdateCategory = (typeof UPDATE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<UpdateCategory, string> = {
  admit_card: "Admit card",
  result: "Result",
  answer_key: "Answer key",
  syllabus: "Syllabus",
  notification: "Notification",
  exam_date: "Exam date",
  cutoff: "Cut-off",
  news: "News",
};

/**
 * Tone per category. Only the two people actively wait for get a colour — an
 * admit card they must download and a result they are refreshing for.
 * Colouring all eight would mean colour communicates nothing.
 */
export const CATEGORY_TONE: Record<UpdateCategory, "neutral" | "accent" | "good"> = {
  admit_card: "accent",
  result: "good",
  answer_key: "neutral",
  syllabus: "neutral",
  notification: "neutral",
  exam_date: "neutral",
  cutoff: "neutral",
  news: "neutral",
};

/**
 * What the page's primary button says.
 *
 * Named for the category rather than for the link, which is how the old app
 * labelled it and is the reason that button worked: the reader arrived wanting
 * "the admit card", and the scraped link is called "Click here" or, once a
 * label has been inferred for it, "drive.google.com". The link's own label
 * still names it in the list further down, where there is room for six of them
 * and telling them apart is the whole point.
 */
export const CATEGORY_CTA: Record<UpdateCategory, string> = {
  admit_card: "Download admit card",
  result: "Check result",
  answer_key: "View answer key",
  syllabus: "View syllabus",
  notification: "Download notification",
  exam_date: "View exam date notice",
  cutoff: "View cut-off",
  news: "Read the notice",
};

/**
 * The filter chips on /updates — the whole enum, in the order people look for
 * them.
 *
 * It used to be a five-item shortlist, which meant three categories existed in
 * the data, were rendered on cards, and could not be filtered to. The row
 * scrolls sideways rather than wrapping, so the length costs nothing above the
 * fold; see `FilterChips`.
 */
export const CATEGORY_FILTERS: { label: string; value: UpdateCategory }[] = [
  { label: "Admit cards", value: "admit_card" },
  { label: "Results", value: "result" },
  { label: "Answer keys", value: "answer_key" },
  { label: "Exam dates", value: "exam_date" },
  { label: "Notifications", value: "notification" },
  { label: "Cut-offs", value: "cutoff" },
  { label: "Syllabus", value: "syllabus" },
  { label: "News", value: "news" },
];
