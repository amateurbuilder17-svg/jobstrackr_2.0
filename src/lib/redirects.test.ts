import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import config from "../../next.config";

/**
 * A redirect must never shadow a page that exists.
 *
 * This test exists because it already happened. The redirect map was written
 * when `/faq`, `/help`, `/user-manual` and `/syllabus` were features the
 * rebuild did not have, pointing them at `/` so a legacy link landed somewhere
 * real. When those pages were built, the redirects stayed — and a 301 is
 * matched before routing, so all four pages built cleanly, passed typecheck,
 * lint, the bundle budget and the production build, appeared in the sitemap,
 * were linked from the menu, and could not be opened by anybody.
 *
 * Nothing in the normal toolchain catches that. The page is present and
 * correct; it is simply unreachable. So the check has to be this one: for every
 * route in the app directory, assert that no redirect claims its path.
 */

const APP_DIR = join(import.meta.dirname, "..", "app");

/** Every routable path in `src/app`, as a Next.js path pattern. */
function routePaths(dir: string, prefix = ""): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;

    // Route groups — `(auth)` — organise files without adding a segment.
    if (entry.startsWith("(") && entry.endsWith(")")) {
      out.push(...routePaths(full, prefix));
      continue;
    }
    // Private folders are not routes.
    if (entry.startsWith("_")) continue;

    // `[slug]` in the file tree is `:slug` in a redirect source.
    const segment = entry.startsWith("[")
      ? `/:${entry.replace(/^\[+|\]+$/g, "")}`
      : `/${entry}`;
    const path = `${prefix}${segment}`;

    const files = readdirSync(full);
    if (files.some((f) => f === "page.tsx" || f === "route.ts")) out.push(path);

    out.push(...routePaths(full, path));
  }

  return out;
}

/**
 * `redirects` is optional on `NextConfig`, so it is narrowed rather than
 * asserted — a config that lost its redirect map should fail this suite with a
 * sentence, not with a non-null assertion throwing at runtime.
 */
async function redirectList() {
  const fn = config.redirects;
  if (!fn) throw new Error("next.config.ts no longer defines redirects()");
  return fn();
}

describe("redirects", () => {
  it("never shadows a route that exists", async () => {
    const redirects = await redirectList();
    const routes = new Set(routePaths(APP_DIR));

    const shadowed = redirects.map((r) => r.source).filter((source) => routes.has(source));

    // Named in the failure rather than just counted: the fix is to delete the
    // redirect, and knowing which one saves a search.
    expect(shadowed, `these redirects shadow real pages: ${shadowed.join(", ")}`).toEqual([]);
  });

  it("sends every legacy path somewhere this app actually serves", async () => {
    const redirects = await redirectList();
    const routes = new Set(routePaths(APP_DIR));

    // Destinations may carry a query string; the path is what has to resolve.
    const dead = redirects
      .map((r) => r.destination.split("?")[0] ?? r.destination)
      .filter((path) => path !== "/" && !routes.has(path))
      // `:param` destinations are substitutions, not literal paths.
      .filter((path) => !path.includes(":"));

    expect(dead, `these redirects point at nothing: ${dead.join(", ")}`).toEqual([]);
  });
});
