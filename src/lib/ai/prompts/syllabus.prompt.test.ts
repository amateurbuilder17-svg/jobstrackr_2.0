import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SYLLABUS_NOT_FOUND_MARKER,
  SYLLABUS_RESPONSE_SCHEMA,
  SYLLABUS_SEARCH_PROMPT,
  SYLLABUS_STRUCTURE_PROMPT,
} from "./syllabus";

/**
 * The prompts are behaviour, so they are pinned like behaviour.
 *
 * A prompt is the least reviewable thing in a codebase: it reads like prose, it
 * diffs like prose, and a one-word change to it can alter what thousands of
 * cached answers contain without a single test going red. This file makes that
 * impossible — any edit to the text fails here, and re-pinning the hash is the
 * deliberate act that says "yes, I meant to change the model's instructions".
 *
 * The structural assertions below are not redundant with the hashes. The hash
 * says *something* changed; they say which of the load-bearing parts survived,
 * so a re-pin still has to keep the contract the pipeline depends on.
 *
 * To re-pin: run the suite, copy the actual hash from the failure, and change
 * it here in the same commit as the prompt edit.
 */
const PINNED_SEARCH_SHA256 = "59c8433fb7fc71412df367e08b578fd83d3fa52ef60bbbabfe09d9da0e903c75";
const PINNED_STRUCTURE_SHA256 =
  "b478d437fef38e50c485c4b31d8c2abd4cfe7509e0a5671506da4b0bb606c9ea";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("SYLLABUS_SEARCH_PROMPT", () => {
  it("has not changed without someone saying so", () => {
    expect(sha(SYLLABUS_SEARCH_PROMPT)).toBe(PINNED_SEARCH_SHA256);
  });

  it("still tells the model to search rather than recall", () => {
    // The whole point of the grounded pass. A model answering an exam-syllabus
    // question from its weights answers about its training cutoff, fluently
    // and confidently.
    expect(SYLLABUS_SEARCH_PROMPT).toContain("Google Search");
    expect(SYLLABUS_SEARCH_PROMPT).toContain("CURRENT official syllabus");
  });

  it("still asks for a paraphrase rather than the document", () => {
    // This is the recitation fix, and it is the single line standing between
    // this feature and `finishReason: RECITATION` with an empty body — which
    // arrives after the caller's daily quota has been claimed.
    expect(SYLLABUS_SEARCH_PROMPT).toContain("Paraphrase");
    expect(SYLLABUS_SEARCH_PROMPT).toContain("do not reproduce any document verbatim");
  });

  it("still asks for one topic per line", () => {
    // Without it the model writes "Reasoning covers analogies, series and
    // coding-decoding", and the structuring pass has to guess where one topic
    // ends and the next begins.
    expect(SYLLABUS_SEARCH_PROMPT).toContain("one per line");
  });

  it("still keeps this pass out of the structuring pass's job", () => {
    // A half-JSON answer here is worse than prose: it looks like something the
    // parser ought to be able to read.
    expect(SYLLABUS_SEARCH_PROMPT).toContain("Do not use JSON, tables or code blocks");
  });

  it("still asks for every stage, not just the first", () => {
    expect(SYLLABUS_SEARCH_PROMPT).toContain("describe ALL of them");
  });

  it("still asks for the addresses it used", () => {
    // The only place a publisher's own URL can come from. Grounding returns
    // real pages wrapped in Google redirects, and the syllabus page prints its
    // sources as visible text — see `officialUrls` in lib/ai/syllabus.ts.
    expect(SYLLABUS_SEARCH_PROMPT).toContain("Sources:");
    expect(SYLLABUS_SEARCH_PROMPT).toContain("each starting with https://");
  });

  it("still has a way to say it found nothing", () => {
    // Without this the model invents a plausible syllabus for an exam that does
    // not exist, which is the single worst failure this feature can have. The
    // marker is also what lets `fetchSyllabus` stop before the second call.
    expect(SYLLABUS_SEARCH_PROMPT).toContain(SYLLABUS_NOT_FOUND_MARKER);
  });
});

