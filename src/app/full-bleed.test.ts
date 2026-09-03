import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The two couplings the credential screens and the launch splash depend on.
 *
 * Both are the same kind of hazard: a contract held between a stylesheet and a
 * component that no type checker can see, where breaking it produces something
 * that still compiles, still renders, and is wrong. The sign-in page would
 * simply grow a navigation bar through the middle of the artwork; the splash
 * would replay every time someone tapped Home. Neither would fail a build and
 * neither is obvious in review, which is exactly what a test is for.
 */

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("full-bleed routes", () => {
  const globals = read("src/app/globals.css");

  /**
   * `AppShell` lives in the root layout and cannot know the route, so the
   * route marks itself with `data-fullbleed` and `globals.css` hides the
   * chrome. Rename the attribute on either side and the sign-in screen quietly
   * grows a sidebar.
   */
  it("hides every piece of app chrome on a route marked data-fullbleed", () => {
    expect(read("src/app/(auth)/layout.tsx")).toContain("data-fullbleed");
    expect(globals).toContain("body:has([data-fullbleed]) [data-shell]");
  });

  /**
   * Each of these is hidden by the `[data-shell]` selector above, and each is
   * a full-width or fixed-position element that would sit on top of the
   * artwork without it.
   */
  it.each([
    ["top bar", "src/components/shell/top-bar.tsx", "top-bar"],
    ["sidebar", "src/components/shell/sidebar.tsx", "sidebar"],
    ["site footer", "src/components/shell/site-footer.tsx", "site-footer"],
    ["bottom nav", "src/components/shell/bottom-nav.tsx", "bottom-nav"],
    // The drawer has no visible chrome of its own, but its fifty links are in
    // the DOM on every route. With the menu button hidden it cannot be opened
    // here, and an unopenable drawer's headings are dead weight in the
    // accessibility tree — five `<h2>`s above the page's own `<h1>`.
    ["menu drawer", "src/components/shell/menu-drawer.tsx", "menu-drawer"],
  ])("marks the %s with its data-shell hook", (_name, path, value) => {
    expect(read(path)).toContain(`data-shell="${value}"`);
  });

  /**
   * The rules have to sit outside `@layer base`. Tailwind's `utilities` layer
   * beats `base`, and the two elements being overridden carry `lg:flex` and
   * `pb-24 lg:pb-0` — so inside a layer the override loses to the very
   * utilities it exists to defeat, on desktop only, which is the worst kind of
   * bug to notice.
   */
  it("declares the override outside every cascade layer", () => {
    const rule = globals.indexOf("body:has([data-fullbleed])");
    expect(rule).toBeGreaterThan(-1);

    // Walk back from the rule and count layer braces: an unclosed `@layer`
    // before it would mean the rule is inside one.
    const before = globals.slice(0, rule);
    let depth = 0;
    for (const ch of before) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(depth).toBe(0);
  });
});

describe("launch splash", () => {
  const gate = read("src/components/splash/splash-gate.tsx");
  const css = read("src/components/splash/splash.module.css");

  /**
   * The gate removes `data-splash` after the sequence finishes, so navigating
   * away from `/` and back does not remount the overlay and replay it. If the
   * CSS timeline is ever lengthened past that timeout, the attribute is
   * cleared mid-animation and the splash vanishes halfway through.
   */
  it("clears the gate attribute only after the CSS timeline has finished", () => {
    const timeout = /setTimeout\([^,]+,\s*(\d+)\)/.exec(gate)?.[1];
    const timeline = /animation:\s*splash-dismiss\s+([\d.]+)s/.exec(css)?.[1];

    expect(timeout).toBeDefined();
    expect(timeline).toBeDefined();

    expect(Number(timeout)).toBeGreaterThanOrEqual(Number(timeline) * 1000);
  });

  /**
   * The overlay must default to hidden and become visible only under the
   * gate's attribute. That direction is what makes it safe with JavaScript
   * disabled, for a crawler, and for anyone whose storage throws: the failure
   * mode of a gate that failed open is a full-screen overlay covering the page
   * forever.
   */
  it("defaults to hidden and is shown only by the gate", () => {
    expect(css).toMatch(/\.overlay\s*\{\s*display:\s*none;\s*\}/);
    expect(css).toContain(':global(html[data-splash="show"]) .overlay');
    expect(gate).toContain("d.dataset.splash='show'");
  });

  /**
   * `forwards` is what leaves the overlay hidden at the end, and it is also
   * what makes `prefers-reduced-motion` correct for free: `globals.css` caps
   * every animation at 0.01ms, so the sequence lands on its final keyframe
   * before the first paint. Drop the fill mode and the overlay springs back to
   * fully opaque the moment the animation ends.
   */
  it("holds the dismissed state with a forwards fill", () => {
    expect(css).toMatch(/animation:\s*splash-dismiss[^;]*forwards/);
    expect(css).toMatch(/100%\s*\{[^}]*visibility:\s*hidden/);
  });
});
