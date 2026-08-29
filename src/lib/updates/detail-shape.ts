import type { Json } from "@/lib/db/database.types";
import { decodeEntities } from "@/lib/format/text";
import { toUrl } from "@/lib/sync/links";

/**
 * Cleanup for the scraped `exam_update_details` blobs.
 *
 * Every field in that table came out of an HTML article on a source site, and
 * none of it is the tidy shape the detail page assumed:
 *
 *   • **`sections` are stored as `{heading, content: string[]}`** — a heading
 *     and its bullet lines — not as `{heading, body}`. 998 of the 1,000 rows
 *     sampled use the array shape, so a page reading `section.body` printed a
 *     column of bare headings with nothing underneath every single time.
 *   • **600 of those rows carry at least one section with no lines at all**,
 *     because the section's data lives in the overview table instead. An
 *     expanded-empty panel reads as breakage.
 *   • **822 carry the source site's own adverts inside the article body** —
 *     "Get Custom Govt Job Alerts by Your Qualification", "Join WhatsApp
 *     Channel". Those lines promote the aggregator, not the exam.
 *   • **351 still hold the entities of the page they were lifted from**, so a
 *     reader sees the literal characters `&ndash;` mid-sentence.
 *   • **`important_dates` is a scraped table, header row included** — 210 of
 *     3,537 rows are things like `{event: "Sl. No.", date: "Related
 *     Notification No. & Date"}` — alongside link rows wearing a date row's
 *     clothes (`{event: "Official Website", date: "Click here"}`).
 *   • **`overview` uses `{field, value}`**, which `jobs/detail-shape.ts`'s
 *     `toOverview` does not read; it looks for `label`/`key`/`name`.
 *
 * ── Why this runs at render ───────────────────────────────────────────────
 * The rest of this codebase normalises at write time, and that is the better
 * place: `links.ts` says so at length. But these rows were backfilled from the
 * old project ahead of that rule and never passed through it. Normalising here
 * fixes all 5,374 stored rows on the next request instead of after a re-scrape,
 * and the functions are pure, so ingest can call the same ones. Where a URL is
 * involved they defer to `links.ts` rather than carrying a second blocklist.
 *
 * The blocklist half of that is currently belt-and-braces — a sweep of all
 * 5,374 rows found no blocked host left in `download_links`. It stays because
 * the column is written by a scraper on every ingest, so "clean today" is a
 * measurement, not a guarantee.
 */

/* ── Shared vocabulary ──────────────────────────────────────────────────── */

/**
 * A line or row the source site added to advertise itself or its channels.
 *
 * Ported wholesale from the old app, which had grown this list against the live
 * feed. The aggregators rephrase their own call-to-actions constantly, hence
 * the alternatives on nearly every branch.
 */
const PROMOTIONAL =
  /custom\s*govt\s*job\s*alerts|sarkari\s*(result|exam|job)|freejobalert|free\s*job\s*alert|rojgar\s*result|join\s*(our\s*)?(the\s*)?(telegram|whatsapp|arattai|youtube|instagram|facebook)|(telegram|whatsapp|arattai)\s*(channel|group|link)|follow\s*us|subscribe\s*(to\s*)?(our|us)|(download|get|install)\s*(our\s*|the\s*|mobile\s*|android\s*|ios\s*)*app\b/i;

/** Collapse runs of whitespace and decode the source page's entities. */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The clause the source's rewriter bolts onto the front of a scraped line.
 *
 * These rows are spun before they are published — the same sentence arrives as
 * "As per the official update, Closing date for submit Online: 23-03-2025" on
 * one site and "The official notification states that, Result: 18-10-2025" on
 * another. Harmless in a paragraph; as the label of a row in a two-column date
 * table it is most of the column, and the event it names is pushed off the end.
 *
 * Only ever applied to labels lifted out of prose — a stored `event` cell is
 * left exactly as it was scraped.
 */
const FILLER_LEAD =
  /^(as per (the )?[^,]{0,30}|according to (the )?[^,]{0,30}|it is (informed|stated|notified)[^,]{0,20}|the (official notification|department|board|authorit(y|ies))[^,]{0,40}|(aspirants|candidates|applicants|test-takers|students)\s+(are|should|must|may)[^,]{0,30}|please note)[,:]\s+/i;

