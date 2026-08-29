import "server-only";

import { parseSyllabus, type ParseResult } from "@/lib/syllabus/schema";
import { generate, type GenerateResult } from "./gemini";
import { SYLLABUS_PROMPT } from "./prompts/syllabus";

/**
 * Asking Gemini for an exam's syllabus.
 *
 * The thin half, exactly as `exam-status.ts` is thin: build the prompt, make
 * one grounded call, hand the answer to a parser that has never touched a
 * network. Everything about what a valid syllabus *is* lives in
 * `lib/syllabus/schema.ts`, which is pure and tested against a dozen real
 * malformed answers.
 *
 * The user prompt is the old function's, unchanged — its numbered list is what
 * makes the model return every stage rather than only the first one.
 */

export interface SyllabusFetch {
  result: ParseResult;
  sources: GenerateResult["sources"];
  grounded: boolean;
  model: string;
}

export async function fetchSyllabus(examName: string): Promise<SyllabusFetch> {
  const result = await generate({
    system: SYLLABUS_PROMPT,
    prompt: `Search for the latest official syllabus for: "${examName}"

Find:
1. All subjects and topics covered
2. Exam pattern (MCQ/Descriptive, marks, duration)
3. If multiple stages exist (Prelims, Mains, Tier 1, Tier 2), include all
4. Official source URLs

Return structured JSON with detailed syllabus breakdown.`,
    // The old function's 0.2. A syllabus is a document to be reported, not
    // written, and the risk at higher temperatures is a plausible topic that
    // is not on the list.
    temperature: 0.2,
    // The old function asked for 8192 and it is the right number here for a
    // reason worth writing down: thinking tokens are charged against this
    // budget too, and a full multi-stage syllabus is long. A cap that truncates
    // the JSON mid-object costs the whole call — the answer is unparseable and
    // the quota is already spent.
    maxTokens: 8192,
  });

  return {
    result: parseSyllabus(result.text, examName),
    // The model's own `grounding_sources` are in the parsed result; these are
    // the pages Google says it actually consulted. They are not always the
    // same, and this pair is the more trustworthy of the two.
    sources: result.sources,
    grounded: result.grounded,
    model: result.model,
  };
}
