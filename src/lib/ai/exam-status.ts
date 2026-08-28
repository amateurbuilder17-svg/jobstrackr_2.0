import "server-only";

import type { StatusReport } from "@/lib/exams/report";
import { generate, type GenerateResult } from "./gemini";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  parseStatusReport,
  type StatusSubject,
} from "./status-parse";

/**
 * Asking Gemini where an exam has got to.
 *
 * The thin half of the feature: build the prompt, make one grounded call, hand
 * the answer to the parser. Everything that decides what "the answer" means —
 * the JSON contract, the coercion, the checks that stop a fluent answer being a
 * wrong one — lives in `status-parse.ts`, which is pure and tested on its own.
 *
 * The split is not tidiness. This module reaches the network and reads a secret
 * from the environment; that one is exercised against two dozen real malformed
 * answers in `exam-status.test.ts`, and it can be, precisely because it does
 * neither of those things.
 */

export type { StatusSubject } from "./status-parse";

export interface StatusRefresh {
  report: StatusReport;
  sources: GenerateResult["sources"];
  grounded: boolean;
  model: string;
}

/**
 * Ask about one subject.
 *
 * Throws `GeminiError` when no key could answer at all — that is a failure the
 * caller must report and, in the route's case, apologise for having charged
 * quota for. Returns null when a call succeeded but its answer could not be
 * read, which is a different thing and gets a different sentence on screen.
 */
export async function fetchExamStatus(
  subject: StatusSubject,
  now: Date = new Date(),
): Promise<StatusRefresh | null> {
  const result = await generate({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(subject, now),
    // Low, not zero. Zero makes a grounded model likelier to repeat a source's
    // phrasing verbatim, including its dates, when the source is out of date.
    temperature: 0.2,
    // Thinking tokens are charged against this budget too, which is the part
    // that is easy to get wrong. Measured on a real grounded refresh: 1,736
    // thinking tokens and 970 of answer — so a 4,096 cap truncated the JSON
    // mid-object, the parser rejected it, and the call was spent for nothing.
    // The failure is silent unless you look: `finishReason: MAX_TOKENS`, which
    // is why `truncated` is carried out of the provider and into that log line.
    maxTokens: 8192,
  });

  const report = parseStatusReport(result.text, now);
  if (report === null) {
    console.warn(
      `[exam-status] unparseable answer for ${subject.key}` +
        (result.truncated ? " (truncated at the token limit)" : ""),
    );
    return null;
  }

  return {
    report,
    sources: result.sources,
    grounded: result.grounded,
    model: result.model,
  };
}