describe("SYLLABUS_STRUCTURE_PROMPT", () => {
  it("has not changed without someone saying so", () => {
    expect(sha(SYLLABUS_STRUCTURE_PROMPT)).toBe(PINNED_STRUCTURE_SHA256);
  });

  it("still forbids adding anything the notes do not contain", () => {
    // This pass is ungrounded. Anything it supplies from its own weights is a
    // fact with nothing behind it, cached for thirty days on a page headed
    // with official sources.
    expect(SYLLABUS_STRUCTURE_PROMPT).toContain("Use ONLY what the notes below say");
    expect(SYLLABUS_STRUCTURE_PROMPT).toContain("null rather than guessing");
  });

  it("still caps topics per section", () => {
    // A budget, not an editorial choice: past ~16k output tokens the JSON is
    // truncated, and truncated JSON is no answer at all.
    expect(SYLLABUS_STRUCTURE_PROMPT).toContain("at most 40 topics per section");
  });
});

describe("SYLLABUS_RESPONSE_SCHEMA", () => {
  /** Walk to a nested property definition, failing loudly if the path breaks. */
  function at(path: string[]): Record<string, unknown> {
    let node: Record<string, unknown> = SYLLABUS_RESPONSE_SCHEMA;
    for (const step of path) {
      const properties = node.properties as Record<string, unknown> | undefined;
      const next = (node[step] ?? properties?.[step]) as Record<string, unknown> | undefined;
      if (next === undefined) throw new Error(`schema has no ${path.join(".")}`);
      node = next;
    }
    return node;
  }

  it("names the keys the Zod schema reads", () => {
    // The two schemas are separate on purpose — this one constrains what the
    // model may say, `lib/syllabus/schema.ts` decides whether it is worth
    // caching — but they have to agree on the key names, or every answer
    // validates against the API and fails against the app.
    const top = SYLLABUS_RESPONSE_SCHEMA.properties as Record<string, unknown>;
    expect(Object.keys(top).sort()).toEqual(["confidence", "exam_name", "stages", "year"]);

    const stage = at(["stages", "items"]).properties as Record<string, unknown>;
    expect(Object.keys(stage).sort()).toEqual([
      "duration_mins",
      "exam_type",
      "sections",
      "stage_name",
      "total_marks",
    ]);

    const section = at(["stages", "items", "sections", "items"]).properties as Record<
      string,
      unknown
    >;
    expect(Object.keys(section).sort()).toEqual([
      "marks",
      "marks_weightage",
      "section_title",
      "subject",
      "topics",
    ]);
  });

  it("keeps topics a list of strings", () => {
    // The one field the whole feature turns on: `parseSyllabus` rejects an
    // answer with no topics anywhere, and a single joined sentence counts as
    // one topic rather than twenty.
    const topics = at(["stages", "items", "sections", "items", "topics"]);
    expect(topics.type).toBe("ARRAY");
    expect(topics.items).toEqual({ type: "STRING" });
  });

  it("requires the parts an answer is worthless without", () => {
    expect(SYLLABUS_RESPONSE_SCHEMA.required).toEqual(["exam_name", "stages"]);
    expect(at(["stages", "items"]).required).toEqual(["stage_name", "sections"]);
    expect(at(["stages", "items", "sections", "items"]).required).toEqual([
      "subject",
      "topics",
    ]);
  });

  it("does not ask the model for sources it cannot have", () => {
    // The structuring pass is ungrounded. A `grounding_sources` field here
    // would be an invitation to recall URLs, and those get stored next to a
    // heading that says the syllabus came from official notifications.
    expect(JSON.stringify(SYLLABUS_RESPONSE_SCHEMA)).not.toContain("grounding_sources");
  });
});
