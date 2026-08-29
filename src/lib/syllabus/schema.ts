import { z } from "zod";

/**
 * What a syllabus answer has to be before it is allowed to become a page.
 *
 * The old function did `JSON.parse` and wrote the result straight into the
 * cache. That is the whole validation, and it is why this exists: the prompt
 * asks for a shape, and asking is not getting. A model that returns
 * `{"syllabus": "See the official notification"}` satisfies `JSON.parse`
 * perfectly, and the page then renders a string where a list of subjects
 * should be — or throws, at render, on a cached row that will keep throwing
 * for thirty days.
 *
 * Deliberately forgiving about *shape* and strict about *substance*:
 *
 *   - Numbers arrive as strings often enough that coercing is right rather than
 *     lax. `"25 marks"` is not a number and is rejected; `"25"` is.
 *   - Every optional field really is optional. A conducting body that has not
 *     published a duration is the normal case, and a schema that demands one
 *     turns a good answer into a parse failure.
 *   - An entry with no topics at all is not a syllabus. That check is the
 *     point of the file — it is what stops a confident, empty answer being
 *     cached and served for a month.
 */

/** `"25 marks"` is prose; `25` and `"25"` are numbers. Anything else is absent. */
const loose = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const trimmed = v.trim();
    if (trimmed === "") return null;
    // Strict: `Number("25 marks")` is NaN, which is what we want. The prompt
    // has a separate free-text field for "25 marks / 20%".
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  });

const text = z
  .string()
  .nullish()
  .transform((v) => {
    // Spelled out rather than `|| null`, which lints, or `?? null`, which is
    // wrong: an empty string is not a value here, and `??` would let "" through
    // as a subject name and render a heading with nothing in it.
    const trimmed = v?.trim();
    if (trimmed === undefined || trimmed === "") return null;
    return trimmed;
  });

const sectionSchema = z.object({
  subject: text,
  section_title: text,
  topics: z
    .array(z.string())
    .nullish()
    .transform((v) => (v ?? []).map((t) => t.trim()).filter(Boolean)),
  marks_weightage: text,
  marks: loose,
});

const stageSchema = z.object({
  stage_name: text,
  exam_type: text,
  total_marks: loose,
  duration_mins: loose,
  sections: z
    .array(sectionSchema)
    .nullish()
    .transform((v) => v ?? []),
});

/** A flat section, which the prompt also allows, carrying its stage inline. */
const flatSchema = sectionSchema.extend({
  stage_name: text,
  exam_type: text,
  total_marks: loose,
  duration_mins: loose,
});

export const syllabusResponseSchema = z.object({
  exam_name: text,
  year: loose,
  syllabus: z
    .array(flatSchema)
    .nullish()
    .transform((v) => v ?? []),
  stages: z
    .array(stageSchema)
    .nullish()
    .transform((v) => v ?? []),
  grounding_sources: z
    .array(z.string())
    .nullish()
    .transform((v) => (v ?? []).filter((u) => u.startsWith("https://"))),
  confidence: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => {
      const n = typeof v === "string" ? Number(v) : v;
      if (n === null || n === undefined || !Number.isFinite(n)) return null;
      // The prompt asks for 0–1. Some answers give 0–100 anyway; both are
      // meaningful and neither is worth discarding the whole syllabus over.
      return n > 1 ? Math.min(n / 100, 1) : Math.max(n, 0);
    }),
});

/** The model's own "I could not find this", which is a valid answer. */
export const syllabusNotFoundSchema = z.object({ error: z.string() });

/* ── The normalised shape the app renders ────────────────────────────────── */

export interface SyllabusSection {
  subject: string | null;
  sectionTitle: string | null;
  topics: string[];
  marksWeightage: string | null;
  marks: number | null;
}

export interface SyllabusStage {
  name: string | null;
  examType: string | null;
  totalMarks: number | null;
  durationMins: number | null;
  sections: SyllabusSection[];
}

export interface Syllabus {
  examName: string;
  year: number | null;
  stages: SyllabusStage[];
  sources: string[];
  confidence: number | null;
}

