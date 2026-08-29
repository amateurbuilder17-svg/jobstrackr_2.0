/**
 * The five document-extraction prompts, carried across from the old project
 * verbatim.
 *
 * `supabase/functions/ocr-process/index.ts` in the Vite app. Each one names the
 * exact JSON keys its document type yields, and those keys are what the review
 * screen maps onto profile columns — so a reworded prompt is not a tidier
 * prompt, it is a different contract with the model and a review screen that
 * silently stops finding anything.
 *
 * `ocr.prompt.test.ts` pins every one of them by hash, and pins the key sets
 * against the columns they are mapped to.
 *
 * The document types are the old app's five, unchanged, because they are the
 * five things people actually photograph: an ID, a marksheet, a certificate, a
 * caste certificate, and an EWS/disability certificate.
 */

export const OCR_PROMPTS: Record<string, string> = {
  identity_card: `Extract from this Identity Card (Aadhaar/PAN/Passport):

If AADHAAR CARD:
- Full Name, Date of Birth (YYYY-MM-DD), Gender, Aadhaar Number (12 digits), Address

If PAN CARD:
- Full Name, Father's Name, Date of Birth (YYYY-MM-DD), PAN Number (10 chars)

If PASSPORT:
- Full Name, Date of Birth (YYYY-MM-DD), Gender, Passport Number, Father's Name, Mother's Name

Return ONLY JSON with applicable fields:
{
  "full_name": "",
  "father_name": "",
  "mother_name": "",
  "date_of_birth": "",
  "gender": "",
  "aadhar_number": "",
  "pan_number": "",
  "passport_number": "",
  "address": ""
}
Use null for fields not found.`,

  marksheet: `Extract from this Marksheet (any class/degree):
- Full Name, Father's Name, Mother's Name, Date of Birth (YYYY-MM-DD)
- Roll Number, Institute/School/College Name, Board/University Name
- Qualification Type (determine: 10th, 12th, graduation, post_graduation, diploma)
- Qualification Name (e.g., B.Tech, B.Sc, MBA, etc. if applicable)
- Date/Year of Passing (YYYY-MM-DD or YYYY-01-01)
- Marks Obtained, Maximum Marks, Percentage, CGPA

Return ONLY JSON:
{
  "full_name": "",
  "father_name": "",
  "mother_name": "",
  "date_of_birth": "",
  "roll_number": "",
  "institute_name": "",
  "board_university": "",
  "qualification_type": "",
  "qualification_name": "",
  "date_of_passing": "",
  "marks_obtained": null,
  "maximum_marks": null,
  "percentage": null,
  "cgpa": null
}
Use null for fields not found. qualification_type MUST be one of: 10th, 12th, graduation, post_graduation, diploma, other.`,

  certificate: `Extract from this Certificate (any class/degree):
- Full Name, Father's Name, Mother's Name, Date of Birth (YYYY-MM-DD)
- Roll Number, Institute/School/College Name, Board/University Name
- Qualification Type (determine: 10th, 12th, graduation, post_graduation, diploma)
- Qualification Name (e.g., B.Tech, B.Sc, MBA, etc. if applicable)
- Date/Year of Passing (YYYY-MM-DD or YYYY-01-01)

Return ONLY JSON:
{
  "full_name": "",
  "father_name": "",
  "mother_name": "",
  "date_of_birth": "",
  "roll_number": "",
  "institute_name": "",
  "board_university": "",
  "qualification_type": "",
  "qualification_name": "",
  "date_of_passing": ""
}
Use null for fields not found. qualification_type MUST be one of: 10th, 12th, graduation, post_graduation, diploma, other.`,

  caste_certificate: `Extract from this Caste Certificate:
- Full Name, Father's Name
- Category (SC/ST/OBC/EWS/General)
- Caste Name (specific caste/community)
- Sub-Caste (if mentioned separately)
- Certificate Number
- Issuing Authority
- Issue Date (YYYY-MM-DD)
- Valid Until (YYYY-MM-DD if mentioned)
- Address

Return ONLY JSON:
{
  "full_name": "",
  "father_name": "",
  "category": "",
  "caste_name": "",
  "sub_category": "",
  "caste_certificate_number": "",
  "caste_issuing_authority": "",
  "caste_issue_date": "",
  "address": ""
}
Use null for fields not found.`,

  reservation_document: `Extract from this Reservation/Eligibility Certificate (EWS/Disability/Other):
- Full Name, Father's Name
- Category (EWS/PwD/Ex-Serviceman/etc.)
- Certificate Number
- Issuing Authority
- Issue Date (YYYY-MM-DD)
- Valid Until (YYYY-MM-DD if mentioned)
- Disability Type & Percentage (if applicable)
- Address

Return ONLY JSON:
{
  "full_name": "",
  "father_name": "",
  "category": "",
  "ews_certificate_number": "",
  "ews_issuing_authority": "",
  "disability_type": "",
  "disability_certificate_number": "",
  "issue_date": "",
  "valid_until": "",
  "address": ""
}
Use null for fields not found.`,
};

/**
 * What to send for a document type nobody declared.
 *
 * Kept because the old function had it and because it is the honest fallback:
 * a vague ask that returns something reviewable beats refusing a document
 * somebody has already uploaded.
 */
export const OCR_FALLBACK_PROMPT = `Extract all personal information from this document. Return ONLY JSON with fields like: full_name, date_of_birth, gender, address, qualification_type, etc. Use null for missing fields.`;

export const DOCUMENT_TYPES = [
  { value: "identity_card", label: "Identity proof", hint: "Aadhaar, PAN or passport" },
  { value: "marksheet", label: "Marksheet", hint: "Any class or degree" },
  { value: "certificate", label: "Certificate", hint: "Passing or degree certificate" },
  { value: "caste_certificate", label: "Caste certificate", hint: "SC, ST, OBC" },
  {
    value: "reservation_document",
    label: "Other eligibility document",
    hint: "EWS, disability, ex-serviceman",
  },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"];
