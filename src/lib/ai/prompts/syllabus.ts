/**
 * The syllabus prompts — one to search, one to structure.
 *
 * ## Why there are two
 *
 * There was one, carried across verbatim from the old project's
 * `supabase/functions/syllabus-search/index.ts`: a single grounded call that
 * asked for JSON in the system prompt and got JSON back. Measured against the
 * live API on ten calls across the six Popular Exams, it produced a syllabus
 * this app could read **twice**. The other eight were, in order of frequency:
 *
 *   - `finishReason: RECITATION` with zero text. A syllabus is a document, and
 *     asking a model to dump one verbatim into a JSON field is asking it to
 *     recite. Google's filter stops that, and it stops it *after* the quota
 *     claim has been spent.
 *   - The right data under the wrong key names — `selection_stages`,
 *     `subjects[].name`, `examName`, `latestSyllabusYear`, `preliminary_exam`
 *     as an object instead of a `stages` entry. The schema reads `stages` and
 *     `sections[].subject`, so a complete answer parsed to nothing.
 *   - No JSON at all: a well-written markdown briefing, headings and bullets,
 *     ignoring the contract entirely.
 *
 * None of that is fixable by asking harder in the same call, and the obvious
 * fix — `responseMimeType: "application/json"` — is refused by the API in the
 * same request as the search tool: *"Tool use with a response mime type:
 * 'application/json' is unsupported"*, a 400 before any work is done.
 *
 * So the call is split at exactly that seam. The grounded call is asked for the
 * thing it is reliably good at and cannot be filtered for reciting — prose, in
 * its own words. The structuring call is ungrounded, which is what makes
 * `responseSchema` legal, and it never touches the web: it only reshapes text
 * it was handed. On the same six exams, end to end, that produces a readable
 * syllabus on the first attempt for five, and on the second for the sixth.
 *
 * The old single prompt is gone rather than kept beside these. It cannot be
 * reached any more, and a prompt nothing calls is a prompt nobody updates.
 */

/**
 * Pass one: search, and write up what was found.
 *
 * Three instructions here are load-bearing and none of them are stylistic:
 *
 *   - **"in your own words" / "Paraphrase"** is the recitation fix. It is the
 *     difference between reproducing a notification and describing it, and
 *     Google's filter draws its line in the same place.
 *   - **"one per line"** is what keeps topics as topics. Without it the model
 *     writes "Reasoning covers analogies, series and coding-decoding", and the
 *     structuring pass has to guess where one topic ends and the next begins.
 *   - **"Do not use JSON, tables or code blocks"** keeps this pass out of the
 *     structuring pass's job. A half-JSON answer here is worse than prose,
 *     because it looks like something the parser should be able to read.
 *   - **the trailing "Sources:" list** is the only place a publisher's own URL
 *     can come from. Grounding hands back real pages but wraps every one in a
 *     `vertexaisearch.cloud.google.com/grounding-api-redirect/…` link, and the
 *     syllabus page prints its sources as visible text under the heading
 *     "Official Sources" — where a column of identical Google redirects tells
 *     a reader nothing about whether the syllabus came from ssc.gov.in. These
 *     URLs are pulled out of the prose by a regular expression, never by the
 *     ungrounded pass, so they are addresses this call actually visited.
 *
 * The not-found sentinel is a bare marker rather than the old `{"error": …}`
 * object, because there is no JSON in this pass to put it in. It is checked
 * before the second call, so an exam that does not exist costs one call
 * instead of two.
 */
export const SYLLABUS_SEARCH_PROMPT = `You are a research assistant for Indian government recruitment exams, with access to Google Search.

Search for the exam's CURRENT official syllabus and exam pattern. Prefer the conducting body's own website and its latest official notification over coaching sites.

Then write up what you found, in your own words, as plain notes. For every stage of the exam, cover:

- the stage's name, its mode (MCQ, descriptive, CBT), its total marks and its duration in minutes
- every subject or section in that stage, and under each one the individual topics, listed one per line
- the marks or weightage each subject carries

If the exam has more than one stage (Prelims and Mains, Tier 1 and Tier 2, Paper I and Paper II), describe ALL of them.

Paraphrase throughout — describe the syllabus rather than quoting the notification, and do not reproduce any document verbatim.

Do not use JSON, tables or code blocks; plain prose and bullet points only.

Finish with a line reading "Sources:" and then the official web addresses you used, one per line, each starting with https:// and pointing at the page itself rather than a search result.

If you cannot find an official syllabus for this exam, reply with exactly: NO OFFICIAL SYLLABUS FOUND`;

