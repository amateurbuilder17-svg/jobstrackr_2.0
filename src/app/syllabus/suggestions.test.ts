import { describe, expect, it } from "vitest";

import type { SyllabusDirectoryEntry } from "@/lib/db/queries/syllabus";

import { buildSuggestions } from "./suggestions";

function entry(over: Partial<SyllabusDirectoryEntry> = {}): SyllabusDirectoryEntry {
  return {
    slug: "ssc-cgl",
    examName: "SSC CGL",
    year: 2025,
    fetchedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildSuggestions", () => {
  it("puts a cached exam ahead of the popular tile for the same exam", () => {
    // The cached row opens instantly; the popular one spends a model call
    // rediscovering what is already in the table. Only one may survive.
    const rows = buildSuggestions([entry()], []);
    const cgl = rows.filter((r) => r.key === "ssc cgl");
    expect(cgl).toHaveLength(1);
    expect(cgl[0]?.href).toBe("/syllabus/ssc-cgl");
    expect(cgl[0]?.note).toBe("2025 · Saved");
  });

  it("still offers the popular exams that are not cached yet", () => {
    const rows = buildSuggestions([], []);
    expect(rows.every((r) => r.kind === "exam")).toBe(true);
    expect(rows.map((r) => r.name)).toContain("UPSC Civil Services");
  });

  it("de-duplicates spellings of one cached exam", () => {
    const rows = buildSuggestions(
      [
        entry({ slug: "ssc-cgl", examName: "SSC CGL 2025" }),
        entry({ slug: "ssc-cgl-b", examName: "SSC-CGL exam" }),
      ],
      [],
    );
    expect(rows.filter((r) => r.key === "ssc cgl")).toHaveLength(1);
  });

  it("caps how much of the directory reaches the browser", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      entry({ slug: `exam-${String(i)}`, examName: `Exam ${String(i)} Board` }),
    );
    const rows = buildSuggestions(many, []);
    // 60 from the directory, plus the six popular exams none of them shadow.
    expect(rows).toHaveLength(66);
  });

  it("omits the year from the note when none was published", () => {
    const rows = buildSuggestions([entry({ year: null })], []);
    expect(rows[0]?.note).toBe("Saved");
  });
});

describe("buildSuggestions · vacancies", () => {
  const job = (title: string, slug = "j-1") => ({ title, slug });

  it("adds open vacancies as a third kind, linking to the job", () => {
    const rows = buildSuggestions([], [job("BPSC Assistant Engineer 2026", "bpsc-ae-2026")]);
    const vacancy = rows.find((r) => r.kind === "job");
    expect(vacancy?.href).toBe("/jobs/bpsc-ae-2026");
    expect(vacancy?.note).toBe("Vacancy");
  });

  it("drops a vacancy for an exam already covered above it", () => {
    // Two rows with the same words going to different places is the failure
    // this prevents: the cached syllabus wins, the job title is not repeated.
    const rows = buildSuggestions([entry()], [job("SSC CGL 2025", "ssc-cgl-2025")]);
    expect(rows.filter((r) => r.key === "ssc cgl")).toHaveLength(1);
    expect(rows.find((r) => r.key === "ssc cgl")?.kind).toBe("cached");
  });

  it("does not repeat a popular exam as a vacancy either", () => {
    const rows = buildSuggestions([], [job("UPSC Civil Services 2026", "upsc-cse-2026")]);
    expect(rows.filter((r) => r.key === "upsc civil services")).toHaveLength(1);
    expect(rows.find((r) => r.key === "upsc civil services")?.kind).toBe("exam");
  });

  it("collapses the same exam across years to its most recent row", () => {
    // The query orders by recency, so the first one through wins.
    const rows = buildSuggestions(
      [],
      [job("RRB Group D 2026", "rrb-gd-2026"), job("RRB Group D 2024", "rrb-gd-2024")],
    );
    const hits = rows.filter((r) => r.key === "rrb group d");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.href).toBe("/jobs/rrb-gd-2026");
  });

  it("caps the vacancies that reach the browser", () => {
    // 250, chosen against a measured gzip curve — see the constant's comment.
    const many = Array.from({ length: 900 }, (_, i) =>
      job(`Board ${String(i)} Recruitment Officer`, `job-${String(i)}`),
    );
    expect(buildSuggestions([], many).filter((r) => r.kind === "job")).toHaveLength(250);
  });

  it("skips a title that normalises to nothing searchable", () => {
    const rows = buildSuggestions([], [job("2025", "bare-year"), job("--", "punctuation")]);
    expect(rows.filter((r) => r.kind === "job")).toHaveLength(0);
  });
});
