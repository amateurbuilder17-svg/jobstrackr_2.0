import { describe, expect, it } from "vitest";

import { EXAMS } from "./exams";
import { QUESTIONS } from "./questions";
import { meetsAge, meetsEducation, rankExams, scoreExam, type QuizAnswers } from "./score";

const exam = (id: string) => {
  const found = EXAMS.find((e) => e.id === id);
  if (!found) throw new Error(`fixture missing: ${id}`);
  return found;
};

/** A complete, ordinary set of answers. Individual tests vary one field. */
const graduate: QuizAnswers = {
  education: "graduate",
  age: "23",
  category: "general",
  location: "any",
  sectors: ["administration"],
  interests: ["gk"],
  salary: "25000",
  studyTime: "6",
  difficulty: "hard",
  language: "english",
};

describe("eligibility", () => {
  it("bars an exam the person is too young or too old for", () => {
    // NDA is 16.5–19.5, and this is the check that stops the quiz telling a
    // 23-year-old to prepare for it.
    expect(meetsAge(exam("nda"), { ...graduate, age: "23" })).toBe(false);
    expect(meetsAge(exam("nda"), { ...graduate, age: "17" })).toBe(true);
  });

  it("applies the category's own age ceiling", () => {
    // UPSC CSE: 32 general, 35 OBC, 37 SC/ST. A 33-year-old is out on general
    // and in on OBC, and getting this wrong in either direction is a year of
    // somebody's life.
    const cse = exam("upsc-cse");
    expect(meetsAge(cse, { ...graduate, age: "33", category: "general" })).toBe(false);
    expect(meetsAge(cse, { ...graduate, age: "33", category: "obc" })).toBe(true);
    expect(meetsAge(cse, { ...graduate, age: "33", category: "sc" })).toBe(true);
  });

  it("falls back to the general ceiling for an unknown category", () => {
    expect(meetsAge(exam("upsc-cse"), { ...graduate, age: "33", category: "nonsense" })).toBe(
      false,
    );
  });

  it("treats every bachelor's degree as satisfying a graduate requirement", () => {
    const cgl = exam("ssc-cgl");
    for (const education of ["btech", "bsc", "ba", "bcom", "llb", "graduate", "pg"]) {
      expect(meetsEducation(cgl, { ...graduate, education })).toBe(true);
    }
    expect(meetsEducation(cgl, { ...graduate, education: "12th" })).toBe(false);
  });

  it("does not let a higher degree substitute for a specific one", () => {
    // The ladder puts btech above 12th, but an engineering post needs
    // engineering — a B.Com graduate is not eligible however far up they sit.
    const ese = exam("upsc-ese");
    expect(meetsEducation(ese, { ...graduate, education: "btech" })).toBe(true);
    expect(meetsEducation(ese, { ...graduate, education: "bcom" })).toBe(false);
    expect(meetsEducation(ese, { ...graduate, education: "graduate" })).toBe(false);
  });

  it("refuses to score when education or age is missing", () => {
    expect(scoreExam(exam("ssc-cgl"), { ...graduate, education: undefined })).toBeNull();
    expect(scoreExam(exam("ssc-cgl"), { ...graduate, age: undefined })).toBeNull();
  });
});

describe("scoring", () => {
  it("returns null rather than a low score for an ineligible exam", () => {
    // The distinction is the safety of the whole feature: null disappears,
    // zero would render as a card saying "0% match" for an exam this person
    // cannot legally sit.
    expect(scoreExam(exam("nda"), { ...graduate, age: "33" })).toBeNull();
  });

  it("rewards a sector match more than an interest match", () => {
    const base = { ...graduate, sectors: [], interests: [] };
    const withSector = scoreExam(exam("ssc-cgl"), { ...base, sectors: ["administration"] });
    const withInterest = scoreExam(exam("ssc-cgl"), { ...base, interests: ["maths"] });
    expect(withSector?.score).toBeGreaterThan(withInterest?.score ?? 0);
  });

  it("never claims a perfect match", () => {
    // Ten questions is not enough to know, so 99 is the ceiling.
    const everything: QuizAnswers = {
      ...graduate,
      sectors: ["administration", "police", "foreign"],
      interests: ["gk", "polity", "history", "geography"],
      salary: "15000",
      difficulty: "hard",
      studyTime: "8",
    };
    for (const scored of rankExams([...EXAMS], everything)) {
      expect(scored.score).toBeLessThanOrEqual(99);
    }
  });

  it("explains itself", () => {
    const scored = scoreExam(exam("ssc-cgl"), graduate);
    expect(scored).not.toBeNull();
    // A bare number is a verdict; the reasons are what make it checkable.
    expect(scored?.reasons.length).toBeGreaterThan(0);
  });
});