/**
 * The result of trying to read an answer.
 *
 * Three outcomes, and they are three because the page says something different
 * for each: a syllabus, an honest "no such exam", and "the model answered but
 * not usefully". Collapsing the last two would tell somebody their exam does
 * not exist because a model had an off minute.
 */
export type ParseResult =
  | { kind: "ok"; syllabus: Syllabus }
  | { kind: "not-found"; message: string }
  | { kind: "unreadable"; reason: string };

export function parseSyllabus(raw: string, fallbackName: string): ParseResult {
  const json = extractJson(raw);
  if (json === null) return { kind: "unreadable", reason: "no JSON object in the answer" };

  const notFound = syllabusNotFoundSchema.safeParse(json);
  if (notFound.success) return { kind: "not-found", message: notFound.data.error };

  const parsed = syllabusResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "unreadable", reason: parsed.error.issues[0]?.message ?? "shape mismatch" };
  }

  const stages = toStages(parsed.data);

  // A syllabus with no topics anywhere is not a syllabus. This is the check
  // that matters: everything above it is shape, and a confidently-worded empty
  // answer passes every shape check there is.
  const topicCount = stages.reduce(
    (sum, stage) => sum + stage.sections.reduce((n, s) => n + s.topics.length, 0),
    0,
  );
  if (topicCount === 0) return { kind: "unreadable", reason: "no topics in any section" };

  return {
    kind: "ok",
    syllabus: {
      examName: parsed.data.exam_name ?? fallbackName,
      year: parsed.data.year,
      stages,
      sources: parsed.data.grounding_sources,
      confidence: parsed.data.confidence,
    },
  };
}

/**
 * Both shapes the prompt allows, folded into one.
 *
 * The prompt asks for `stages` *and* a flat `syllabus` array, and real answers
 * supply one, the other, or both with the same content. Rendering whichever
 * happened to arrive would make the page's structure depend on the model's
 * mood; this picks `stages` when it has them and rebuilds them from the flat
 * list when it does not.
 */
function toStages(data: z.infer<typeof syllabusResponseSchema>): SyllabusStage[] {
  const fromStages = data.stages
    .map((stage) => ({
      name: stage.stage_name,
      examType: stage.exam_type,
      totalMarks: stage.total_marks,
      durationMins: stage.duration_mins,
      sections: stage.sections.map(toSection).filter((s) => s.topics.length > 0),
    }))
    .filter((stage) => stage.sections.length > 0);

  if (fromStages.length > 0) return fromStages;

  // Group the flat list by the stage each row names. A row with no stage joins
  // the unnamed group, which renders without a heading rather than under a
  // heading that says "null".
  const groups = new Map<string, SyllabusStage>();
  for (const row of data.syllabus) {
    const key = row.stage_name ?? "";
    let stage = groups.get(key);
    if (!stage) {
      stage = {
        name: row.stage_name,
        examType: row.exam_type,
        totalMarks: row.total_marks,
        durationMins: row.duration_mins,
        sections: [],
      };
      groups.set(key, stage);
    }
    const section = toSection(row);
    if (section.topics.length > 0) stage.sections.push(section);
  }

  return [...groups.values()].filter((stage) => stage.sections.length > 0);
}

function toSection(row: z.infer<typeof sectionSchema>): SyllabusSection {
  return {
    subject: row.subject,
    sectionTitle: row.section_title,
    topics: row.topics,
    marksWeightage: row.marks_weightage,
    marks: row.marks,
  };
}

/**
 * The JSON inside whatever the model actually sent.
 *
 * Carried across from the old function, which stripped ```json fences and then
 * fell back to the first `{`…`}` run. Both branches are kept because both fire
 * against a real model: the fence is the common case and the greedy match
 * rescues an answer with a sentence in front of it.
 */
function extractJson(raw: string): unknown {
  let text = raw.trim();

  if (text.startsWith("```json")) text = text.slice(7);
  else if (text.startsWith("```")) text = text.slice(3);
  if (text.endsWith("```")) text = text.slice(0, -3);

  try {
    return JSON.parse(text.trim());
  } catch {
    // Greedy on purpose: the object runs to the *last* brace, and a lazy match
    // stops at the first nested one and yields a truncated object.
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
