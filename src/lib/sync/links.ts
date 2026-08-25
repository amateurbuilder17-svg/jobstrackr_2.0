/**
 * URL hygiene, applied once at ingest.
 *
 * Source sites inject their own aggregator pages, WhatsApp group invites and
 * Telegram channel links into the same "download" and "official website" rows
 * as the genuine notification PDFs. The old app carried this blocklist in the
 * *renderer* and applied it on every view of every page — so the filter list
 * shipped to the browser, and a link that slipped through a gap in it was
 * shown to everyone until the list was patched.
 *
 * Here it runs at write time. A blocked URL is never stored, so the page has
 * nothing to filter and cannot leak what it never received.
 *
 * Pure functions over `unknown`, like the rest of `normalize.ts`, so the whole
 * set is testable without a network or a database.
 */

/**
 * Bare domain like "www.ukmssb.org" or "ukmssb.org/page". The final label must
 * be alphabetic so numeric strings such as a date — "05.08.2026" — never match.
 */
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}([/?#]\S*)?$/i;

/** Hosts whose links are never worth surfacing. Matched on the host, not the
 *  whole URL: a substring test on the URL matches a query parameter that merely
 *  mentions the word, which is how "t.me" once blocked a state government page
 *  carrying `?utm_source=t.me`. */
const BLOCKED_HOSTS = [
  "freejobalert.com",
  "wa.me",
  "whatsapp.com",
  "chat.whatsapp.com",
  "api.whatsapp.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  "telegram.dog",
] as const;

/** Schemes that are not links at all — app handoffs and script payloads. */
const BLOCKED_SCHEMES = ["tg:", "whatsapp:", "javascript:", "data:", "vbscript:"] as const;

/**
 * Turns a raw cell into a clickable absolute URL, or null.
 *
 * Scraped overview tables store bare domains with no protocol, and a browser
 * reads those as relative paths — "www.ukmssb.org" would navigate to
 * `jobstrackr.in/www.ukmssb.org`. Anything that is not recognisably a URL
 * ("Online only", "N/A", a date) returns null rather than being stored as a
 * link that goes nowhere.
 */
export function toUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let value = raw.trim().replace(/[.,;)\]]+$/, "");
  if (value === "") return null;

  if (/\s/.test(value)) {
    // Not a bare URL. Salvage a URL-looking token if one is embedded in prose,
    // which is common in an "Apply at www.example.gov.in before ..." cell.
    const token = value
      .split(/\s+/)
      .find((t) => /^https?:\/\//i.test(t) || BARE_DOMAIN.test(t));
    if (!token) return null;
    value = token.replace(/[.,;)\]]+$/, "");
  }

  const lower = value.toLowerCase();
  if (BLOCKED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return null;

  if (!/^https?:\/\//i.test(value)) {
    if (!BARE_DOMAIN.test(value)) return null;
    value = `https://${value}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  // A hostname with no dot is a local name, not a public site.
  if (!parsed.hostname.includes(".")) return null;
  if (isBlockedHost(parsed.hostname)) return null;

  return parsed.toString();
}

/** Host, or any parent domain of it, on the blocklist. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * Whether a value would survive `toUrl`.
 *
 * Exported for the row filters, which need the predicate without the
 * normalised string.
 */
export function isUsableUrl(raw: unknown): boolean {
  return toUrl(raw) !== null;
}

/**
 * Link text that is an advert rather than a document.
 *
 * The URL check catches the destination; this catches the row whose label is
 * "Join our WhatsApp group" but whose href is a redirector on the source site's
 * own domain, which no host blocklist can see through.
 */
const PROMOTIONAL_TEXT =
  /\b(whats\s*app|telegram|join\s+(our|us)|subscribe|follow\s+us|channel\s+link)\b/i;

export function isPromotionalText(text: unknown): boolean {
  return typeof text === "string" && PROMOTIONAL_TEXT.test(text);
}
