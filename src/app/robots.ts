import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * Crawler rules.
 *
 * Two jobs, and they pull in opposite directions.
 *
 * **Spend the crawl budget on pages that can rank.** Every combination of ?q,
 * ?tag, ?state and ?after is a distinct URL rendering largely the same cards,
 * so leaving them open spends a crawler's visit on near-duplicates instead of
 * on the job pages — and each one crawled before it is cached costs a render.
 * The same argument retires the personalised routes: /profile and /tracker
 * render nothing a signed-out crawler can see, and /countdown/[slug] is a
 * blocking route (`instant = false`), so a crawl of it is a serverless
 * invocation spent on a page that duplicates the deadline already stated on
 * the job page it was made from. It stays shareable; it stops being crawlable.
 *
 * **Be legible to the assistants people now ask instead of searching.** The
 * named blocks below are the crawlers behind ChatGPT, Perplexity, Claude,
 * Gemini and Copilot. They are welcome here — a government job notification is
 * exactly the kind of thing someone asks an assistant about, and an answer
 * that cites this site is a visit.
 *
 * ── The footgun in this file ───────────────────────────────────────────────
 * A named `User-agent` block *replaces* the `*` block for that agent; the two
 * are not merged. So every named block below repeats the same disallow list,
 * and adding a path to `DISALLOW` adds it everywhere rather than only to `*`.
 * Writing `{ userAgent: "GPTBot", allow: "/" }` on its own would not be
 * "welcome GPTBot" — it would be "GPTBot alone may crawl every filtered list
 * URL on the site".
 */

/**
 * The paths no crawler should spend a request on. See the two arguments above:
 * duplicate list URLs, pages that need a session to mean anything, and the one
 * public route that costs an invocation per view.
 */
const DISALLOW = [
  "/api/",
  "/admin",
  // Filtered and paginated lists. `?` is a literal character in robots.txt, so
  // this matches every query-string form and leaves the bare list crawlable.
  "/jobs?",
  "/updates?",
  // Signed-in surfaces. Nothing here renders for an anonymous visitor.
  "/profile",
  "/saved",
  "/for-you",
  "/documents",
  "/my-details",
  "/tracker",
  // Credential screens, and the OAuth callback.
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/auth/",
  // Per-job countdowns: blocking renders, and thin against the job page whose
  // date they restate. The index at /countdown stays open.
  "/countdown/",
];

/**
 * Assistants and answer engines whose crawlers can send a reader back here.
 *
 * Split from the general-purpose search crawlers only for the comment: these
 * get identical rules. `OAI-SearchBot` is what indexes for ChatGPT search and
 * `ChatGPT-User` is what fetches a page when someone asks about it — the pair
 * matters, because blocking either one removes this site from the answer.
 * `Google-Extended` governs Gemini and AI Overviews, and is separate from
 * Googlebot: allowing Googlebot alone leaves the AI surfaces empty.
 */
const ASSISTANT_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "Applebot-Extended",
  "MistralAI-User",
  "cohere-ai",
  "meta-externalagent",
  "Amazonbot",
  "YouBot",
  // Common Crawl. It sends no traffic itself, and it is the corpus a long tail
  // of smaller assistants answer from.
  "CCBot",
];

/** The engines that put a blue link on a results page. */
const SEARCH_AGENTS = ["Googlebot", "Googlebot-News", "Bingbot", "DuckDuckBot", "Applebot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: SEARCH_AGENTS, allow: "/", disallow: DISALLOW },
      { userAgent: ASSISTANT_AGENTS, allow: "/", disallow: DISALLOW },
      // Named to be refused. Bytespider crawls at a volume this site's
      // bandwidth budget notices, and its downstream products serve an
      // audience that does not overlap with Indian government exam candidates
      // at all — so it is cost with no corresponding reach.
      { userAgent: "Bytespider", disallow: "/" },
    ],
    sitemap: `${env.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
    host: env.NEXT_PUBLIC_SITE_URL,
  };
}
