import { describe, expect, it } from "vitest";

import type { Syllabus } from "@/lib/syllabus/schema";

import { buildPrintSheet } from "./print-sheet";

function syllabus(over: Partial<Syllabus> = {}): Syllabus {
  return {
    examName: "SSC CGL",
    year: 2025,
    stages: [
      {
        name: "Tier-1",
        examType: "MCQ",
        totalMarks: 200,
        durationMins: 60,
        sections: [
          {
            subject: "General Awareness",
            sectionTitle: null,
            topics: ["History", "Polity"],
            marksWeightage: null,
            marks: 50,
          },
        ],
      },
    ],
    sources: ["https://ssc.gov.in/notice"],
    confidence: 0.9,
    ...over,
  };
}

describe("buildPrintSheet", () => {
  it("renders the exam, its stage stats and its topics", () => {
    const html = buildPrintSheet(syllabus());
    expect(html).toContain("<title>SSC CGL — Syllabus</title>");
    expect(html).toContain("General Awareness");
    expect(html).toContain("<li>History</li>");
    expect(html).toContain("50 Marks");
    expect(html).toContain('<a href="https://ssc.gov.in/notice">ssc.gov.in</a>');
  });

  it("escapes model-supplied text instead of executing it", () => {
    // The old app interpolated exam names, topics and URLs raw. This document
    // is written into a same-origin frame, so unescaped model output is script
    // execution — from text a model was talked into writing by a page it read.
    const html = buildPrintSheet(
      syllabus({
        examName: '<script>alert("x")</script>',
        stages: [
          {
            name: null,
            examType: null,
            totalMarks: null,
            durationMins: null,
            sections: [
              {
                subject: "<img src=x onerror=alert(1)>",
                sectionTitle: null,
                topics: ['"><script>alert(2)</script>'],
                marksWeightage: null,
                marks: null,
              },
            ],
          },
        ],
      }),
    );

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
  });

  it("drops a source that is not an http(s) URL", () => {
    const html = buildPrintSheet(
      syllabus({ sources: ["javascript:alert(1)", "https://ssc.gov.in/ok"] }),
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("ssc.gov.in");
  });

  it("falls back to the summed marks when no total was published", () => {
    const html = buildPrintSheet(
      syllabus({
        stages: [
          {
            name: "Tier-1",
            examType: null,
            totalMarks: null,
            durationMins: null,
            sections: [
              {
                subject: "A",
                sectionTitle: null,
                topics: ["x"],
                marksWeightage: null,
                marks: 25,
              },
              {
                subject: "B",
                sectionTitle: null,
                topics: ["y"],
                marksWeightage: null,
                marks: 75,
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('<span class="stat-value">100</span>');
  });
});
