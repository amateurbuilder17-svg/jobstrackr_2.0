import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import {
  examDateOf,
  hasSecondPhase,
  phaseOf,
  resultDateOf,
  type ExamStatusReport,
} from "@/lib/exams/report";
import type { AttemptStatus } from "@/lib/tracker/enums";

export interface Stage {
  key: string;
  label: string;
  shortLabel: string;
  state: "completed" | "current" | "upcoming";
  detail?: string | null;
  link?: string | null;
}

type AttemptStageInfo = Pick<ExamAttempt, "stage" | "applied_at" | "exam_date" | "result_date">;

function shortenLabel(label: string): string {
  const l = label.trim();
  const lower = l.toLowerCase();
  if (lower.includes("prelim")) return "Prelims";
  if (lower.includes("main")) return "Mains";
  if (lower.includes("tier 1") || lower.includes("tier i")) return "Tier 1";
  if (lower.includes("tier 2") || lower.includes("tier ii")) return "Tier 2";
  if (lower.includes("tier 3") || lower.includes("tier iii")) return "Tier 3";
  if (lower.includes("written")) return "Exam";
  if (lower.includes("cbt") || lower.includes("computer based")) return "CBT";
  if (lower.includes("interview") || lower.includes("personality")) return "Interview";
  if (lower.includes("physical") || lower.includes("pet") || lower.includes("pst"))
    return "Physical";
  if (lower.includes("skill") || lower.includes("typing") || lower.includes("trade"))
    return "Skill Test";
  if (l.length > 8) return l.slice(0, 8);
  return l;
}

/**
 * Does the user's `attempt.stage` text indicate they are at Phase 2?
 *
 * This is the single source of truth for "which phase is the user in" across
 * `computeStages` and `computeNextEvent`. Without it, the code defaults to
 * Phase 1 data for everything, which is wrong for two-phase exams once the
 * user has moved past Prelims.
 */
export function isStage2(stage: string | null | undefined): boolean {
  const s = (stage ?? "").toLowerCase();
  return (
    s.includes("main") ||
    s.includes("tier 2") ||
    s.includes("tier ii") ||
    s.includes("tier-2") ||
    s.includes("mains") ||
    s.includes("phase 2") ||
    s.includes("stage 2")
  );
}