function stripFiller(value: string): string {
  const stripped = value.replace(FILLER_LEAD, "").trim();
  // Never strip the whole label away — a line that is nothing but filler keeps
  // its original text rather than becoming an empty table cell.
  return stripped === "" ? value : stripped;
}

/** JSONB columns arrive as objects, but a backfilled row may hold a string. */
function unpack(value: Json | null | undefined): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/* ── Sections ───────────────────────────────────────────────────────────── */

export interface UpdateSection {
  heading: string;
  /** The section's lines. Never empty — an empty section is dropped. */
  lines: string[];
}

/**
 * The article body, as headings and their lines.
 *
 * Reads both stored shapes: `content: string[]` (what the backfill wrote, and
 * what almost every row holds) and `body: string` (what `sync/updates.ts`
 * writes, split back into lines). A section left with nothing to say after the
 * adverts are removed is dropped rather than rendered as an empty panel.
 */
export function toUpdateSections(value: Json | null | undefined): UpdateSection[] {
  const source = unpack(value);
  if (!Array.isArray(source)) return [];

  const out: UpdateSection[] = [];

  for (const entry of source) {
    if (!isRecord(entry)) continue;

    const heading = clean(entry.heading ?? entry.title);
    const raw: unknown = entry.content ?? entry.body ?? entry.text;
    const cells: unknown[] = Array.isArray(raw) ? raw : [raw];

    const lines = cells
      // A `body` string carries its own newlines; an array carries one line per
      // element. Splitting first covers both without a branch — and it has to
      // come before `clean`, which collapses the newlines into spaces.
      .flatMap((cell) => (typeof cell === "string" ? cell.split(/\n+/) : [cell]))
      .map(clean)
      .filter((line) => line !== "" && !PROMOTIONAL.test(line));

    if (lines.length === 0) continue;
    out.push({ heading, lines });
  }

  // The old page capped this at 40. A scraped article longer than that is a
  // parser failure, not a long article.
  return out.slice(0, 40);
}

/* ── Important dates ────────────────────────────────────────────────────── */

export interface UpdateDate {
  event: string;
  /** Short, headline part of the date cell — always safe on one line. */
  date: string;
  /** Trailing qualifier split off a long date cell ("subject to change…"). */
  note: string;
  status: string;
  link: string;
}

/**
 * Labels that are *only* ever column headings — no real schedule row is called
 * "Event" or "S. No.". Because they cannot be a genuine event name, a row is
 * dropped on this cell alone, whatever sits beside it. That matters: sources
 * pair these with arbitrary second columns ("S. No. | Interview Date"), which a
 * both-cells-must-match rule never catches.
 */
const HEADER_ONLY_EVENT =
  /^(events?|activit(y|ies)|particulars?|items?|link\s*descriptions?|descriptions?|sl\.?\s*no\.?|s\.?\s*no\.?|serial\s*no\.?|#|post\s*names?)$/i;

/**
 * A value that carries an actual calendar date.
 *
 * The safety net for the rule above: however that word list grows, a row whose
 * value holds a date is never treated as a header. Filtering can therefore
 * never remove a date from the page by construction, rather than by getting
 * every label right.
 */
const DATE_SIGNAL =
  /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}|(19|20)\d{2})\b/i;

/**
 * A cell that *may* be a heading but can also be a real label — "Last Date"
 * heads a column on one site and names a real row on another. These only count
 * as a header when BOTH cells match, so "Last Date | 09/08/2026" survives.
 *
 * `information` / `value` / `data` are here for the overview tables, whose
 * header is "Detail | Information" on the largest source. Requiring both cells
 * is what makes those safe to list: a real "Details | Tier-2 examination" row
 * has a value that is not a header word, so it survives.
 */
const HEADER_CELL =
  /^(events?|activit(y|ies)|dates?(\s*(&|and|\/)\s*(times?|status|details?))?|times?|schedules?|items?|documents?|actions?|remarks?|status|particulars?|details?|informations?|values?|data|overview|links?|descriptions?|sl\.?\s*no\.?|s\.?\s*no\.?|post\s*names?|job\s*openings?|last\s*date)$/i;

/** Some sources put an article-summary table where the dates table belongs. */
const METADATA_EVENT =
  /^(article\s*(title|name|type|link|url)|page\s*title|source|post\s*name)$/i;

