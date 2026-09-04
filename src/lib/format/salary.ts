/**
 * Pay, as a reader should see it.
 *
 * `jobs.salary_min` and `jobs.salary_max` are scraped, and the scrapers cannot
 * tell a rupee figure from a pay-matrix level: a notification that says
 * "Level-2 in 7th CPC Pay Matrix; Initial Pay Rs. 19,900/-" is stored with
 * `salary_min = 2`, and the detail page rendered that faithfully as a job
 * paying ₹2 a month. 229 of the 5,489 published rows that carry a salary at
 * all are levels rather than pay.
 *
 * `toSalary` in `sync/normalize.ts` rejects those at ingest, so nothing new
 * lands broken. This module is the read side of the same rule, and it exists
 * because the rows already in the table must read correctly without waiting
 * for a re-scrape — the same split `format/text.ts` makes for entities.
 *
 * It goes one step further than dropping the bad figure. `job_details.salary_text`
 * holds the sentence the level was misread from, and that sentence usually
 * states the actual pay. Reading ₹19,900 back out of it turns a wrong answer
 * into the right one rather than into a blank.
 */

/**
 * The lowest number that can plausibly be a monthly salary in rupees.
 *
 * Deliberately far below any real government salary and far above any pay
 * matrix level or grade-pay band, so nothing genuine is discarded to catch
 * them. `sync/normalize.ts` re-exports this so ingest and the renderer cannot
 * drift — that drift is exactly what the old two-parser pipeline kept doing.
 */
export const MIN_PLAUSIBLE_SALARY = 1_000;

/**
 * The highest. A yearly CTC written into a monthly column, or a table of
 * amounts summed, is the failure on this side; ₹50 lakh a month is not a
 * government post.
 */
export const MAX_PLAUSIBLE_SALARY = 5_000_000;

function plausible(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  return n >= MIN_PLAUSIBLE_SALARY && n <= MAX_PLAUSIBLE_SALARY ? n : null;
}

/** Indian digit grouping, with the rupee sign. */
function rupees(n: number): string {
  return `₹${new Intl.NumberFormat("en-IN").format(n)}`;
}

/** Salary as a range, in the compact form a listing would print. */
export function formatSalary(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null && min !== max) return `${rupees(min)} – ${rupees(max)}`;
  if (min !== null) return rupees(min);
  if (max !== null) return rupees(max);
  return null;
}

/**
 * Numbers in pay prose, with the evidence that each one is money.
 *
 * A bare integer in this text is as likely to be a year, a matrix level, a
 * pay commission or a post count as it is to be pay, so a number is only
 * believed when the sentence marks it: a currency symbol in front of it, Indian
 * digit grouping, a trailing "/-", or a dash putting it on the far side of a
 * range whose near side was already believed.
 */
const MONEY = /(?:(₹|rs\.?|inr)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(\/-)?/gi;

/** A four-digit number in this window is a year unless the text says otherwise. */
const YEAR = /^(19|20)\d{2}$/;

interface Range {
  min: number | null;
  max: number | null;
}

export function salaryFromText(text: string | null): Range {
  if (!text) return { min: null, max: null };

  const found: number[] = [];
  let previousEnd = -1;
  let previousWasMoney = false;

  for (const match of text.matchAll(MONEY)) {
    const [whole, currency, digits, slash] = match;
    if (!digits) continue;
    const start = match.index;
    const raw = digits.replace(/,/g, "");
    const value = Number(raw);

    // The gap since the last number we believed. "₹25,500 – 81,100" and
    // "Rs. 60000 - 70000" state the currency once and the range separator
    // carries it to the other end.
    const between = previousEnd >= 0 ? text.slice(previousEnd, start) : "";
    const continuesRange = previousWasMoney && /^\s*(?:[-–—]|to)\s*$/i.test(between);

    const marked =
      Boolean(currency) || Boolean(slash) || digits.includes(",") || continuesRange;

    previousEnd = start + whole.length;
    previousWasMoney = false;

    if (!marked) continue;
    // "as on 01.01.2026" reaches here as 2026 with no marking; a year that
    // arrives *with* a currency sign in front of it does not exist in this
    // corpus, but an unmarked one is common enough to be worth the rule.
    if (!currency && !slash && YEAR.test(raw)) continue;

    const money = plausible(value);
    if (money === null) continue;

    found.push(money);
    previousWasMoney = true;
  }

  if (found.length === 0) return { min: null, max: null };
  return { min: Math.min(...found), max: Math.max(...found) };
}

/**
 * The salary figures a row actually states, in rupees.
 *
 * The typed columns first, each end tested on its own so a level in one column
 * cannot discard a real figure in the other, and then the pay prose — which is
 * where the level was misread from and so is where the real figure usually
 * still is.
 *
 * Separate from `resolveSalary` because two callers need the numbers rather
 * than the sentence: ingest writes them back into `jobs.salary_min/_max` so the
 * listing cards (which never load `job_details`) are right too, and the
 * JobPosting JSON-LD must publish a figure or nothing — never ₹2.
 */
export function resolveSalaryRange(
  min: number | null,
  max: number | null,
  text: string | null = null,
): Range {
  const typedMin = plausible(min);
  const typedMax = plausible(max);
  if (typedMin !== null || typedMax !== null) return { min: typedMin, max: typedMax };
  return salaryFromText(text);
}

/**
 * The salary a job page should print.
 *
 * `display` is the notification's own wording and wins when it says something
 * a number cannot. Then the typed columns, but only the ones that survive the
 * plausibility test — a level in one column must not poison a real figure in
 * the other. Then the pay prose, which is where the level was misread from and
 * so is where the real figure usually still is.
 *
 * `text` is only available where `job_details` has been loaded; listings pass
 * nothing and simply fall back to null, which renders as "As per rules".
 */
export function resolveSalary(
  display: string | null,
  min: number | null,
  max: number | null,
  text: string | null = null,
): string | null {
  const wording = display?.trim();
  // A display column holding nothing but a bare number is the same scrape
  // artefact as the typed columns, so it gets the same test.
  if (wording && !/^[\d,.\s]+$/.test(wording)) return wording;
  if (wording && plausible(Number(wording.replace(/[^\d.]/g, ""))) !== null) {
    return rupees(Number(wording.replace(/[^\d.]/g, "")));
  }

  const { min: low, max: high } = resolveSalaryRange(min, max, text);
  return formatSalary(low, high);
}
