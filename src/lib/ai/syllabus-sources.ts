import type { StatusSource } from "@/lib/exams/report";

/**
 * Choosing what goes under "Official Sources" on a syllabus page.
 *
 * Split out of `syllabus.ts` for the same reason `status-parse.ts` is split
 * out of `exam-status.ts`: this is a pure decision about text, and keeping it
 * here means it can be tested against real model output without a database
 * client, an environment, or a network.
 *
 * Two lists arrive from the grounded search pass and neither is sufficient
 * alone. Google's grounding metadata is authoritative — those are pages it
 * really opened — but every URL is wrapped in a `vertexaisearch.cloud.google
 * .com/grounding-api-redirect/…` link carrying two hundred characters of
 * base64. The other list is the addresses the model wrote into its own prose,
 * which read like `ssc.gov.in` and are what a person is actually checking.
 *
 * So the prose wins when it has any, and grounding is the fallback rather than
 * the discard: a wrapped redirect still resolves, and a real one beats no
 * attribution at all.
 *
 * What must never win is a URL from the *structuring* pass. That call has no
 * search tool — it only reshapes text it was handed — so an address from it
 * would be recalled rather than visited, and a recalled URL under a heading
 * reading "Official Sources" is the one kind of wrong this feature cannot
 * afford. Nothing here is ever given that pass's output.
 */

/** As many sources as the page shows without becoming a list of links. */
const MAX_SOURCES = 6;

export function officialUrls(notes: string, grounding: StatusSource[]): string[] {
  const seen = new Set<string>();

  for (const match of notes.matchAll(/https:\/\/[^\s<>"')\]]+/g)) {
    // Trailing punctuation is not part of an address. A URL at the end of a
    // sentence, or in brackets, otherwise gets stored with the full stop on
    // it — and stored is where it stays for thirty days.
    const url = match[0].replace(/[.,;:]+$/, "");
    if (isRedirectWrapper(url)) continue;
    seen.add(url);
    if (seen.size >= MAX_SOURCES) break;
  }

  if (seen.size > 0) return [...seen];
  return grounding.slice(0, MAX_SOURCES).map((source) => source.url);
}

/**
 * A grounding redirect the model has written back into its own prose.
 *
 * It does that, and this is not hypothetical: a live RRB NTPC answer ended its
 * Sources list with
 * `https://vertexaisaisearch.cloud.google.com/grounding-api-redirect/AUZIY…`
 * — Google's wrapper with the hostname mistyped. Matching the host is
 * therefore the wrong test, and the first version of this check was exactly
 * that; it let the mangled one through onto a page headed "Official Sources"
 * while catching the correctly spelled ones.
 *
 * So the path is what is matched. `grounding-api-redirect` is a fixed segment
 * carrying nothing a model would paraphrase, and it survived the mangling the
 * hostname did not. The length cap is the belt to that brace, for a variant
 * that garbles the path too: the wrappers carry a base64 payload well past two
 * hundred characters, and no conducting body publishes at an address that long.
 */
function isRedirectWrapper(url: string): boolean {
  return url.includes("grounding-api-redirect") || url.length > 200;
}