/** A row pointing at a website — the links section already carries it. */
const WEBSITE_EVENT =
  /^(official\s*(portal|website|site|link)|website|home\s*page|apply\s*(online\s*)?link)$/i;

/** Bare domain or URL. The last label must be alphabetic so "12.06.2026" is not one. */
const URL_VALUE = /^(https?:\/\/\S+|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}([/?#]\S*)?)$/i;

/**
 * A "date" cell that is really a link label — the row belongs in the links
 * section. Source titles are rephrased on the way in ("Download" becomes
 * "obtain" / "collect" / "access"), so the call-to-action verbs are all listed.
 */
const LINK_LABEL =
  /^(click|here|links?|download|view|check|apply|visit|obtain|collect|access|get|open|read\s*more|active\s*now|available(\s*soon)?)(\s*(here|now|link|pdf|online|portal|site|website|more))?$/i;

/**
 * Above this the date cell is prose, not a date, so a headline date is split
 * off the front and the rest demoted to a note. 48 characters still fits the
 * longest genuine multi-date value we see ("13th, 16th, 17th, 18th February
 * 2026") without splitting it.
 */
const MAX_INLINE_DATE = 48;

/** Where a date cell stops being a date and starts qualifying it. */
const DATE_TAIL = /\s*[([]\s*|\.\s+|;\s*|\s+[–—-]\s+/;

const isHeaderCell = (value: string): boolean =>
  HEADER_CELL.test(value.replace(/[:.]+$/, "").trim());

/**
 * Split an over-long date cell into a headline date plus a trailing note.
 * Returns the original as the date when there is no natural break, so nothing
 * is ever silently dropped — the renderer wraps it instead.
 */
export function splitDateNote(raw: string): { date: string; note: string } {
  const value = clean(raw);
  if (value.length <= MAX_INLINE_DATE) return { date: value, note: "" };

  const match = DATE_TAIL.exec(value);
  if (match && match.index > 0 && match.index <= MAX_INLINE_DATE) {
    const date = value
      .slice(0, match.index)
      .replace(/[,;:]$/, "")
      .trim();
    const note = value
      .slice(match.index + match[0].length)
      .replace(/^[\s([]+/, "")
      .replace(/[)\]]+$/, "")
      .trim();
    if (date && note) return { date, note };
  }
  return { date: value, note: "" };
}

/** A link rescued from a row that turned out not to be a date row. */
export interface UpdateLink {
  label: string;
  url: string;
}

/**
 * Split a scraped date table into the rows worth showing and the links hiding
 * inside the rows that are not dates.
 *
 * Dropping an "Official Notification PDF — Click here" row is right for the
 * dates table, but the URL on that row is sometimes the only copy of it. It is
 * returned here so the links section can show it, labelled with the event text
 * rather than with the word "here".
 *
 * Row order is preserved: source tables list dates chronologically.
 */
export function partitionUpdateDates(value: Json | null | undefined): {
  dates: UpdateDate[];
  links: UpdateLink[];
} {
  const source = unpack(value);
  if (!Array.isArray(source)) return { dates: [], links: [] };

  const dates: UpdateDate[] = [];
  const links: UpdateLink[] = [];
  const seen = new Set<string>();
  const seenUrls = new Set<string>();

  const harvest = (label: string, rawUrl: string) => {
    // `toUrl` is the one blocklist — it resolves bare domains and refuses
    // aggregator, WhatsApp and Telegram hosts. A rescued link must never be a
    // way around it.
    const url = toUrl(rawUrl);
    if (!url) return;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    links.push({ label, url });
  };

  for (const entry of source) {
    if (!isRecord(entry)) continue;

    const event = clean(entry.event ?? entry.label ?? entry.title ?? entry.name);
    const rawDate = clean(entry.date ?? entry.value ?? entry.schedule);
    const rawLink = clean(entry.link ?? entry.url ?? entry.href);
    if (!event || !rawDate) continue;

    // The source site's own promos — the row and wherever it points.
    if (PROMOTIONAL.test(event) || PROMOTIONAL.test(rawDate)) continue;
    // The article restating itself.
    if (METADATA_EVENT.test(event)) continue;

    // The table's own header row, scraped as data. A cell holding a real date
    // vetoes both checks — see DATE_SIGNAL.
    if (!DATE_SIGNAL.test(rawDate)) {
      if (HEADER_ONLY_EVENT.test(event.replace(/[:.]+$/, "").trim())) continue;
      if (isHeaderCell(event) && isHeaderCell(rawDate)) continue;
    }

    // A link row wearing a date row's clothes — keep the destination, drop the
    // row. Likewise a website row, whose address is in the date cell itself.
    if (LINK_LABEL.test(rawDate)) {
      harvest(event, rawLink);
      continue;
    }
    if (WEBSITE_EVENT.test(event) && URL_VALUE.test(rawDate)) {
      harvest(event, rawLink || rawDate);
      continue;
    }

    const { date, note } = splitDateNote(rawDate);
    const key = `${event.toLowerCase()}|${date.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    dates.push({ event, date, note, status: clean(entry.status), link: toUrl(rawLink) ?? "" });
  }

  return { dates, links };
}

/** The dates alone. Use `partitionUpdateDates` where a links section exists. */
export function toUpdateDates(value: Json | null | undefined): UpdateDate[] {
  return partitionUpdateDates(value).dates;
}

/* ── Overview ───────────────────────────────────────────────────────────── */

export interface UpdateOverviewRow {
  field: string;
  value: string;
}

/**
 * The `overview` array is scraped from a sibling table on the same pages, so it
 * arrives with the same junk — its header row ("Detail | Information") and the
 * source site's promos. Same rules as the dates table, different field names.
 */
export function toUpdateOverview(value: Json | null | undefined): UpdateOverviewRow[] {
  const source = unpack(value);
  if (!Array.isArray(source)) return [];

  const out: UpdateOverviewRow[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const field = clean(entry.field ?? entry.label ?? entry.key ?? entry.name);
    const rowValue = clean(entry.value ?? entry.text);
    if (!field || !rowValue) continue;
    if (isHeaderCell(field) && isHeaderCell(rowValue)) continue;
    if (PROMOTIONAL.test(field) || PROMOTIONAL.test(rowValue)) continue;

    const key = `${field.toLowerCase()}|${rowValue.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field, value: rowValue });
  }

  return out.slice(0, 25);
}

/* ── Dates that are not in the dates table ──────────────────────────────── */

/**
 * Why this exists.
 *
 * `important_dates` is one scraped table, and on 1,515 of the 5,374 stored rows
 * it survives cleaning with nothing in it — 881 of those are link tables wearing
 * a date table's clothes ("Link Description | Link", "Official Website | Click
 * here"), and 1,169 hold no table at all. The page then renders no Important
 * Dates section, which is the single thing a reader opens an admit-card or
 * result page to find.
 *
 * The dates are not missing from the row, only from that column. 947 of those
 * 1,515 carry them in the `overview` table instead — "Exam Date", "Result
 * Declaration Date", "Walk-in Date", "Last Date for Objection" — and a further
 * 59 carry them as `Label: date` lines inside a section headed "Important
 * Dates". Reading both leaves 509 rows genuinely without a date, down from
 * 1,515.
 *
 * The two functions below move those rows rather than copying them: a date
 * promoted into the table is removed from the surface it came from, so the page
 * never states the same fact twice.
 */

/**
 * A field name that promises a date. Paired with `DATE_SIGNAL` on the value, so
 * "Exam Date — As per schedule" stays an overview fact and only a cell with a
 * real date is moved.
 */
const DATE_FIELD =
  /\bdates?\b|\bdeadline\b|\bwindow\b|\bschedule[ds]?\b|declar|releas|conducted\s*on|\blast\s*day\b/i;

/** A section whose lines are a date table written as prose. */
const DATE_HEADING = /important\s*dates?|key\s*dates?|\bschedules?\b/i;

/**
 * `Label: value` — the shape those prose date lines take. The label is bounded
 * so a sentence with a colon in it ("Note: candidates who applied before the
 * closing date of 12-03-2025 need not …") is not read as a row.
 */
const PROSE_DATE_ROW = /^(.{3,64}?)\s*[:–—]\s*(.{4,80})$/;

/** Rows already in the table, keyed by their date value. */
const dateKeys = (dates: UpdateDate[]): Set<string> =>
  new Set(dates.map((entry) => entry.date.toLowerCase().replace(/\s+/g, "")));

/**
 * Split the overview into the rows that are really dates and the rows that are
 * really facts.
 *
 * De-duplication is on the date *value*, not on the label: the same day reached
 * from two tables is usually worded differently ("Exam Date" against "Date of
 * Examination"), and showing it twice under two names reads as two events.
 */
export function datesFromOverview(
  rows: UpdateOverviewRow[],
  existing: UpdateDate[] = [],
): { dates: UpdateDate[]; rest: UpdateOverviewRow[] } {
  const seen = dateKeys(existing);
  const dates: UpdateDate[] = [];
  const rest: UpdateOverviewRow[] = [];

  for (const row of rows) {
    if (!DATE_FIELD.test(row.field) || !DATE_SIGNAL.test(row.value)) {
      rest.push(row);
      continue;
    }

    const { date, note } = splitDateNote(row.value);
    const key = date.toLowerCase().replace(/\s+/g, "");
    // Already in the table under another name — drop the duplicate outright
    // rather than leaving it in "At a glance", where it reads as a second date.
    if (seen.has(key)) continue;
    seen.add(key);
    dates.push({ event: row.field.replace(/[:.]+$/, ""), date, note, status: "", link: "" });
  }

  return { dates, rest };
}

/**
 * Pull `Label: date` lines out of a section headed "Important Dates".
 *
 * Lines that parse are removed from the section, so the accordion does not
 * repeat as a paragraph what the table above now shows as a row; a section left
 * with nothing else to say disappears with them.
 */
export function datesFromSections(
  sections: UpdateSection[],
  existing: UpdateDate[] = [],
): { dates: UpdateDate[]; rest: UpdateSection[] } {
  const seen = dateKeys(existing);
  const dates: UpdateDate[] = [];
  const rest: UpdateSection[] = [];

  for (const section of sections) {
    if (!DATE_HEADING.test(section.heading)) {
      rest.push(section);
      continue;
    }

    const kept: string[] = [];
    for (const line of section.lines) {
      const match = PROSE_DATE_ROW.exec(line);
      const label = match?.[1]?.trim() ?? "";
      const value = match?.[2]?.trim() ?? "";
      if (label === "" || !DATE_SIGNAL.test(value)) {
        kept.push(line);
        continue;
      }

      const { date, note } = splitDateNote(value);
      const key = date.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      // The label came out of a sentence, so it still carries the rewriter's
      // lead-in — see `stripFiller`.
      dates.push({ event: stripFiller(label), date, note, status: "", link: "" });
    }

    if (kept.length > 0) rest.push({ ...section, lines: kept });
  }

  return { dates, rest };
}

/* ── Links ──────────────────────────────────────────────────────────────── */

/**
 * Text that looks like an address rather than a description — the whole label
 * is one domain or URL, with nothing else in it.
 *
 * The anchoring matters: a genuine label that merely *mentions* a site ("Apply
 * at ssc.gov.in") has a space in it and is left alone.
 */
const ADDRESS_TEXT = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

/**
 * True when the link text tells the reader nothing about where it goes.
 *
 * A bare domain counts. 4,248 of the 12,514 stored links are labelled that way
 * — "tgpsc.gov.in", "www.upsssc.gov.in", "drive.google.com" — some inferred by
 * an older fallback and most of them scraped as the anchor's own text. Either
 * way the label names the host rather than the document, and a page whose links
 * list is a column of domains gives the reader no way to tell the notification
 * PDF from the department's home page. Passing them back through
 * `inferLinkLabel` gives at least "Official website" or "Notification PDF".
 */
export function isGenericLinkText(text: string): boolean {
  const t = text
    .toLowerCase()
    .trim()
    .replace(/\s*[-–—:]\s*click\s*here$/i, "");
  if (t === "") return true;
  return (
    /^(click(\s*here)?|here|link|download|view|open|go|visit|check|get|obtain|collect|access)$/i.test(
      t,
    ) || ADDRESS_TEXT.test(t)
  );
}

/** Hosts that only ever serve a stored document, never a page worth naming. */
const DOCUMENT_HOST = /^(drive|docs)\.google\.com$|^(www\.)?dropbox\.com$/i;

/**
 * Infer a label from a URL, hinted by the update's own category.
 *
 * The last resort used to be the bare hostname, and it was reached by 4,248 of
 * the 12,514 stored links — a third of every links list read "drive.google.com"
 * / "vnit.ac.in", which names the company hosting the file rather than the file.
 * The two shapes behind almost all of those are handled before the fallback: a
 * URL with no path is a home page, and a document host is whatever document
 * this update is about.
 */
export function inferLinkLabel(url: string, category?: string | null): string {
  const u = url.toLowerCase();
  if (u.includes("admit") || u.includes("hall-ticket") || u.includes("hallticket"))
    return "Admit card";
  if (u.includes("result") || u.includes("score")) return "Check result";
  if (u.includes("answer") || u.includes("key")) return "Answer key";
  if (u.includes("apply") || u.includes("registr") || u.includes("application"))
    return "Apply online";
  if (u.includes("syllabus") || u.includes("pattern")) return "Syllabus";
  if (u.includes("notification") || u.includes(".pdf")) return "Notification PDF";
  if (u.includes("cutoff") || u.includes("cut-off")) return "Cut-off";

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    return "Official link";
  }

  // Nothing after the host: this is the department's home page, whatever it is
  // called. That is a fact about the URL, not a guess about the destination.
  if (parsed.pathname.replace(/\/+$/, "") === "" && parsed.search === "")
    return "Official website";

  const cat = (category ?? "").toLowerCase();
  const document = DOCUMENT_HOST.test(parsed.hostname);
  if (cat.includes("admit")) return document ? "Admit card PDF" : "Admit card link";
  if (cat.includes("result")) return document ? "Result PDF" : "Result link";
  if (cat.includes("answer")) return document ? "Answer key PDF" : "Answer key link";
  if (cat.includes("syllabus")) return document ? "Syllabus PDF" : "Syllabus link";
  if (cat.includes("cutoff")) return document ? "Cut-off PDF" : "Cut-off link";
  if (document) return "Notification PDF";

  // …and finally the site itself, which at least names the destination.
  return parsed.hostname.replace(/^www\./, "");
}

/**
 * The label to render for a scraped link: its own text when it says something.
 *
 * Source sites label almost every link "Click here", so an unlabelled list ends
 * up as six identical rows with no way to tell the notification PDF from the
 * department's homepage.
 */
export function linkLabel(text: string, url: string, category?: string | null): string {
  const trimmed = clean(text)
    .replace(/\s*[-–—:]\s*click\s*here$/i, "")
    .trim();
  return isGenericLinkText(text) || trimmed === "" ? inferLinkLabel(url, category) : trimmed;
}

/**
 * Every link worth showing, de-duplicated and labelled.
 *
 * Takes the stored `download_links` and whatever `partitionUpdateDates`
 * rescued, in that order, and puts both through `toUrl` — the rows backfilled
 * from the old project predate the ingest blocklist and still carry WhatsApp
 * channel invites today.
 *
 * ── Why the labels are collected before one is chosen ─────────────────────
 * The same URL usually arrives twice: once from `download_links`, labelled the
 * way the source site labelled it ("Click here", or nothing), and once from a
 * date row, labelled with that row's event cell — "Official Notification PDF",
 * "Application Form". Keeping whichever came first meant the *worse* of the two
 * won every time, because `download_links` is read first, and the good label
 * was discarded as a duplicate. So every label for a URL is gathered, and the
 * first one that actually names the destination wins.
 */
export function toUpdateLinks(
  value: Json | null | undefined,
  harvested: UpdateLink[] = [],
  category?: string | null,
): UpdateLink[] {
  const source = unpack(value);
  const byUrl = new Map<string, { url: string; labels: string[] }>();

  const push = (rawLabel: string, rawUrl: unknown) => {
    const url = toUrl(rawUrl);
    if (!url) return;
    // A row whose label is an advert but whose href is a redirector on the
    // source site's own domain — no host blocklist can see through that.
    if (PROMOTIONAL.test(rawLabel)) return;

    const key = url.replace(/\/+$/, "").toLowerCase();
    const entry = byUrl.get(key) ?? { url, labels: [] };
    if (rawLabel !== "") entry.labels.push(rawLabel);
    byUrl.set(key, entry);
  };

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      const label = clean(entry.label ?? entry.text ?? entry.title);
      push(label, entry.url ?? entry.href ?? entry.link);
    }
  }
  for (const link of harvested) push(link.label, link.url);

  return [...byUrl.values()].map(({ url, labels }) => {
    const named = labels.find((label) => !isGenericLinkText(label));
    return { label: linkLabel(named ?? "", url, category), url };
  });
}