/**
 * What pass one says when it found nothing.
 *
 * Checked as a substring rather than an equality, because the model reliably
 * emits the marker and unreliably resists adding a sentence after it.
 */
export const SYLLABUS_NOT_FOUND_MARKER = "NO OFFICIAL SYLLABUS FOUND";

/**
 * Pass two: turn those notes into the shape the app stores.
 *
 * Short on purpose. The shape is carried by `SYLLABUS_RESPONSE_SCHEMA`, which
 * the API enforces rather than requests, so restating it here in prose would
 * only give the model a second, weaker description to disagree with.
 *
 * What is left is the part a schema cannot express: that this pass is a
 * translation and not a second opinion. "Use ONLY what the notes say" is what
 * stops it topping up a thin syllabus from its training data — which would be
 * the one failure worse than no answer, because the result is confident,
 * undated, and cached for thirty days.
 *
 * The cap on topics is a budget, not an editorial choice. SSC CGL's full
 * Tier 1 + Tier 2 syllabus overruns 16,384 output tokens, and a truncated
 * answer under `responseMimeType: "application/json"` is unparseable JSON —
 * the whole call lost, having been paid for. Forty topics per subject is well
 * past what any single subject in the measured corpus actually lists.
 */
export const SYLLABUS_STRUCTURE_PROMPT = `You convert notes about an Indian government exam syllabus into JSON.

Use ONLY what the notes below say. Do not add subjects or topics that are not in them, and do not drop any that are. If the notes do not give a value, leave it null rather than guessing it.

Every stage the notes describe becomes one entry in "stages", and every subject or section within a stage becomes one entry in that stage's "sections", with its topics listed individually.

List at most 40 topics per section, keeping the ones the notes give most prominence.

Set "confidence" to how well the notes support the result: near 1 when they are detailed and cite the conducting body, near 0 when they are vague or hedged.`;

/**
 * The shape, as the API enforces it.
 *
 * This is the half of the fix that the prompt cannot do. `responseSchema` is
 * not advice — the model is constrained to emit exactly these keys, which is
 * what ends the `selection_stages` / `subjects[].name` / `examName` drift that
 * made eight in ten answers unreadable while containing the right data.
 *
 * It deliberately mirrors `syllabusResponseSchema` in `lib/syllabus/schema.ts`
 * rather than replacing it. This one constrains what the model may say; that
 * one decides whether what it said is worth caching, and still runs on this
 * output. A schema the API enforces is not a schema this app has validated:
 * `stages: []` satisfies every line below, and it is the Zod pass that turns
 * an empty, well-formed answer into "unreadable" instead of a blank page.
 *
 * `grounding_sources` is absent on purpose. Pass two never saw the web, so any
 * URL it produced would be recalled rather than visited. The sources stored
 * with a syllabus are the pages Google reports pass one actually consulted.
 *
 * Typed as `Record<string, unknown>` because this is Google's own dialect —
 * uppercase OpenAPI type names, `nullable`, no `$schema` — and modelling it
 * properly would be inventing types for a shape only this file and one `fetch`
 * body ever see.
 */
export const SYLLABUS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    exam_name: {
      type: "STRING",
      description: "The official name of the exam, as the conducting body writes it.",
    },
    year: {
      type: "INTEGER",
      nullable: true,
      description: "The cycle this syllabus is for, if the notes state one.",
    },
    stages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          stage_name: {
            type: "STRING",
            description: "Prelims, Mains, Tier 1, Paper I, and so on.",
          },
          exam_type: {
            type: "STRING",
            nullable: true,
            description: "MCQ, Descriptive, CBT.",
          },
          total_marks: { type: "INTEGER", nullable: true },
          duration_mins: {
            type: "INTEGER",
            nullable: true,
            description: "Duration in minutes. Convert hours before answering.",
          },
          sections: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                subject: {
                  type: "STRING",
                  description: "Quantitative Aptitude, General Awareness, and so on.",
                },
                section_title: { type: "STRING", nullable: true },
                topics: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                  description: "One entry per topic. Never a single joined sentence.",
                },
                marks_weightage: {
                  type: "STRING",
                  nullable: true,
                  description: "As written, e.g. '50 marks' or '20%'.",
                },
                marks: { type: "INTEGER", nullable: true },
              },
              required: ["subject", "topics"],
            },
          },
        },
        required: ["stage_name", "sections"],
      },
    },
    confidence: { type: "NUMBER", description: "0 to 1." },
  },
  required: ["exam_name", "stages"],
};
