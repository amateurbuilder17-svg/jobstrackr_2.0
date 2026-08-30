import { EDUCATION_ORDER, type QuizExam } from "./exams";

/**
 * Scoring the quiz.
 *
 * Carried across from the old project's `scoreExam` with its weights unchanged
 * — 13 points a sector, 7 an interest, 15 for matching the difficulty someone
 * asked for. Those numbers were tuned against real answers and there is no
 * basis for "improving" them here; changing one changes which exam fifty
 * thousand people are told to prepare for.
 *
 * What is new is that this is pure, exported and tested. In the old file it was
 * a closure in the middle of a 1,358-line component, which is why nothing ever
 * checked that a 17-year-old is refused UPSC.
 *
 * The two eligibility rules run before any scoring and return null rather than
 * zero, and that distinction is the whole safety of the feature: a null exam
 * does not appear at all. Telling somebody they are a 40% match for an exam
 * they are legally barred from is worse than not mentioning it.
 */

/**
 * A partially answered quiz.
 *
 * Every field is `| undefined` rather than merely optional, because the project
 * compiles with `exactOptionalPropertyTypes` and this genuinely is the shape:
 * the runner holds this object from the first question onwards, so an unanswered
 * field is present and undefined rather than absent. Spelling that out is what
 * makes the two guards below load-bearing instead of decorative.
 */
export interface QuizAnswers {
  education?: string | undefined;
  age?: string | undefined;
  category?: string | undefined;
  location?: string | undefined;
  sectors?: string[] | undefined;
  interests?: string[] | undefined;
  salary?: string | undefined;
  studyTime?: string | undefined;
  difficulty?: string | undefined;
  language?: string | undefined;
}

export interface ScoredExam {
  exam: QuizExam;
  /** What the card shows, capped at 99 exactly as the old app capped it. */
  score: number;
  /**
   * The uncapped total, used only for ordering.
   *
   * The cap is faithful to the original and is kept — a quiz that asks ten
   * questions should not claim to have found a perfect fit. But sorting on the
   * capped value throws away the information that breaks ties, and a generous
   * set of answers puts a dozen exams at 99: the first four results then arrive
   * in whatever order the catalogue happens to list them, which is not an
   * order at all.
   *
   * So the display keeps the ceiling and the sort sees through it. No score
   * shown to anybody changes; only the sequence, which becomes meaningful.
   */
  rank: number;
  /** Why it scored — shown on the card, so the number is not a bare verdict. */
  reasons: string[];
}

/**
 * Anything at or above the required level qualifies, with three exceptions the
 * ladder cannot express.
 *
 * A B.Tech is not "more" than an LLB, so a law post cannot be satisfied by an
 * engineering degree however far up the list it sits. The old code handled this
 * with three special cases before the index comparison, and they are kept
 * verbatim because each one is a real eligibility rule rather than a tidy-up.
 */
export function meetsEducation(exam: QuizExam, answers: QuizAnswers): boolean {
  const education = answers.education;
  if (!education) return false;

  const graduateGroup = ["btech", "bsc", "ba", "bcom", "llb", "graduate", "pg"];
  if (exam.minEducation === "graduate" && graduateGroup.includes(education)) return true;

  // A law post needs a law degree. No amount of other education substitutes.
  if (exam.minEducation === "llb") return education === "llb" || education === "pg";
  // Likewise an engineering post.
  if (exam.minEducation === "btech") return education === "btech" || education === "pg";

  const ladder: readonly string[] = EDUCATION_ORDER;
  return ladder.indexOf(education) >= ladder.indexOf(exam.minEducation);
}

/** The category's own ceiling, falling back to general when it has none. */
export function meetsAge(exam: QuizExam, answers: QuizAnswers): boolean {
  const age = Number.parseFloat(answers.age ?? "");
  if (!Number.isFinite(age)) return false;

  const category = answers.category ?? "general";
  const maxAge = exam.maxAge[category] ?? exam.maxAge.general;
  if (maxAge === undefined) return false;

  return age >= exam.minAge && age <= maxAge;
}

export function scoreExam(exam: QuizExam, answers: QuizAnswers): ScoredExam | null {
  if (!meetsEducation(exam, answers)) return null;
  if (!meetsAge(exam, answers)) return null;

  const reasons: string[] = [];
  let score = 50;

  if (exam.states.length === 0) {
    score += 8;
  } else if (answers.location === "home_state") {
    score += 14;
    reasons.push("Posted in your own state");
  }

  const sectorHits = (answers.sectors ?? []).filter((s) => exam.sectors.includes(s));
  score += sectorHits.length * 13;
  if (sectorHits.length > 0) {
    reasons.push(
      sectorHits.length === 1
        ? "Matches a sector you chose"
        : `Matches ${String(sectorHits.length)} sectors you chose`,
    );
  }

  const interestHits = (answers.interests ?? []).filter((i) => exam.interests.includes(i));
  score += interestHits.length * 7;
  if (interestHits.length > 0) {
    reasons.push(
      interestHits.length === 1
        ? "Tests a subject you are strong in"
        : `Tests ${String(interestHits.length)} subjects you are strong in`,
    );
  }

  const minSalary = Number.parseInt(answers.salary ?? "0", 10);
  if (exam.salaryRange[0] >= minSalary) {
    score += 10;
    reasons.push("Starting pay clears what you asked for");
  } else if (exam.salaryRange[1] >= minSalary) {
    score += 4;
    reasons.push("Reaches your pay expectation later in the scale");
  }

  if (exam.difficulty === answers.difficulty) {
    score += 15;
    reasons.push("Suits the timeline you picked");
  } else if (
    (answers.difficulty === "medium" && exam.difficulty === "easy") ||
    (answers.difficulty === "hard" && exam.difficulty === "medium")
  ) {
    score += 5;
  }

  const hours = Number.parseInt(answers.studyTime ?? "3", 10);
  if (exam.difficulty === "easy" && hours <= 3) score += 6;
  if (exam.difficulty === "hard" && hours >= 6) score += 6;

  if (answers.language === "any" || exam.languages.includes(answers.language ?? "")) {
    score += 5;
  } else {
    reasons.push(`Usually written in ${exam.languages.join(" or ")}`);
  }

  // Capped at 99 in the original, and kept: a quiz that answers ten questions
  // should never claim a perfect match, because it does not know enough to.
  // `rank` carries the real total for the sort — see the note on the field.
  return { exam, score: Math.min(score, 99), rank: score, reasons };
}

/** Every exam this person is eligible for, best first. */
export function rankExams(exams: QuizExam[], answers: QuizAnswers): ScoredExam[] {
  return exams
    .map((exam) => scoreExam(exam, answers))
    .filter((r): r is ScoredExam => r !== null)
    .sort((a, b) => b.rank - a.rank);
}
