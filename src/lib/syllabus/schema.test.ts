import { describe, expect, it } from "vitest";

import { parseSyllabus } from "./schema";

const section = {
  subject: "General Intelligence",
  section_title: "Reasoning",
  topics: ["Analogies", "Coding-decoding"],
  marks_weightage: "50 marks",
  marks: 50,
};

const tier1 = {
  stage_name: "Tier-1",
  exam_type: "CBT",
  total_marks: 200,
  duration_mins: 60,
  sections: [section],
};

const good = {
  exam_name: "SSC Combined Graduate Level Examination",
  year: 2026,
  stages: [tier1],
  grounding_sources: ["https://ssc.gov.in/notice"],
  confidence: 0.8,
};

describe("parseSyllabus", () => {
  it("reads a well-formed answer", () => {
    const result = parseSyllabus(JSON.stringify(good), "SSC CGL");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.syllabus.examName).toBe("SSC Combined Graduate Level Examination");
    expect(result.syllabus.year).toBe(2026);
    expect(result.syllabus.stages[0]?.sections[0]?.topics).toEqual([
      "Analogies",
      "Coding-decoding",
    ]);
    expect(result.syllabus.sources).toEqual(["https://ssc.gov.in/notice"]);
  });

  it("unwraps a fenced answer, which is the common case", () => {
    const fenced = "```json\n" + JSON.stringify(good) + "\n```";
    expect(parseSyllabus(fenced, "SSC CGL").kind).toBe("ok");
  });

  it("rescues an answer with a sentence in front of it", () => {
    const chatty = `Here is the syllabus you asked for:\n${JSON.stringify(good)}`;
    expect(parseSyllabus(chatty, "SSC CGL").kind).toBe("ok");
  });

  it("reports the model's own not-found separately from a bad answer", () => {
    const result = parseSyllabus('{"error": "Syllabus not found for this exam"}', "Nonsense");
    expect(result.kind).toBe("not-found");
    // The distinction is load-bearing: "no such exam" and "the model had an off
    // minute" are different sentences on screen.
    if (result.kind === "not-found") {
      expect(result.message).toContain("not found");
    }
  });

  it("rejects a confident, empty answer", () => {
    // This is the failure the old function cached for thirty days: valid JSON,
    // correct shape, no actual syllabus in it.
    const empty = { ...good, stages: [{ ...tier1, sections: [] }], syllabus: [] };
    const result = parseSyllabus(JSON.stringify(empty), "SSC CGL");
    expect(result.kind).toBe("unreadable");
  });

  it("rejects a section whose topics are prose rather than a list", () => {
    const prose = { ...good, stages: [], syllabus: "See the official notification" };
    expect(parseSyllabus(JSON.stringify(prose), "SSC CGL").kind).toBe("unreadable");
  });

  it("rebuilds stages from the flat array when only that arrived", () => {
    const flat = {
      exam_name: "IBPS PO",
      year: 2026,
      syllabus: [
        {
          stage_name: "Prelims",
          subject: "Quantitative Aptitude",
          section_title: null,
          topics: ["Simplification"],
          marks_weightage: "35 marks",
          marks: 35,
          exam_type: "MCQ",
          total_marks: 100,
          duration_mins: 60,
        },
        {
          stage_name: "Mains",
          subject: "Reasoning",
          section_title: null,
          topics: ["Puzzles"],
          marks_weightage: null,
          marks: null,
          exam_type: "MCQ",
          total_marks: 200,
          duration_mins: 180,
        },
      ],
      stages: [],
      grounding_sources: [],
      confidence: 0.6,
    };
    const result = parseSyllabus(JSON.stringify(flat), "IBPS PO");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.syllabus.stages.map((s) => s.name)).toEqual(["Prelims", "Mains"]);
  });

  it("coerces the numbers that arrive as strings, and drops the ones that are prose", () => {
    const mixed = {
      ...good,
      year: "2026",
      stages: [
        {
          ...tier1,
          total_marks: "200",
          duration_mins: "sixty minutes",
          sections: [{ ...section, marks: "50" }],
        },
      ],
    };
    const result = parseSyllabus(JSON.stringify(mixed), "SSC CGL");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.syllabus.year).toBe(2026);
    expect(result.syllabus.stages[0]?.totalMarks).toBe(200);
    // "sixty minutes" is not a number, and inventing one would be worse.
    expect(result.syllabus.stages[0]?.durationMins).toBeNull();
    expect(result.syllabus.stages[0]?.sections[0]?.marks).toBe(50);
  });

  it("normalises a 0-100 confidence onto 0-1", () => {
    const result = parseSyllabus(JSON.stringify({ ...good, confidence: 85 }), "SSC CGL");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.syllabus.confidence).toBeCloseTo(0.85);
  });

  it("drops sources that are not https", () => {
    const mixed = {
      ...good,
      grounding_sources: ["https://ssc.gov.in", "http://insecure.example", "not a url"],
    };
    const result = parseSyllabus(JSON.stringify(mixed), "SSC CGL");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.syllabus.sources).toEqual(["https://ssc.gov.in"]);
  });

  it("says so when there is no JSON at all", () => {
    expect(parseSyllabus("I could not find that exam, sorry.", "X").kind).toBe("unreadable");
    expect(parseSyllabus("", "X").kind).toBe("unreadable");
  });

  it("falls back to the searched name when the model omits one", () => {
    const nameless = { ...good, exam_name: null };
    const result = parseSyllabus(JSON.stringify(nameless), "SSC CGL");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.syllabus.examName).toBe("SSC CGL");
  });
});
