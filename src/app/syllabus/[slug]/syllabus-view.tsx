"use client";

import { useMemo, useState } from "react";

import { ChevronDownIcon, ClockIcon, FileIcon, ScaleIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { Syllabus, SyllabusSection, SyllabusStage } from "@/lib/syllabus/schema";
import { sectionColor, sectionName, sectionIcon } from "./present";

/**
 * The old app's `SyllabusResult` body: stage tabs, the three stat cards, the
 * weightage bars, and one collapsible card per subject.
 *
 * A Client Component, but not a client-rendered one — it is prerendered into
 * HTML like everything else on this cached page, and the JavaScript only takes
 * over the three things that need a click. That distinction is why nothing here
 * hides content by not rendering it:
 *
 *   - Inactive stages are `hidden`, not absent.
 *   - A collapsed subject's topics are `hidden`, not absent.
 *
 * The old app rendered both conditionally, which is fine in a SPA nobody
 * crawls. Here the topic list *is* the page — it is what somebody searching
 * "SSC CGL syllabus" is looking for and what this page exists to rank on — so
 * every topic of every stage ships in the initial HTML and the toggles only
 * decide what is visible.
 */
export function SyllabusView({ syllabus }: { syllabus: Syllabus }) {
  const { stages } = syllabus;
  const [activeStage, setActiveStage] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const multiStage = stages.length > 1;

  return (
    <>
      {/* Stage Tabs */}
      {multiStage ? (
        <div
          role="tablist"
          aria-label="Exam stages"
          className="mt-6 flex gap-2 overflow-x-auto pb-1"
        >
          {stages.map((stage, i) => (
            <button
              key={`${stage.name ?? "stage"}-${String(i)}`}
              type="button"
              role="tab"
              aria-selected={activeStage === i}
              onClick={() => {
                setActiveStage(i);
              }}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold",
                "transition-colors duration-(--duration-fast)",
                activeStage === i
                  ? "border-brand bg-brand text-white shadow-xs"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
              )}
            >
              {stage.name ?? `Stage ${String(i + 1)}`}
            </button>
          ))}
        </div>
      ) : null}

      {stages.map((stage, stageIndex) => (
        <StagePanel
          key={`${stage.name ?? "stage"}-${String(stageIndex)}`}
          stage={stage}
          hidden={multiStage && stageIndex !== activeStage}
          isExpanded={(i) => expanded[`${String(stageIndex)}:${String(i)}`] ?? false}
          onToggle={(i) => {
            const key = `${String(stageIndex)}:${String(i)}`;
            setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
          }}
        />
      ))}
    </>
  );
}

function StagePanel({
  stage,
  hidden,
  isExpanded,
  onToggle,
}: {
  stage: SyllabusStage;
  hidden: boolean;
  isExpanded: (index: number) => boolean;
  onToggle: (index: number) => void;
}) {
  // The sum is the fallback for `total_marks`, which conducting bodies publish
  // and models omit about as often as they supply it.
  const summed = useMemo(
    () => stage.sections.reduce((total, s) => total + (s.marks ?? 0), 0),
    [stage.sections],
  );
  const totalMarks = stage.totalMarks ?? (summed > 0 ? summed : null);

  // The bars are proportions of what is actually attributed to sections, not of
  // the stage's declared total. Dividing by a declared 200 when the sections
  // only account for 150 draws a chart with a quarter of it silently missing.
  const barBase = summed;

  return (
    <section hidden={hidden} className="mt-6 space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <Stat
          icon={<FileIcon className="size-4" />}
          label="TYPE"
          value={stage.examType ?? "—"}
        />
        <Stat
          icon={<ScaleIcon className="size-4" />}
          label="MARKS"
          value={totalMarks === null ? "—" : String(totalMarks)}
        />
        <Stat
          icon={<ClockIcon className="size-4" />}
          label="TIME"
          value={stage.durationMins === null ? "—" : `${String(stage.durationMins)}m`}
        />
      </div>

      {/* Weightage Chart */}
      {barBase > 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-3">
            Weightage analysis
          </p>
          <div className="mt-1 mb-4 flex items-center justify-between">
            <span className="text-base font-bold text-ink">
              {stage.sections.length} section{stage.sections.length === 1 ? "" : "s"}
            </span>
            <span className="text-xs font-semibold text-brand">
              {stage.sections.every((s) => s.marks === stage.sections[0]?.marks)
                ? "Equal distribution"
                : "Weighted"}
            </span>
          </div>
          <div className="space-y-3">
            {stage.sections.map((section, i) => {
              const marks = section.marks ?? 0;
              const pct = (marks / barBase) * 100;
              return (
                <div
                  key={`${sectionName(section, stage)}-${String(i)}`}
                  className="flex items-center gap-3"
                >
                  <span className="w-24 shrink-0 truncate text-xs text-ink-2">
                    {sectionName(section, stage)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      // A zero-mark section still gets a sliver, so the row
                      // reads as "no marks recorded" rather than as a bug.
                      style={{
                        width: `${String(Math.max(pct, 3))}%`,
                        backgroundColor: sectionColor(i),
                      }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs font-semibold text-ink-2 tabular">
                    {marks || "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Section Cards */}
      <div className="space-y-3">
        {stage.sections.map((section, i) => (
          <SectionCard
            key={`${sectionName(section, stage)}-${String(i)}`}
            section={section}
            name={sectionName(section, stage)}
            color={sectionColor(i)}
            expanded={isExpanded(i)}
            onToggle={() => {
              onToggle(i);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-xs">
      <span className="text-brand" aria-hidden="true">
        {icon}
      </span>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

function SectionCard({
  section,
  name,
  color,
  expanded,
  onToggle,
}: {
  section: SyllabusSection;
  name: string;
  color: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const weight =
    section.marksWeightage ??
    (section.marks === null ? null : `${String(section.marks)} marks`);
  const preview = section.topics.slice(0, 3).join(", ");

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs transition-colors hover:border-line-strong">
      <div className="flex items-center gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ backgroundColor: `${color}24` }}
          aria-hidden="true"
        >
          {sectionIcon(name)}
        </div>
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{name}</h3>
        {weight ? (
          <span className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 tabular">
            {weight}
          </span>
        ) : null}
      </div>

      {/* Collapsed preview. Hidden rather than dropped when open, so the two
          states swap without the card's height jumping twice. */}
      <p hidden={expanded} className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-3">
        {preview ? `${preview}…` : "No topics listed"}
      </p>

      <ul
        hidden={!expanded}
        className="mt-3 grid grid-cols-1 gap-2 border-t border-line/60 pt-3 sm:grid-cols-2"
      >
        {section.topics.map((topic) => (
          <li key={topic} className="flex items-start gap-2 text-sm leading-relaxed text-ink-2">
            <span
              className="mt-2 size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span>{topic}</span>
          </li>
        ))}
      </ul>

      {section.topics.length > 0 ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="mt-3 flex w-full items-center justify-between border-t border-line pt-3 text-xs font-bold uppercase tracking-wide text-brand"
        >
          <span>
            {expanded ? "Hide topics" : `View ${String(section.topics.length)} topics`}
          </span>
          <ChevronDownIcon
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
          />
        </button>
      ) : null}
    </div>
  );
}
