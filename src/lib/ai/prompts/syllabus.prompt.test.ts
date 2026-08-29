import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SYLLABUS_PROMPT } from "./syllabus";

/**
 * The prompt is behaviour, so it is pinned like behaviour.
 *
 * A prompt is the least reviewable thing in a codebase: it reads like prose, it
 * diffs like prose, and a one-word change to it can alter what thousands of
 * cached answers contain without a single test going red. This file makes that
 * impossible — any edit to the text fails here, and re-pinning the hash is the
 * deliberate act that says "yes, I meant to change the model's instructions".
 *
 * The structural assertions below are not redundant with the hash. The hash
 * says *something* changed; they say which of the load-bearing parts survived,
 * so a re-pin still has to keep the contract the parser depends on.
 *
 * To re-pin: run the suite, copy the actual hash from the failure, and change
 * it here in the same commit as the prompt edit.
 */
const PINNED_SHA256 = "c7153b7f8539c634aebc6189ced822c577fb296b6193e00bcba0f1c35155c6e9";

describe("SYLLABUS_PROMPT", () => {
  it("has not changed without someone saying so", () => {
    const actual = createHash("sha256").update(SYLLABUS_PROMPT, "utf8").digest("hex");
    expect(actual).toBe(PINNED_SHA256);
  });

  it("still asks for the things the parser depends on", () => {
    // The schema in `lib/syllabus/schema.ts` reads these keys. If the prompt
    // stops asking for one, every answer starts failing validation and the
    // feature returns "could not read that" for every exam.
    for (const key of [
      '"exam_name"',
      '"year"',
      '"syllabus"',
      '"stages"',
      '"grounding_sources"',
      '"confidence"',
      '"topics"',
      '"stage_name"',
    ]) {
      expect(SYLLABUS_PROMPT).toContain(key);
    }
  });

  it("still demands JSON and nothing else", () => {
    // Without this the model wraps its answer in prose, and while the parser
    // recovers a fenced object, it cannot recover a chatty preamble.
    expect(SYLLABUS_PROMPT).toContain("Return ONLY the JSON object, no other text");
    expect(SYLLABUS_PROMPT).toContain("no markdown");
  });

  it("still tells the model to search rather than recall", () => {
    // The whole point. A model answering an exam-syllabus question from its
    // weights answers about its training cutoff, fluently and confidently.
    expect(SYLLABUS_PROMPT).toContain("Google Search");
    expect(SYLLABUS_PROMPT).toContain("CURRENT official syllabus");
  });

  it("still asks for every stage, not just the first", () => {
    expect(SYLLABUS_PROMPT).toContain("include ALL stages");
  });

  it("still has a way to say it found nothing", () => {
    // Without this the model invents a plausible syllabus for an exam that does
    // not exist, which is the single worst failure this feature can have.
    expect(SYLLABUS_PROMPT).toContain('{"error": "Syllabus not found for this exam"}');
  });
});
