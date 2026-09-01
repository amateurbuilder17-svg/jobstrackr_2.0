import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { AttemptStatus } from "@/lib/tracker/enums";

export interface Stage {
  key: string;
  label: string;
  shortLabel: string;
  state: "completed" | "current" | "upcoming";
}

export function computeStages(
  status: AttemptStatus,
  currentStageName?: string | null,
): Stage[] {
  const stageNames = [
    { key: "apply", label: "Application", shortLabel: "Apply" },
    { key: "admit", label: "Admit Card", shortLabel: "Admit" },
    { key: "prelims", label: "Prelims Exam", shortLabel: "Prelims" },
    { key: "mains", label: "Mains / Tier 2", shortLabel: "Mains" },
    { key: "result", label: "Final Result", shortLabel: "Result" },
  ];

  let activeIndex = 0;
  if (status === "tracking" || status === "applied") {
    activeIndex = 0;
  } else if (status === "admit_card") {
    activeIndex = 1;
  } else if (status === "appeared") {
    activeIndex = 2;
  } else {
    activeIndex = 4;
  }

  // Adjust if custom stage name mentions Mains or Interview
  if (currentStageName) {
    const s = currentStageName.toLowerCase();
    if (s.includes("main") || s.includes("tier 2") || s.includes("tier ii")) {
      activeIndex = 3;
    } else if (s.includes("interview") || s.includes("final")) {
      activeIndex = 4;
    } else if (s.includes("admit")) {
      activeIndex = 1;
    } else if (s.includes("prelim") || s.includes("tier 1") || s.includes("tier i")) {
      activeIndex = 2;
    }
  }

  return stageNames.map((stage, idx) => {
    let state: Stage["state"] = "upcoming";
    if (idx < activeIndex) {
      state = "completed";
    } else if (idx === activeIndex) {
      state =
        status === "passed" || status === "failed" || status === "withdrawn"
          ? "completed"
          : "current";
    } else {
      state = "upcoming";
    }
    return { ...stage, state };
  });
}

export function ExamProgress({
  stages,
  className,
}: {
  stages: Stage[];
  className?: string;
}) {
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
