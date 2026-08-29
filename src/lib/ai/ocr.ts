import "server-only";

import { generate } from "./gemini";
import { OCR_FALLBACK_PROMPT, OCR_PROMPTS } from "./prompts/ocr";

/**
 * Reading a photographed document.
 *
 * The thin half, like `exam-status.ts` and `syllabus.ts`: pick the prompt for
 * the document type, make one ungrounded vision call, hand the answer to a
 * parser that has never touched a network. What the answer is allowed to *mean*
 * lives in `lib/documents/fields.ts`, which is pure and tested against the
 * shapes a photograph of a marksheet actually produces.
 *
 * `grounded: false`, deliberately. Reading a certificate is not a question
 * about the world — there is nothing to search for, the answer is in the image,
 * and a search tool on the request would spend the grounding quota to no
 * purpose. It also removes any route by which something written on the document
 * could steer the model toward the web.
 */

const SYSTEM = "You are an expert at reading Indian identity and education documents.";

export interface OcrResult {
  /** Whatever JSON came back, unvalidated. `fields.ts` decides what it means. */
  raw: unknown;
  model: string;
}

export async function readDocument(params: {
  documentType: string;
  mimeType: string;
  /** base64, without a data: prefix. */
  data: string;
}): Promise<OcrResult | null> {
  const prompt = OCR_PROMPTS[params.documentType] ?? OCR_FALLBACK_PROMPT;

  const result = await generate({
    system: SYSTEM,
    prompt,
    image: { mimeType: params.mimeType, data: params.data },
    grounded: false,
    // Zero would be wrong for the same reason it is wrong in exam-status: a
    // model at zero copies more literally, including a misread character it is
    // confident about. Low, not none.
    temperature: 0.1,
    maxTokens: 4096,
  });

  const raw = extractJson(result.text);
  if (raw === null) return null;

  return { raw, model: result.model };
}

/**
 * The JSON inside whatever came back.
 *
 * The same two-branch recovery the syllabus parser uses, and for the same
 * reason: the fence is the common case, and the greedy brace match rescues an
 * answer with a sentence in front of it. Duplicated rather than shared because
 * the two live in different modules with different callers, and a shared
 * "extract some JSON" helper is the kind of thing that grows a flag.
 */
function extractJson(raw: string): unknown {
  let text = raw.trim();

  if (text.startsWith("```json")) text = text.slice(7);
  else if (text.startsWith("```")) text = text.slice(3);
  if (text.endsWith("```")) text = text.slice(0, -3);

  try {
    return JSON.parse(text.trim());
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
