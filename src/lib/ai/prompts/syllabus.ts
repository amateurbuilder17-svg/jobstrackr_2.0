/**
 * The syllabus prompt, carried across from the old project verbatim.
 *
 * `supabase/functions/syllabus-search/index.ts` in the Vite app. Not rewritten,
 * not "improved while I was in there" — this text is the behaviour, it was
 * tuned against real answers from real conducting bodies, and a reworded
 * version is a different feature that happens to look the same in a diff.
 *
 * `syllabus.prompt.test.ts` pins it byte for byte against the legacy file, so
 * a later edit here is a visible, deliberate change rather than a silent one.
 *
 * What is NOT carried across is the trust. The old function `JSON.parse`d this
 * and wrote the result straight to the cache; here it goes through a Zod schema
 * first, because a prompt that asks for a shape is a request, not a guarantee.
 */
export const SYLLABUS_PROMPT = `You are a government exam syllabus expert for India with access to Google Search.

Search for the OFFICIAL, LATEST syllabus for the specified exam. Return ONLY verified data from official sources (conducting body website, official notifications).

Return ONLY a valid JSON object (no markdown, no extra text):
{
  "exam_name": "Official exam name",
  "year": 2025,
  "syllabus": [
    {
      "subject": "Subject Name",
      "section_title": "Section or Paper name",
      "topics": ["Topic 1", "Topic 2", "Topic 3"],
      "marks_weightage": "e.g. 25 marks / 20%",
      "marks": 25,
      "stage_name": "Prelims/Mains/Tier-1 etc or null",
      "exam_type": "MCQ/Descriptive/CBT etc or null",
      "total_marks": 200,
      "duration_mins": 120
    }
  ],
  "stages": [
    {
      "stage_name": "Prelims/Tier-1/Paper-I etc",
      "exam_type": "MCQ/Descriptive/CBT",
      "total_marks": 200,
      "duration_mins": 120,
      "sections": [
        {
          "subject": "Subject Name",
          "section_title": "Section name",
          "topics": ["Topic 1", "Topic 2"],
          "marks_weightage": "25 marks",
          "marks": 25
        }
      ]
    }
  ],
  "grounding_sources": ["URL1", "URL2"],
  "confidence": 0.0 to 1.0
}

CRITICAL RULES:
- Use Google Search to find the CURRENT official syllabus
- If the exam has multiple stages (Prelims + Mains, Tier 1 + Tier 2), include ALL stages
- Include detailed topics for each subject/section
- grounding_sources must be real URLs you found the information from
- Return ONLY the JSON object, no other text
- If you cannot find verified syllabus data, return {"error": "Syllabus not found for this exam"}`;
