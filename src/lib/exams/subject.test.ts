import { describe, expect, it } from "vitest";

import { normalizeSubjectName, subjectColumnsFor, subjectKeyFor } from "./subject";

const EXAM = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

describe("subjectKeyFor", () => {
  it("prefers the exam, because that is what other people's rows key on", () => {
    expect(subjectKeyFor({ exam_id: EXAM, job_id: JOB, custom_name: "SSC CGL" })).toBe(
      `exam:${EXAM}`,
    );
  });

  it("falls back to the job for a row created by pressing Track", () => {
    expect(subjectKeyFor({ exam_id: null, job_id: JOB, custom_name: null })).toBe(`job:${JOB}`);
  });

  it("keys free text by its normalised form, so two spellings share an answer", () => {
    const a = subjectKeyFor({ exam_id: null, job_id: null, custom_name: "SSC CGL 2026" });
    const b = subjectKeyFor({ exam_id: null, job_id: null, custom_name: "ssc-cgl,  2026 " });
    expect(a).toBe("name:ssc-cgl-2026");
    expect(b).toBe(a);
  });

  it("returns null rather than the key 'name:' the table would refuse", () => {
    expect(subjectKeyFor({ exam_id: null, job_id: null, custom_name: "  ---  " })).toBeNull();
    expect(subjectKeyFor({ exam_id: null, job_id: null, custom_name: null })).toBeNull();
  });

  /**
   * The key goes into a column with a CHECK constraint on its shape. A key this
   * function can produce but the table will not accept is a 3am failure, so the
   * pattern is asserted here rather than discovered there.
   */
  it("only ever produces keys the CHECK constraint accepts", () => {
    const pattern = /^(exam:[0-9a-f-]{36}|job:[0-9a-f-]{36}|name:[a-z0-9-]{1,120})$/;

    const keys = [
      subjectKeyFor({ exam_id: EXAM, job_id: null, custom_name: null }),
      subjectKeyFor({ exam_id: null, job_id: JOB, custom_name: null }),
      subjectKeyFor({
        exam_id: null,
        job_id: null,
        custom_name: "UPSC Civil Services (Prelims)",
      }),
      subjectKeyFor({ exam_id: null, job_id: null, custom_name: "x".repeat(400) }),
    ];

    for (const key of keys) {
      expect(key).not.toBeNull();
      expect(key).toMatch(pattern);
    }
  });
});

describe("normalizeSubjectName", () => {
  it("strips accents and punctuation", () => {
    expect(normalizeSubjectName("Écoles — Tier·1")).toBe("ecoles-tier-1");
  });

  it("leaves no trailing hyphen after truncation", () => {
    const long = `${"a".repeat(119)} b`;
    const key = normalizeSubjectName(long);
    expect(key.length).toBeLessThanOrEqual(120);
    expect(key.endsWith("-")).toBe(false);
  });
});

describe("subjectColumnsFor", () => {
  it("sets exactly one id, matching the one_subject constraint", () => {
    expect(subjectColumnsFor({ exam_id: EXAM, job_id: JOB, custom_name: null })).toEqual({
      exam_id: EXAM,
      job_id: null,
    });
    expect(subjectColumnsFor({ exam_id: null, job_id: JOB, custom_name: null })).toEqual({
      exam_id: null,
      job_id: JOB,
    });
    expect(subjectColumnsFor({ exam_id: null, job_id: null, custom_name: "x" })).toEqual({
      exam_id: null,
      job_id: null,
    });
  });
});
