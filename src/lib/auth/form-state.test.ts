import { describe, expect, it } from "vitest";

import { safeNext } from "./form-state";

/**
 * `next` is attacker-controlled — it is a query parameter on a public sign-in
 * page. Passing it to `redirect` unchecked turns this site into a credible
 * launch point for a phishing redirect: the victim really did sign in to
 * jobstrackr.in, and is then handed somewhere else.
 */
describe("safeNext", () => {
  it("keeps an ordinary in-app path", () => {
    expect(safeNext("/saved")).toBe("/saved");
    expect(safeNext("/jobs?q=ssc&page=2")).toBe("/jobs?q=ssc&page=2");
  });

  it.each([
    ["https://evil.example/login", "absolute URL"],
    ["//evil.example", "protocol-relative URL"],
    ["http://localhost:3100/jobs", "absolute URL to this host"],
    ["javascript:alert(1)", "javascript: scheme"],
    ["evil.example", "bare host"],
    ["", "empty string"],
  ])("falls back to /profile for %s (%s)", (value) => {
    expect(safeNext(value)).toBe("/profile");
  });

  it("falls back when the parameter is absent or not a string", () => {
    expect(safeNext(null)).toBe("/profile");
    // FormData.get returns File for a file input; anything non-string is refused.
    expect(safeNext(new File([], "x") as unknown as FormDataEntryValue)).toBe("/profile");
  });
});