export function computeStages(
  status: AttemptStatus,
  attempt?: AttemptStageInfo | null,
  report?: ExamStatusReport | null,
): Stage[] {
  const rep = report?.report;
  const twoPhases = rep ? hasSecondPhase(rep) : true;
  const phase1 = rep ? phaseOf(rep, 1) : null;
  const phase2 = rep ? phaseOf(rep, 2) : null;

  const phase1Name = phase1?.name ?? attempt?.stage ?? "Prelims Exam";
  const phase2Name = phase2?.name ?? "Mains / Tier 2";

  // Build stage templates based on whether the exam has 1 or 2 examination phases
  interface StageTemplate {
    key: string;
    label: string;
    shortLabel: string;
    detail?: string | null;
    link?: string | null;
  }

  const applyDetail = attempt?.applied_at
    ? `Applied ${formatDate(attempt.applied_at) ?? ""}`
    : status === "applied"
      ? "Application submitted"
      : null;

  // Determine which phase the user is currently in
  const userAtPhase2 = twoPhases && isStage2(attempt?.stage);

  // Admit card: show the currently relevant phase's admit card status
  const activePhaseForAdmit = userAtPhase2 ? phase2 : phase1;
  const admitDetail = activePhaseForAdmit?.admitCardAvailable
    ? "Out now"
    : status === "admit_card"
      ? "Available"
      : null;

  // Phase 1 exam date: use attempt.exam_date only if the user is at Phase 1
  // (or stage is unset). Use examDateOf for event fallback.
  const phase1ExamDate =
    (!userAtPhase2 ? attempt?.exam_date : null) ??
    (rep ? examDateOf(rep, 1) : null) ??
    phase1?.examDate ??
    null;
  const phase1Detail = phase1ExamDate ? formatDate(phase1ExamDate) : null;

  // Phase 2 exam date: use attempt.exam_date only if the user IS at Phase 2.
  // Use examDateOf for event fallback.
  const phase2ExamDate =
    (userAtPhase2 ? attempt?.exam_date : null) ??
    (rep ? examDateOf(rep, 2) : null) ??
    phase2?.examDate ??
    null;
  const phase2Detail = phase2ExamDate ? formatDate(phase2ExamDate) : null;

  // For 2-phase exams, "Final Result" means Phase 2's result.
  // For 1-phase exams, it means Phase 1's result.
  const finalPhase = twoPhases ? phase2 : phase1;
  const finalPhaseNum: 1 | 2 = twoPhases ? 2 : 1;
  const finalResultDate =
    (rep ? resultDateOf(rep, finalPhaseNum) : null) ?? finalPhase?.resultDate ?? null;
  const finalResultDetail =
    finalPhase?.resultAvailable ||
    (status === "passed" && !isStage2(attempt?.stage) && !twoPhases) ||
    (status === "passed" && twoPhases && isStage2(attempt?.stage))
      ? "Declared"
      : finalResultDate
        ? formatDate(finalResultDate)
        : null;

  // Phase 1 result info — shown on the Phase 1 stage card for 2-phase exams
  const phase1ResultDate = (rep ? resultDateOf(rep, 1) : null) ?? phase1?.resultDate ?? null;
  const phase1ResultDetail =
    phase1?.resultAvailable || (status === "passed" && !isStage2(attempt?.stage) && twoPhases)
      ? "Result declared"
      : phase1ResultDate
        ? `Result: ${formatDate(phase1ResultDate) ?? ""}`
        : null;

  let templates: StageTemplate[];

  if (twoPhases) {
    templates = [
      {
        key: "apply",
        label: "Application",
        shortLabel: "Apply",
        detail: applyDetail,
      },
      {
        key: "admit",
        label: "Admit Card",
        shortLabel: "Admit",
        detail: admitDetail,
        link: activePhaseForAdmit?.admitCardLink ?? null,
      },
      {
        key: "phase1",
        label: phase1Name,
        shortLabel: shortenLabel(phase1Name),
        detail: phase1Detail ?? phase1ResultDetail,
        link: phase1?.resultLink ?? null,
      },
      {
        key: "phase2",
        label: phase2Name,
        shortLabel: shortenLabel(phase2Name),
        detail: phase2Detail,
      },
      {
        key: "result",
        label: "Final Result",
        shortLabel: "Result",
        detail: finalResultDetail,
        link: phase2?.resultLink ?? null,
      },
    ];
  } else {
    templates = [
      {
        key: "apply",
        label: "Application",
        shortLabel: "Apply",
        detail: applyDetail,
      },
      {
        key: "admit",
        label: "Admit Card",
        shortLabel: "Admit",
        detail: admitDetail,
        link: phase1?.admitCardLink ?? null,
      },
      {
        key: "exam",
        label: phase1Name || "Written Exam",
        shortLabel: shortenLabel(phase1Name || "Exam"),
        detail: phase1Detail,
      },
      {
        key: "result",
        label: "Final Result",
        shortLabel: "Result",
        detail: finalResultDetail,
        link: phase1?.resultLink ?? null,
      },
    ];
  }

  // ── Active index ────────────────────────────────────────────────────
  // 2-phase indices: 0=Apply, 1=Admit, 2=Phase1, 3=Phase2, 4=Result
  // 1-phase indices: 0=Apply, 1=Admit, 2=Exam,   3=Result

  // 1. Compute index from the user's manual status
  let userIndex = 0;
  if (status === "tracking") {
    userIndex = attempt?.applied_at ? 1 : 0;
  } else if (status === "applied") {
    userIndex = 1;
  } else if (status === "admit_card") {
    userIndex = 2;
  } else if (status === "appeared") {
    if (twoPhases) {
      userIndex = userAtPhase2 ? 4 : 2;
    } else {
      userIndex = templates.length - 1;
    }
  } else if (status === "passed") {
    if (twoPhases && !userAtPhase2) {
      userIndex = 3;
    } else {
      userIndex = templates.length;
    }
  } else {
    // failed or withdrawn
    userIndex = templates.length;
  }

  // 2. Compute index from the report's phase statuses so the bar
  //    reflects reality even if the user hasn't updated their status.
  let reportIndex = 0;
  if (rep) {
    const p1Status = phase1?.status;
    const p2Status = phase2?.status;

    if (twoPhases) {
      // Check Phase 2 first (further along)
      if (p2Status === "result_declared" || phase2?.resultAvailable) {
        reportIndex = 5; // past everything
      } else if (p2Status === "exam_completed") {
        reportIndex = 4; // waiting for final result
      } else if (
        p2Status === "admit_card_available" ||
        p2Status === "exam_scheduled" ||
        phase2?.admitCardAvailable
      ) {
        reportIndex = 3; // at phase 2
      } else if (p1Status === "result_declared" || phase1?.resultAvailable) {
        reportIndex = 3; // prelims done, at phase 2
      } else if (p1Status === "exam_completed") {
        reportIndex = 2; // prelims done, waiting result
      } else if (
        p1Status === "admit_card_available" ||
        p1Status === "exam_scheduled" ||
        phase1?.admitCardAvailable
      ) {
        reportIndex = 2; // at prelims
      } else if (rep.stage === "registration_closed" || rep.stage === "exam_scheduled") {
        reportIndex = 1;
      }
    } else {
      if (p1Status === "result_declared" || phase1?.resultAvailable) {
        reportIndex = templates.length; // all done
      } else if (p1Status === "exam_completed") {
        reportIndex = templates.length - 1; // waiting for result
      } else if (
        p1Status === "admit_card_available" ||
        p1Status === "exam_scheduled" ||
        phase1?.admitCardAvailable
      ) {
        reportIndex = 2;
      } else if (rep.stage === "registration_closed" || rep.stage === "exam_scheduled") {
        reportIndex = 1;
      }
    }
  }

  // Take the max: the bar reflects whichever is further along
  const activeIndex = Math.max(userIndex, reportIndex);

  return templates.map((stage, idx) => {
    let state: Stage["state"] = "upcoming";
    if (idx < activeIndex) {
      state = "completed";
    } else if (idx === activeIndex) {
      state =
        activeIndex >= templates.length || status === "failed" || status === "withdrawn"
          ? "completed"
          : "current";
    } else {
      state = "upcoming";
    }
    return {
      ...stage,
      state,
    };
  });
}

