import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DOCUMENT_TYPES, OCR_FALLBACK_PROMPT, OCR_PROMPTS } from "./ocr";

/**
 * The OCR prompts are pinned, like the syllabus prompt, and for a sharper
 * reason: these ones decide what gets written into somebody's profile.
 *
 * Each prompt names the exact JSON keys its document type yields, and the
 * review screen maps those keys onto profile columns. Reword one and the model
 * starts returning `dob` where the mapping expects `date_of_birth` — the review
 * screen finds nothing, the upload appears to have failed, and no test goes red
 * unless it is this one.
 *
 * To re-pin: copy the actual hash from the failure into the table below, in the
 * same commit as the prompt edit.
 */
const PINNED: Record<string, string> = {
  identity_card: "c7eea66ac99131623dd1413197680696e6519d22ae83174143b284dbdb93eae2",
  marksheet: "bdec17bc8b98b7beaca9b0fb407f14a27c4ee1ee4d38c86c4661d43278baaf23",
  certificate: "d27d8c3a86c1952a5e491f8b6e0cc7676276736d0a955ea9d957cc474fc2b4a0",
  caste_certificate: "3b4c17a655c94eee600b5c0048961be4c8bf6cb5617a726f195c5ad91a0bb5b7",
  reservation_document: "bd6a082c9e5127ca7f92bf5772495e66c988cdf252cfbdcfef6256aeb300d620",
};

/**
 * The keys each prompt promises, and which profile column each maps to.
 *
 * Duplicated here on purpose. `document-fields.ts` holds the mapping the app
 * uses; this is an independent statement of the same contract, so a change to
 * one without the other fails rather than silently dropping a field.
 */
const PROMISED_KEYS: Record<string, string[]> = {
  identity_card: [
    "full_name",
    "father_name",
    "mother_name",
    "date_of_birth",
    "gender",
    "aadhar_number",
    "pan_number",
    "passport_number",
    "address",
  ],
  marksheet: [
    "full_name",
    "father_name",
    "mother_name",
    "date_of_birth",
    "roll_number",
    "institute_name",
    "board_university",
    "qualification_type",
    "qualification_name",
    "date_of_passing",
    "marks_obtained",
    "maximum_marks",
    "percentage",
    "cgpa",
  ],
  certificate: [
    "full_name",
    "father_name",
    "mother_name",
    "date_of_birth",
    "roll_number",
    "institute_name",
    "board_university",
    "qualification_type",
    "qualification_name",
    "date_of_passing",
  ],
  caste_certificate: [
    "full_name",
    "father_name",
    "category",
    "caste_name",
    "sub_category",
    "caste_certificate_number",
    "caste_issuing_authority",
    "caste_issue_date",
    "address",
  ],
  reservation_document: [
    "full_name",
    "father_name",
    "category",
    "ews_certificate_number",
    "ews_issuing_authority",
    "disability_type",
    "disability_certificate_number",
    "issue_date",
    "valid_until",
    "address",
  ],
};

describe("OCR prompts", () => {
  it("covers exactly the document types the app offers", () => {
    expect(Object.keys(OCR_PROMPTS).sort()).toEqual(DOCUMENT_TYPES.map((d) => d.value).sort());
  });

  it.each(Object.keys(PINNED))("%s has not changed without someone saying so", (kind) => {
    const prompt = OCR_PROMPTS[kind];
    expect(prompt, `no prompt for ${kind}`).toBeTypeOf("string");
    const actual = createHash("sha256")
      .update(prompt ?? "", "utf8")
      .digest("hex");
    expect(actual).toBe(PINNED[kind]);
  });

  it.each(Object.entries(PROMISED_KEYS))(
    "%s still asks for every key the review screen maps",
    (kind, keys) => {
      const prompt = OCR_PROMPTS[kind] ?? "";
      for (const key of keys) {
        expect(prompt, `${kind} no longer asks for ${key}`).toContain(`"${key}"`);
      }
    },
  );

  it("still tells every prompt to return JSON and nothing else", () => {
    for (const [kind, prompt] of Object.entries(OCR_PROMPTS)) {
      expect(prompt, `${kind} lost its JSON instruction`).toContain("Return ONLY JSON");
      // Without this the model invents a plausible value for a field it could
      // not read, and the review screen offers it as something to accept.
      expect(prompt, `${kind} lost its null instruction`).toContain("Use null");
    }
  });

  it("keeps a fallback for an undeclared document type", () => {
    expect(OCR_FALLBACK_PROMPT).toContain("Return ONLY JSON");
  });
});
