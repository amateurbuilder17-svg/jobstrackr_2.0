import { describe, expect, it } from "vitest";

import type { Syllabus, SyllabusSection, SyllabusStage } from "@/lib/syllabus/schema";

import { attributedMarks, sectionIcon, sectionName, stageTotal, toPlainText } from "./present";

function section(over: Partial<SyllabusSection> = {}): SyllabusSection {
  return {
    subject: "General Awareness",
    sectionTitle: null,
    topics: ["History", "Polity"],
    marksWeightage: null,
    marks: 50,
    ...over,
  };
}

function stage(over: Partial<SyllabusStage> = {}): SyllabusStage {
  return {
    name: "Tier-1",
    examType: "MCQ",
    totalMarks: null,
    durationMins: 60,
    sections: [section()],
    ...over,
  };
}

describe("sectionName", () => {
  it("strips the stage prefix a model repeats inside its own stage", () => {
    // Real answers say "Tier-1 - General Awareness" for a section that is
    // already under the Tier-1 tab. Left alone, every card repeats the tab.
    const s = section({ subject: "Tier-1 - General Awareness" });
    expect(sectionName(s, stage())).toBe("General Awareness");
  });

  it("leaves a name that merely starts with the same word", () => {
    const s = section({ subject: "Tier-1 Reasoning" });
    expect(sectionName(s, stage())).toBe("Tier-1 Reasoning");
  });

  it("falls back to the section title, then to a placeholder", () => {
    expect(sectionName(section({ subject: null, sectionTitle: "Paper II" }), stage())).toBe(
      "Paper II",
    );
    expect(sectionName(section({ subject: null, sectionTitle: null }), stage())).toBe(
      "Section",
    );
  });

  it("does nothing when the stage is unnamed", () => {
    const unnamed = stage({ name: null });
    expect(sectionName(section({ subject: "General - Awareness" }), unnamed)).toBe(
      "General - Awareness",
    );
  });
});

describe("stageTotal", () => {
  it("prefers the declared total", () => {
    expect(stageTotal(stage({ totalMarks: 200 }))).toBe(200);
  });

  it("falls back to what the sections add up to", () => {
    const s = stage({ sections: [section({ marks: 50 }), section({ marks: 25 })] });
    expect(stageTotal(s)).toBe(75);
  });

  it("is null rather than 0 when nothing published marks at all", () => {
    // 0 would render as a confident "0 marks"; null renders as an em dash.
    const s = stage({ sections: [section({ marks: null })] });
    expect(stageTotal(s)).toBeNull();
    expect(attributedMarks(s)).toBe(0);
  });
});

describe("sectionIcon", () => {
  it("maps the subjects the old app mapped", () => {
    expect(sectionIcon("General Intelligence & Reasoning")).toBe("🧠");
    expect(sectionIcon("General Awareness")).toBe("🌍");
    expect(sectionIcon("Quantitative Aptitude")).toBe("🔢");
    expect(sectionIcon("English Comprehension")).toBe("📖");
    expect(sectionIcon("Computer Knowledge")).toBe("💻");
    expect(sectionIcon("Economics")).toBe("📊");
  });

  it("has a fallback, so a new subject is not a missing glyph", () => {
    expect(sectionIcon("Agricultural Engineering")).toBe("📚");
  });
});

describe("toPlainText", () => {
  const syllabus: Syllabus = {
    examName: "SSC CGL",
    year: 2025,
    stages: [
      stage({
        sections: [
          section({
            subject: "General Awareness",
            topics: ["a", "b", "c", "d", "e", "f", "g"],
            marks: 50,
          }),
        ],
      }),
    ],
    sources: [],
    confidence: 0.9,
  };

  it("caps the topic list, the way the old share summary did", () => {
    const text = toPlainText(syllabus);
    expect(text).toContain("SSC CGL (2025)");
    expect(text).toContain("General Awareness — 50 marks");
    expect(text).toContain("  • e");
    expect(text).not.toContain("  • f");
    expect(text).toContain("… and 2 more topics");
  });
});