/**
 * The one link the reader came for, and the official site to pair it with.
 *
 * The old page put these two at the top as full-width buttons, and that was the
 * right call: on an admit-card update, "download the admit card" is the entire
 * reason the page was opened. The rest of the list still renders below.
 */
export function primaryLinks(links: UpdateLink[]): {
  action: UpdateLink | null;
  official: UpdateLink | null;
} {
  const action =
    links.find(
      (link) =>
        /\.pdf(\?|$)/i.test(link.url) ||
        /result|admit|answer|merit|list|cut-?off|download|score|slip/i.test(link.label),
    ) ??
    links[0] ??
    null;

  const official =
    links.find(
      (link) =>
        link !== action &&
        (/official|website|home/i.test(link.label) || /\.(gov|nic)\.in/i.test(link.url)),
    ) ??
    links.find((link) => link !== action) ??
    null;

  return { action, official };
}

/* ── Related articles ───────────────────────────────────────────────────── */

/**
 * `related_articles` is empty on every production row sampled, but the column
 * is populated by the scraper for some sources and the old page rendered it.
 * Same hygiene as the links list.
 */
export function toRelatedArticles(value: Json | null | undefined): UpdateLink[] {
  const source = unpack(value);
  if (!Array.isArray(source)) return [];

  const out: UpdateLink[] = [];
  const seen = new Set<string>();

  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const url = toUrl(entry.url ?? entry.href ?? entry.link);
    if (!url) continue;
    const label = clean(entry.title ?? entry.label ?? entry.text);
    if (!label || PROMOTIONAL.test(label)) continue;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, url });
  }

  return out.slice(0, 12);
}

