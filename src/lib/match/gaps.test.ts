import { describe, expect, it } from "vitest";

import { describeGap, gapTone } from "./gaps";
import { SKILL_KEYS, parseSalaryBand, salaryBandOf, skillLabel } from "./vocab";

/**
 * The half of the matcher that is not in SQL.
 *
 * `match_feed` returns codes and this turns them into the sentence someone
 * reads before deciding whether to pay an application fee. The proof harness
 * covers which code a job gets; these cover what that code says once it is on
 * the page — and, more importantly, that an unrecognised one degrades to
 * readable text rather than taking the route down.
 */

describe("describeGap", () => {
  it("names the skill a posting asks for", () => {
    const gap = describeGap("skill:stenography");
    expect(gap.kind).toBe("skill");
    expect(gap.label).toMatch(/stenography/i);
  });

  it("separates a gate from an acquirable skill", () => {
    expect(describeGap("gate:physical_fitness").kind).toBe("gate");
    expect(describeGap("skill:typing_english").kind).toBe("skill");
  });

  it("distinguishes the profile's silence from the notification's", () => {
    // The whole reason the codes carry a kind. One of these is fixable on this
    // page and the other is not, and rendering them identically wastes it.
    expect(describeGap("unknown:age").kind).toBe("profile");
    expect(describeGap("unstated:level").kind).toBe("notification");
  });

  it("reads an age window and the age that failed it", () => {
    expect(describeGap("age:21-30|35").label).toBe("Age limit 21–30, you are 35");
  });

  it("handles a one-sided age window", () => {
    expect(describeGap("age:-27|29").label).toBe("Age limit up to 27, you are 29");
    expect(describeGap("age:18-|16").label).toBe("Age limit 18 and over, you are 16");
  });

  it("omits the candidate's age when it is not known", () => {
    expect(describeGap("age:21-30|").label).toBe("Age limit 21–30");
  });

  it("uses the qualification labels the profile form uses", () => {
    expect(describeGap("qualification:bachelor").label).toBe("Requires Bachelor's degree");
  });

  it("falls back rather than printing an enum when a level is unknown to it", () => {
    expect(describeGap("qualification:postdoc").label).toBe("Requires a higher qualification");
  });

  it("reads a discipline requirement", () => {
    expect(describeGap("stream:engineering").label).toBe("Requires an engineering discipline");
    expect(describeGap("stream:agriculture").label).toBe("Requires an agriculture discipline");
  });

  it("states a gender restriction as the notification does", () => {
    expect(describeGap("gender:female").label).toBe("Open to women only");
    expect(describeGap("gender:male").label).toBe("Open to men only");
  });

  it("reads an experience shortfall", () => {
    expect(describeGap("experience:3").label).toBe("Needs 3 years of experience");
    expect(describeGap("experience:").label).toBe("Needs more experience");
  });

  it("renders a code it has never seen rather than throwing", () => {
    // `skill_tags_of` is the authority on what tags exist; adding one there is
    // a migration this file must not have to ship alongside.
    const gap = describeGap("skill:quantum_welding");
    expect(gap.label).toBe("Quantum welding");
  });

  it("survives a kind it has never seen", () => {
    expect(() => describeGap("teleportation:required")).not.toThrow();
    expect(describeGap("teleportation:required").label).toBe("teleportation:required");
  });

  it("splits on the first colon only", () => {
    // An age value contains no colon today, but composing the rule this way
    // means one may later without silently truncating.
    expect(describeGap("age:21-30|35").code).toBe("age:21-30|35");
  });
});

describe("gapTone", () => {
  it("spends warn on the definite failures only", () => {
    expect(gapTone("blocked")).toBe("warn");
    expect(gapTone("gate")).toBe("warn");
  });

  it("marks the fixable ones with the accent, not a warning", () => {
    // An unanswered profile field is a to-do, not a problem with the job.
    expect(gapTone("profile")).toBe("accent");
  });

  it("leaves the rest neutral", () => {
    expect(gapTone("skill")).toBe("neutral");
    expect(gapTone("notification")).toBe("neutral");
  });
});

describe("skill vocabulary", () => {
  it("has no duplicate keys across the groups", () => {
    // A duplicate would render two checkboxes writing the same column, and the
    // second would silently win.
    expect(new Set(SKILL_KEYS).size).toBe(SKILL_KEYS.length);
  });

  it("covers every tag the tiering treats as a gate", () => {
    // These are the keys in `public.blocker_skill_tags()`. A gate that cannot
    // be claimed on the form is a job stuck in "worth checking" forever, for
    // someone who already holds the thing being asked for.
    for (const gate of [
      "hindi_proficiency",
      "local_language",
      "sanskrit",
      "physical_fitness",
      "rci_registration",
    ]) {
      expect(SKILL_KEYS).toContain(gate);
    }
  });

  it("labels every key it offers", () => {
    for (const key of SKILL_KEYS) {
      expect(skillLabel(key)).not.toBe(key);
    }
  });
});

describe("salary bands", () => {
  it("round-trips a band through the column pair and back", () => {
    const [min, max] = parseSalaryBand("20000-50000");
    expect([min, max]).toEqual([20000, 50000]);
    expect(salaryBandOf(min, max)).toBe("20000-50000");
  });

  it("reads an open-ended top band", () => {
    expect(parseSalaryBand("200000-")).toEqual([200000, null]);
    expect(salaryBandOf(200000, null)).toBe("200000-");
  });

  it("treats no preference as no bounds", () => {
    expect(parseSalaryBand(null)).toEqual([null, null]);
    expect(parseSalaryBand("")).toEqual([null, null]);
    expect(salaryBandOf(null, null)).toBe("");
  });

  it("returns no band for a stored pair that matches none", () => {
    // Possible if the bands are ever re-cut. The form must fall back to "no
    // preference" rather than pre-selecting the wrong one.
    expect(salaryBandOf(33000, 41000)).toBe("");
  });
});
