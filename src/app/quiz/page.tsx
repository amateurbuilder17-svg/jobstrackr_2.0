import type { Metadata } from "next";

import { QuizRunner } from "./quiz-runner";

export const metadata: Metadata = {
  title: "Which government job suits you?",
  description:
    "Ten questions, then every Indian government exam you are actually eligible for, ranked. No account, nothing saved, about two minutes.",
  alternates: { canonical: "/quiz" },
};

/**
 * The quiz.
 *
 * The old app served this as a standalone HTML file outside the router,
 * specifically so it stayed light and shareable. That instinct was right and
 * the mechanism was not: it meant a second Vite build, its own copy of React,
 * its own font, and a page that could not link into the app it advertised.
 *
 * Here it is an ordinary static route. It ships the catalogue — fifty exams of
 * eligibility data — and nothing else, and it links straight into the jobs list
 * and the syllabus finder from every result.
 */
export default function QuizPage() {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        Which government job suits you?
      </h1>
      <div className="mt-5">
        <QuizRunner />
      </div>
    </div>
  );
}