/* ── Relating one update to another ─────────────────────────────────────── */

/**
 * Words that lead a title without naming the body behind it.
 *
 * "Result 2026 - ..." and "Notification Out ..." are how a handful of titles
 * open, and taking those as the relation term would relate an update to every
 * result in the table.
 */
const NOT_AN_ORGANISATION = new Set([
  "result",
  "results",
  "admit",
  "card",
  "hall",
  "ticket",
  "entry",
  "pass",
  "answer",
  "key",
  "notification",
  "recruitment",
  "exam",
  "merit",
  "list",
  "score",
  "cut",
  "cutoff",
  "syllabus",
  "final",
  "latest",
  "new",
  "out",
]);

/**
 * The term that relates this update to its siblings — the organisation the
 * title leads with.
 *
 * Titles in this table are uniformly `<BODY> <what happened> <year>`:
 * "UPSSSC Forensic Science Laboratory Result 2026", "KVS NVS Tier 2 Entry pass
 * 2026", "RRB Group D PET Entry pass 2026". The leading acronym is the exam
 * family, and it is the only relation signal the rows carry — `exam_id`,
 * `organization_id` and `tags` are empty on essentially all of them.
 *
 * Acronyms only, and at most two: "KVS NVS" is one exam run jointly, while a
 * title that opens with an ordinary word ("Indian Army ...") gives the first
 * two words instead. Returns null rather than a weak term, and the caller then
 * renders no related section at all — an empty rail is worse than none.
 */
export function relationTerm(title: string): string | null {
  const words = clean(title)
    .split(/[\s,–—-]+/)
    .filter((word) => word !== "");

  const acronyms: string[] = [];
  for (const word of words) {
    // An acronym: all caps, 2–8 letters, optionally with digits ("CRP", "NVS").
    if (!/^[A-Z][A-Z0-9]{1,7}$/.test(word)) break;
    if (NOT_AN_ORGANISATION.has(word.toLowerCase())) break;
    acronyms.push(word);
    if (acronyms.length === 2) break;
  }

  if (acronyms.length > 0) return acronyms.join(" ");

  // No leading acronym. The first two words are the next best thing — "Indian
  // Army", "High Court" — provided neither is one of the event words above.
  const head = words
    .slice(0, 2)
    .filter((word) => /^[A-Za-z][A-Za-z.]{1,}$/.test(word))
    .filter((word) => !NOT_AN_ORGANISATION.has(word.toLowerCase()));

  return head.length === 2 ? head.join(" ") : null;
}
