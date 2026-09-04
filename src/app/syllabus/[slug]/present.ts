import type { Syllabus, SyllabusSection, SyllabusStage } from "@/lib/syllabus/schema";

/**
 * Presentation helpers shared by the interactive view and the printable sheet.
 *
 * Pure, and in their own module for a reason that shows up in the bundle: the
 * print sheet builds a whole standalone HTML document as a string, and the
 * view needs none of that. Keeping the naming and colouring here lets both
 * import what they share without either dragging in the other.
 */

/** The old app's `SECTION_COLORS`, in order. */
const SECTION_COLORS = [
  "#3B82F6",
  "#14B8A6",
  "#22C55E",
  "#F97316",
  "#8B5CF6",
  "#EF4444",
] as const;

export function sectionColor(index: number): string {
  return SECTION_COLORS[index % SECTION_COLORS.length] ?? SECTION_COLORS[0];
}

/**
 * The old app's `getSubjectIcon`, unchanged.
 *
 * Emoji rather than icon components because that is what it was, and because
 * the set is open-ended — a new subject gets 📚 instead of a missing import.
 */
export function sectionIcon(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("intelligence") || lower.includes("reasoning")) return "🧠";
  if (
    lower.includes("awareness") ||
    lower.includes("general knowledge") ||
    lower.includes("gk")
  )
    return "🌍";
  if (lower.includes("quantitative") || lower.includes("aptitude") || lower.includes("math"))
    return "🔢";
  if (lower.includes("english") || lower.includes("comprehension")) return "📖";
  if (lower.includes("computer")) return "💻";
  if (lower.includes("economics") || lower.includes("finance")) return "📊";
  return "📚";
}

/**
 * What to call a section.
 *
 * The old app stripped a `"<stage> - "` prefix off the subject, and it still
 * has to: models routinely answer `"Tier-1 - General Awareness"` for a section
 * that is already inside the Tier-1 stage, and leaving it renders the stage
 * name twice on every card under that tab.
 */
export function sectionName(section: SyllabusSection, stage: SyllabusStage): string {
  const raw = section.subject ?? section.sectionTitle ?? "Section";
  if (stage.name === null) return raw;
  const prefix = `${stage.name} - `;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

/** Marks actually attributed to sections, which is what the bars divide by. */
export function attributedMarks(stage: SyllabusStage): number {
  return stage.sections.reduce((total, s) => total + (s.marks ?? 0), 0);
}

/** A stage's headline total: what was declared, or what the sections add up to. */
export function stageTotal(stage: SyllabusStage): number | null {
  if (stage.totalMarks !== null) return stage.totalMarks;
  const summed = attributedMarks(stage);
  return summed > 0 ? summed : null;
}

/** Plain-text summary, for the clipboard fallback when sharing. */
export function toPlainText(syllabus: Syllabus): string {
  const lines: string[] = [
    `${syllabus.examName}${syllabus.year === null ? "" : ` (${String(syllabus.year)})`}`,
    "",
  ];

  for (const stage of syllabus.stages) {
    if (stage.name !== null) lines.push(stage.name, "");
    for (const section of stage.sections) {
      const name = sectionName(section, stage);
      lines.push(`${name}${section.marks === null ? "" : ` — ${String(section.marks)} marks`}`);
      for (const topic of section.topics.slice(0, 5)) lines.push(`  • ${topic}`);
      if (section.topics.length > 5) {
        lines.push(`  … and ${String(section.topics.length - 5)} more topics`);
      }
      lines.push("");
    }
  }

  lines.push("Powered by JobsTrackr — Syllabus Finder");
  return lines.join("\n");
}