export function ExamProgress({ stages, className }: { stages: Stage[]; className?: string }) {
  return (
    <ol className={cn("flex w-full items-start gap-0", className)} aria-label="Exam progress">
      {stages.map((stage, i) => (
        <li
          key={stage.key}
          className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
        >
          <div className="flex w-full items-center">
            <span
              className={cn(
                "h-px flex-1",
                i === 0
                  ? "bg-transparent"
                  : stage.state === "upcoming"
                    ? "bg-border"
                    : "bg-brand/35",
              )}
            />
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                stage.state === "completed" && "border-brand bg-brand text-primary-foreground",
                stage.state === "current" &&
                  "border-brand bg-brand-soft ring-2 ring-brand/20 text-brand",
                stage.state === "upcoming" && "border-border bg-card",
              )}
            >
              {stage.state === "completed" ? (
                <CheckIcon className="size-3 stroke-[2.5]" aria-hidden="true" />
              ) : stage.state === "current" ? (
                <span className="size-1.5 rounded-full bg-brand" />
              ) : null}
            </span>
            <span
              className={cn(
                "h-px flex-1",
                i === stages.length - 1
                  ? "bg-transparent"
                  : stages[i + 1]?.state === "upcoming"
                    ? "bg-border"
                    : "bg-brand/35",
              )}
            />
          </div>
          <span
            className={cn(
              "w-full truncate text-[10.5px] leading-tight tracking-tight px-0.5",
              stage.state === "current"
                ? "font-bold text-brand-deep"
                : stage.state === "completed"
                  ? "font-medium text-muted-foreground"
                  : "text-muted-foreground/70",
            )}
          >
            {stage.shortLabel}
          </span>
          <span className="sr-only">
            {stage.state === "completed"
              ? "completed"
              : stage.state === "current"
                ? "current stage"
                : "upcoming"}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface NextEventInfo {
  title: string;
  date: string;
  subtitle?: string | null;
  link?: { href: string; label: string } | null;
  tone?: "accent" | "good" | "warn" | "neutral";
}

/** Format days-until as a short countdown string. */
export function formatCountdown(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "Today";
  if (days > 0) return `In ${String(days)} days`;
  const abs = Math.abs(days);
  return `${String(abs)} ${abs === 1 ? "day" : "days"} ago`;
}

export function computeNextEvent(
  status: AttemptStatus,
  attempt: ExamAttempt,
  report: ExamStatusReport | null,
  today: string | null,
): NextEventInfo | null {
  if (status === "failed" || status === "withdrawn") {
    return null;
  }

  const rep = report?.report;
  const twoPhases = rep ? hasSecondPhase(rep) : false;
  const userAtP2 = twoPhases && isStage2(attempt.stage);

  const phase1 = rep ? phaseOf(rep, 1) : null;
  const phase2 = rep ? phaseOf(rep, 2) : null;

  const p1Name = shortenLabel(phase1?.name ?? "Prelims");
  const p2Name = shortenLabel(phase2?.name ?? "Mains");

  // Dates for Phase 1
  const p1ExamDate =
    (!userAtP2 ? attempt.exam_date : null) ??
    (rep ? examDateOf(rep, 1) : null) ??
    phase1?.examDate ??
    null;
  const p1ResultDate =
    (!userAtP2 ? attempt.result_date : null) ??
    (rep ? resultDateOf(rep, 1) : null) ??
    phase1?.resultDate ??
    null;

  // Dates for Phase 2
  const p2ExamDate =
    (userAtP2 ? attempt.exam_date : null) ??
    (rep ? examDateOf(rep, 2) : null) ??
    phase2?.examDate ??
    null;
  const p2ResultDate =
    (userAtP2 ? attempt.result_date : null) ??
    (rep ? resultDateOf(rep, 2) : null) ??
    phase2?.resultDate ??
    null;

  // Timing relative to today
  const p1ExamDays = today && p1ExamDate ? daysUntilFrom(today, p1ExamDate) : null;
  const p1ResultDays = today && p1ResultDate ? daysUntilFrom(today, p1ResultDate) : null;
  const p2ExamDays = today && p2ExamDate ? daysUntilFrom(today, p2ExamDate) : null;
  const p2ResultDays = today && p2ResultDate ? daysUntilFrom(today, p2ResultDate) : null;

  // Determine if Phase 1 is done / resolved
  const p1ResultPast = p1ResultDays !== null && p1ResultDays < 0;
  const p1Done =
    userAtP2 ||
    status === "passed" ||
    phase1?.resultAvailable === true ||
    phase1?.status === "result_declared" ||
    p1ResultPast ||
    (twoPhases &&
      (phase2?.status === "admit_card_available" ||
        phase2?.status === "exam_scheduled" ||
        phase2?.status === "exam_completed" ||
        phase2?.status === "result_declared" ||
        phase2?.admitCardAvailable === true));

  // ──────────────────────────────────────────────────────────────────────────
  // CASE A: User has passed all phases OR single-phase is passed
  // ──────────────────────────────────────────────────────────────────────────
  if (status === "passed" && (!twoPhases || userAtP2 || phase2?.status === "result_declared")) {
    return {
      title: "Selection & Verification",
      date: "Completed · Qualified",
      subtitle: "Prepare for document verification and appointment formalities",
      tone: "good",
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE B: Evaluate Phase 2 (Mains) when Phase 1 is completed on 2-phase exam
  // ──────────────────────────────────────────────────────────────────────────
  if (twoPhases && p1Done) {
    // 1. Phase 2 result is already out
    if (phase2?.resultAvailable) {
      return {
        title: "Final Result Declared",
        date: "Available now",
        subtitle: "Check your official scorecard",
        link: phase2.resultLink ? { href: phase2.resultLink, label: "Check Result" } : null,
        tone: "good",
      };
    }

    // 2. Phase 2 exam is in the past -> awaiting Mains result
    const p2ExamPast =
      (p2ExamDays !== null && p2ExamDays < 0) || phase2?.status === "exam_completed";
    if (p2ExamPast || (userAtP2 && status === "appeared")) {
      const countdown = formatCountdown(p2ResultDays);
      return {
        title: `${p2Name} Result Declaration`,
        date:
          [formatDate(p2ResultDate), countdown].filter(Boolean).join(" · ") || "Expected soon",
        subtitle: `${p2Name} exam completed · Awaiting result`,
        tone: "accent",
      };
    }

    // 3. Phase 2 admit card is available
    if (phase2?.admitCardAvailable || (userAtP2 && status === "admit_card")) {
      const countdown = formatCountdown(p2ExamDays);
      return {
        title: `${p2Name} Examination`,
        date:
          [formatDate(p2ExamDate), countdown].filter(Boolean).join(" · ") ||
          "Date to be announced",
        subtitle: `${p2Name} Admit Card is available for download`,
        link: phase2?.admitCardLink
          ? { href: phase2.admitCardLink, label: "Download Admit Card" }
          : null,
        tone: "warn",
      };
    }

    // 4. Phase 2 exam is scheduled / upcoming
    if (p2ExamDate) {
      const countdown = formatCountdown(p2ExamDays);
      return {
        title: `${p2Name} Examination`,
        date: [formatDate(p2ExamDate), countdown].filter(Boolean).join(" · "),
        subtitle: `Prepare for ${p2Name}`,
        tone: "accent",
      };
    }

    // 5. Phase 2 schedule not yet released
    return {
      title: `${p2Name} Schedule`,
      date: "To be announced",
      subtitle: `Waiting for ${p2Name} notification & dates`,
      tone: "neutral",
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CASE C: Evaluate Phase 1 (Prelims / CBT / Single Phase)
  // ──────────────────────────────────────────────────────────────────────────

  // 1. Phase 1 result is available
  if (phase1?.resultAvailable) {
    return {
      title: twoPhases ? `${p1Name} Result Declared` : "Result Declared",
      date: "Available now",
      subtitle: "Check your official scorecard",
      link: phase1.resultLink ? { href: phase1.resultLink, label: "Check Result" } : null,
      tone: "good",
    };
  }

  // 2. Phase 1 exam is past -> awaiting Prelims result
  const p1ExamPast =
    (p1ExamDays !== null && p1ExamDays < 0) || phase1?.status === "exam_completed";
  if (p1ExamPast || status === "appeared") {
    const countdown = formatCountdown(p1ResultDays);
    return {
      title: twoPhases ? `${p1Name} Result Declaration` : "Result Declaration",
      date:
        [formatDate(p1ResultDate), countdown].filter(Boolean).join(" · ") || "Expected soon",
      subtitle: `${twoPhases ? p1Name : "Exam"} completed · Awaiting result`,
      tone: "accent",
    };
  }

  // 3. Phase 1 admit card is out or status is admit_card
  if (status === "admit_card" || phase1?.admitCardAvailable) {
    const countdown = formatCountdown(p1ExamDays);
    const title = attempt.stage
      ? `${attempt.stage} Examination`
      : phase1?.name
        ? `${p1Name} Examination`
        : "Written Examination";

    return {
      title,
      date:
        [formatDate(p1ExamDate), countdown].filter(Boolean).join(" · ") ||
        "Date to be announced",
      subtitle: phase1?.admitCardAvailable
        ? "Admit Card is available for download"
        : "Admit Card released",
      link: phase1?.admitCardLink
        ? { href: phase1.admitCardLink, label: "Download Admit Card" }
        : null,
      tone: "warn",
    };
  }

  // 4. Status is applied -> check admit card or exam
  if (status === "applied") {
    const admitEvent = rep?.events.find(
      (e) => e.type === "admit_card" && (e.phase === 1 || e.phase === null),
    );
    const admitDate = admitEvent?.date ?? null;
    const daysAdmit = today && admitDate ? daysUntilFrom(today, admitDate) : null;
    const admitIsPast = daysAdmit !== null && daysAdmit < 0;

    if (admitIsPast && p1ExamDate) {
      const countdown = formatCountdown(p1ExamDays);
      return {
        title: phase1?.name ? `${p1Name} Examination` : "Written Examination",
        date: [formatDate(p1ExamDate), countdown].filter(Boolean).join(" · "),
        subtitle: "Admit card expected · Download from official portal",
        tone: "warn",
      };
    }

    if (admitDate && !admitIsPast) {
      const countdownAdmit = formatCountdown(daysAdmit);
      return {
        title: "Admit Card Release",
        date: [formatDate(admitDate), countdownAdmit].filter(Boolean).join(" · "),
        subtitle: "Application submitted · Waiting for admit card",
        tone: "accent",
      };
    }

    if (p1ExamDate) {
      const countdown = formatCountdown(p1ExamDays);
      return {
        title: phase1?.name ? `${p1Name} Examination` : "Admit Card & Exam",
        date: [formatDate(p1ExamDate), countdown].filter(Boolean).join(" · "),
        subtitle: "Admit card expected before examination",
        tone: "accent",
      };
    }

    return {
      title: "Admit Card Release",
      date: "To be announced",
      subtitle: "Application submitted · Waiting for exam schedule",
      tone: "accent",
    };
  }

  // 5. Status is tracking
  //
  // The report's own closing date first, then the one on the notification the
  // attempt came from. Without that fallback a row the tracker has just filed
  // under "Applications closing" — which it can do from `job.last_date` alone
  // — showed "Official Notification & Dates · To be announced" in the box
  // underneath, contradicting the section it was sitting in.
  const appCloseEvent = rep?.events.find((e) => e.type === "application_close");
  const appCloseDate = appCloseEvent?.date ?? attempt.job?.last_date ?? null;
  if (appCloseDate) {
    const days = today ? daysUntilFrom(today, appCloseDate) : null;
    const appClosed = days !== null && days < 0;

    if (appClosed && p1ExamDate) {
      const countdown = formatCountdown(p1ExamDays);
      return {
        title: phase1?.admitCardAvailable
          ? "Download Admit Card"
          : phase1?.name
            ? `${p1Name} Examination`
            : "Target Exam Date",
        date: [formatDate(p1ExamDate), countdown].filter(Boolean).join(" · "),
        subtitle: "Applications closed · Exam upcoming",
        tone: "warn",
      };
    }

    if (!appClosed) {
      const countdown =
        days !== null ? (days === 0 ? "Last day today!" : `In ${String(days)} days`) : null;
      return {
        title: "Application Deadline",
        date: [formatDate(appCloseDate), countdown].filter(Boolean).join(" · "),
        subtitle: "Complete your online application before the portal closes",
        tone: days !== null && days <= 3 && days >= 0 ? "warn" : "accent",
      };
    }
  }

  if (p1ExamDate) {
    const countdown = formatCountdown(p1ExamDays);
    return {
      title: phase1?.name ? `${p1Name} Target Date` : "Target Exam Date",
      date: [formatDate(p1ExamDate), countdown].filter(Boolean).join(" · "),
      subtitle: "Exam scheduled",
      tone: "accent",
    };
  }

  return {
    title: "Official Notification & Dates",
    date: "To be announced",
    subtitle: "Tracking recruitment updates",
    tone: "neutral",
  };
}
