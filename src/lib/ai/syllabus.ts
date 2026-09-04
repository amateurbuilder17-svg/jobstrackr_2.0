import "server-only";

import { parseSyllabus, type ParseResult } from "@/lib/syllabus/schema";
import { generate } from "./gemini";
import {
  SYLLABUS_NOT_FOUND_MARKER,
  SYLLABUS_RESPONSE_SCHEMA,
  SYLLABUS_SEARCH_PROMPT,
  SYLLABUS_STRUCTURE_PROMPT,
} from "./prompts/syllabus";
import { officialUrls } from "./syllabus-sources";

/**
 * Asking Gemini for an exam's syllabus, in two passes.
 *
 * ## Why two
 *
 * This was one call: grounded, with the JSON contract in the system prompt,
 * handed straight to the parser. Measured against the live API on ten calls
 * across the six Popular Exams, it produced a syllabus this app could read
 * twice. `prompts/syllabus.ts` records what the other eight did and why none
 * of it is fixable by wording the prompt better — the short version is that a
 * grounded call cannot be given a `responseSchema`, so "return this shape" is
 * a request, and a model reading a syllabus off the web would rather write a
 * briefing than fill in a form.
 *
 * So the work is split at the seam the API itself draws:
 *
 *   1. **Search**, grounded, for prose. No shape asked for, nothing to
 *      recite — the model paraphrases what it found, which is the job it does
 *      well and the one Google's recitation filter does not block.
 *   2. **Structure**, ungrounded, with `responseSchema`. Legal precisely
 *      because there is no search tool on this call, and the API now enforces
 *      the key names instead of the prompt suggesting them. This pass never
 *      sees the web; it only reshapes the text pass one produced.
 *
 * On the same six exams, end to end, that reads back a syllabus with real
 * topics for five on the first attempt and the sixth on the second.
 *
 * ## Why the budget is threaded through
 *
 * Two calls, inside one Server Action, under Vercel's sixty seconds. Left to
 * the module defaults the first call could spend thirty seconds and the pool
 * walk behind it several minutes, and the function would be killed long before
 * anything was written — having spent the caller's quota to get there. So
 * `fetchSyllabus` takes a deadline, splits it, and every attempt underneath
 * checks what is left before it starts.
 */

export interface SyllabusFetch {
  result: ParseResult;
  /**
   * Where the syllabus came from, best available first.
   *
   * Plain URLs rather than the `StatusSource` pairs grounding returns, because
   * the syllabus page prints them as text and the cache column is `text[]`;
   * the titles have nowhere to go. `officialUrls` decides which of the two
   * available lists wins, and why.
   */
  sources: string[];
  grounded: boolean;
  model: string;
}

/**
 * The whole pipeline's wall-clock budget.
 *
 * Fifty-two seconds inside the page's sixty (`app/syllabus/page.tsx`), leaving
 * room for the cache write and the redirect that follow it. Both are fast, but
 * they are the half that makes the call worth having made: a syllabus fetched
 * and not stored is one every later visitor pays for again.
 */
const TOTAL_BUDGET_MS = 52_000;

/**
 * The most the search pass may take of it.
 *
 * Grounded calls in testing ran 9–21 seconds; twenty-six leaves the slow tail
 * room without letting one exam starve the pass that has to read its answer.
 */
const SEARCH_BUDGET_MS = 26_000;

/** Below this there is no point starting the structuring pass. */
const MIN_STRUCTURE_MS = 12_000;

export async function fetchSyllabus(examName: string): Promise<SyllabusFetch> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  // ── Pass one: search ──────────────────────────────────────────────────
  const found = await generate({
    system: SYLLABUS_SEARCH_PROMPT,
    prompt: `Exam: "${examName}"`,
    // Higher than the 0.2 this used to run at, and deliberately so. At 0.2 the
    // model reproduces its source closely, which is the sampling behaviour
    // that trips the recitation filter; the answer wanted here is a
    // paraphrase, and a little spread is what makes it one. The facts are held
    // in place by grounding, not by the temperature.
    temperature: 0.3,
    maxTokens: 8192,
    timeoutMs: SEARCH_BUDGET_MS,
    deadline,
  });

  if (found.text.includes(SYLLABUS_NOT_FOUND_MARKER)) {
    // The model's own "no such syllabus", and worth catching here rather than
    // after the second call: there is nothing to structure, and the second
    // call is the slower half.
    return {
      result: { kind: "not-found", message: `No official syllabus found for ${examName}.` },
      sources: [],
      grounded: found.grounded,
      model: found.model,
    };
  }

  const left = deadline - Date.now();
  if (left < MIN_STRUCTURE_MS) {
    return {
      result: { kind: "unreadable", reason: "ran out of time before structuring the answer" },
      sources: officialUrls(found.text, found.sources),
      grounded: found.grounded,
      model: found.model,
    };
  }

  // ── Pass two: structure ───────────────────────────────────────────────
  const shaped = await generate({
    system: SYLLABUS_STRUCTURE_PROMPT,
    prompt: `Exam: ${examName}\n\nNotes:\n${found.text}`,
    responseSchema: SYLLABUS_RESPONSE_SCHEMA,
    // No search tool on this call, which is what makes the schema legal — and
    // stating it rather than relying on the default is what stops `generate`
    // retrying this pass ungrounded, since it already is.
    grounded: false,
    // Zero, because there is a right answer and it is in the notes. Anything
    // this pass invents is a fact nothing grounded it in.
    temperature: 0,
    // Double the default. A full multi-stage syllabus is long, and under
    // `responseMimeType: "application/json"` a truncated answer is not a short
    // syllabus, it is unparseable JSON and the whole pipeline lost.
    maxTokens: 16_384,
    // Reshaping text that is already written needs no deliberation, and
    // thinking tokens come out of the budget above.
    noThinking: true,
    timeoutMs: left,
    deadline,
  });

  const result = parseSyllabus(shaped.text, examName);

  return {
    result:
      // A truncated answer fails the parse for a reason worth naming: the
      // syllabus was too long for one response, not garbled. Same outcome for
      // the caller, but the log says which of the two to go and fix.
      result.kind === "unreadable" && shaped.truncated
        ? { kind: "unreadable", reason: `${result.reason} (answer hit the token ceiling)` }
        : result,
    // From the search pass, always — the structuring pass never saw the web.
    sources: officialUrls(found.text, found.sources),
    grounded: found.grounded,
    model: shaped.model,
  };
}
