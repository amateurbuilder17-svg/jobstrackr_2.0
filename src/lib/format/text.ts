/**
 * Text that came out of someone else's HTML.
 *
 * Scraped prose arrives carrying the entities of the page it was lifted from —
 * `&ndash;`, `&nbsp;`, `&amp;`, the smart quotes. Stored as-is and rendered by
 * React, which escapes its output, a reader sees the literal characters
 * `&ndash;` in the middle of a sentence. 92 job descriptions in production say
 * "Young Professional &ndash; I" today.
 *
 * Applied in two places on purpose, and it is the same split as
 * `jobs/detail-shape.ts`: ingest decodes so what is stored is clean, and the
 * renderer decodes so the rows already in the table read correctly without
 * waiting for a re-scrape. Decoding twice is a no-op, which is what makes
 * having both safe rather than merely tolerable.
 *
 * No `DOMParser` and no dependency: this runs in the ingest worker, in a
 * Server Component and in a plain Node script.
 */

const NAMED: Record<string, string> = {
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  deg: "°",
  rupee: "₹",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  // `amp` is deliberately absent from this table and handled last — see below.
};

const ENTITY = /&(#x?[0-9a-f]+|[a-z]+);/gi;

export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;

  const decoded = value.replace(ENTITY, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      // Control characters and anything outside the Unicode range are left as
      // written: a numeric entity that decodes to a control character is
      // corrupt input, not text somebody meant to publish.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? match;
  });

  // `&amp;` goes last, so `&amp;ndash;` — which is a literal, escaped "&ndash;"
  // that the source intended you to read — decodes to "&ndash;" and stops
  // there, rather than being decoded a second time into a dash.
  return decoded.replace(/&amp;/gi, "&");
}