describe("rankExams", () => {
  it("returns eligible exams, best first", () => {
    const ranked = rankExams([...EXAMS], graduate);
    expect(ranked.length).toBeGreaterThan(0);
    const scores = ranked.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("gives a 17-year-old school leaver a shorter list than a graduate", () => {
    const school = rankExams([...EXAMS], {
      ...graduate,
      education: "10th",
      age: "17",
    });
    const grad = rankExams([...EXAMS], graduate);
    expect(school.length).toBeLessThan(grad.length);
    // And nothing on it may require a degree.
    for (const { exam: e } of school) {
      expect(["10th", "12th"]).toContain(e.minEducation);
    }
  });

  it("can return nothing at all without throwing", () => {
    // An empty list is a real answer and the page has to render it. 100 is
    // past every ceiling including the deliberate 99s — see below.
    expect(rankExams([...EXAMS], { ...graduate, age: "100" })).toEqual([]);
  });

  it("still offers the exams that genuinely have no age limit", () => {
    // CTET is stored with maxAge 99 across every category, which is the
    // catalogue's way of writing "no upper limit" — and that is correct, CTET
    // has none. A 60-year-old graduate is eligible for it, and a scorer that
    // quietly capped everyone at retirement age would be wrong about a real
    // route into teaching.
    const late = rankExams([...EXAMS], { ...graduate, age: "60" });
    expect(late.map((r) => r.exam.id)).toContain("ctet");
  });
});

describe("the catalogue", () => {
  it("carries every exam the old app had", () => {
    expect(EXAMS.length).toBe(50);
  });

  it("has no duplicate ids", () => {
    expect(new Set(EXAMS.map((e) => e.id)).size).toBe(EXAMS.length);
  });

  it("gives every exam a general age ceiling to fall back on", () => {
    for (const e of EXAMS) {
      const general = e.maxAge.general;
      expect(general, `${e.id} has no general ceiling`).toBeTypeOf("number");
      expect(e.minAge).toBeLessThanOrEqual(general ?? 0);
    }
  });

  it("gives every exam a sane pay band", () => {
    for (const e of EXAMS) {
      expect(e.salaryRange[0], `${e.id} floor above ceiling`).toBeLessThanOrEqual(
        e.salaryRange[1],
      );
    }
  });

  it("asks ten questions, each with options", () => {
    expect(QUESTIONS.length).toBe(10);
    for (const q of QUESTIONS) {
      expect(q.options.length, `${q.id} has no options`).toBeGreaterThan(1);
    }
  });

  it("only names education levels the ladder knows", () => {
    const educationQuestion = QUESTIONS.find((q) => q.id === "education");
    const offered = new Set(educationQuestion?.options.map((o) => o.value));
    // Every level a person can pick must be comparable, or `meetsEducation`
    // silently returns -1 >= n and admits them to everything.
    for (const e of EXAMS) {
      const satisfiable = [...offered].some((education) =>
        meetsEducation(e, { ...graduate, education }),
      );
      expect(satisfiable, `${e.id} requires ${e.minEducation}, which nobody can pick`).toBe(
        true,
      );
    }
  });
});

describe("the score cap and the ordering", () => {
  it("shows a capped score but ranks on the real one", () => {
    // A generous set of answers puts a dozen exams past the ceiling. Every
    // card then reads "99% match", and sorting on that number leaves the top
    // of the list in catalogue order — which is not an order at all.
    const generous: QuizAnswers = {
      education: "graduate",
      age: "23",
      category: "general",
      location: "any",
      sectors: ["administration", "police", "banking", "railways"],
      interests: ["gk", "polity", "maths", "reasoning", "english"],
      salary: "15000",
      studyTime: "6",
      difficulty: "hard",
      language: "english",
    };

    const ranked = rankExams([...EXAMS], generous);
    const capped = ranked.filter((r) => r.score === 99);
    expect(capped.length, "expected several exams at the ceiling").toBeGreaterThan(3);

    // Displayed scores never exceed the ceiling...
    for (const r of ranked) expect(r.score).toBeLessThanOrEqual(99);
    // ...but the sequence is ordered by the uncapped total.
    const ranks = ranked.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    // And the tie really is broken: the first of the capped group outranks the
    // last of it, which sorting on `score` alone could not have arranged.
    const first = capped.at(0);
    const last = capped.at(-1);
    expect(first?.rank ?? 0).toBeGreaterThan(last?.rank ?? 0);
  });
});
