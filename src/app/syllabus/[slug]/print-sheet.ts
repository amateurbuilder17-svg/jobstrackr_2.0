import type { Syllabus } from "@/lib/syllabus/schema";

import { sectionName, stageTotal } from "./present";

/**
 * The printable syllabus, as one self-contained HTML document.
 *
 * Carried across from the old app's `handleDownloadPdf`: same structure, same
 * stylesheet, same two-column topic lists, same "open a window, write, print"
 * delivery — which is still the right mechanism. It produces a real PDF through
 * the browser's own print dialog, with selectable text and working links, and
 * it costs nothing; the alternative is shipping a PDF library to every visitor
 * of a page most of them will never print.
 *
 * This module is loaded on click, not with the page, so that stylesheet is not
 * in anybody's first load.
 *
 * One thing is genuinely different. The old version interpolated the model's
 * output straight into HTML — exam names, topics, and source URLs, none of them
 * escaped. That is a script tag away from executing in a same-origin window,
 * from text a language model was talked into writing by a page it was told to
 * search. Everything user- or model-supplied goes through `escapeHtml` here,
 * and URLs are dropped unless they are http(s).
 */

export function buildPrintSheet(syllabus: Syllabus): string {
  const stages = syllabus.stages;

  const stagesHtml = stages
    .map((stage) => {
      const total = stageTotal(stage);

      const sectionsHtml = stage.sections
        .map((section) => {
          const name = escapeHtml(sectionName(section, stage));
          const topics = section.topics
            .map((topic) => `<li>${escapeHtml(topic)}</li>`)
            .join("");
          const marks =
            section.marks === null
              ? ""
              : `<span class="section-marks">${escapeHtml(String(section.marks))} Marks</span>`;

          return `
            <div class="section">
              <div class="section-header">
                <span class="section-name">${name}</span>
                ${marks}
              </div>
              ${topics ? `<ul class="topics">${topics}</ul>` : '<p class="no-topics">No topics listed</p>'}
            </div>`;
        })
        .join("");

      const heading =
        stages.length > 1 && stage.name !== null
          ? `<h2 class="stage-title">${escapeHtml(stage.name)}</h2>`
          : "";

      return `
        <div class="stage">
          ${heading}
          <div class="stats-row">
            <div class="stat"><span class="stat-label">Type</span><span class="stat-value">${escapeHtml(stage.examType ?? "Objective")}</span></div>
            <div class="stat"><span class="stat-label">Total Marks</span><span class="stat-value">${total === null ? "&mdash;" : String(total)}</span></div>
            <div class="stat"><span class="stat-label">Duration</span><span class="stat-value">${stage.durationMins === null ? "&mdash;" : `${String(stage.durationMins)} min`}</span></div>
            <div class="stat"><span class="stat-label">Sections</span><span class="stat-value">${String(stage.sections.length)}</span></div>
          </div>
          ${sectionsHtml}
        </div>`;
    })
    .join('<hr class="stage-divider">');

  const sourcesHtml = syllabus.sources
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 5)
    .map((url) => {
      const safe = escapeHtml(url);
      const host = escapeHtml(url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0] ?? url);
      return `<li><a href="${safe}">${host}</a></li>`;
    })
    .join("");

  const meta = [
    syllabus.year === null ? "" : `<span>${escapeHtml(String(syllabus.year))}</span>`,
    syllabus.confidence !== null && syllabus.confidence >= 0.8 ? "<span>Verified</span>" : "",
    `<span>${String(stages.length)} Stage${stages.length > 1 ? "s" : ""}</span>`,
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>${escapeHtml(syllabus.examName)} — Syllabus</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; padding: 32px; max-width: 900px; margin: 0 auto; line-height: 1.5; }
  .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 22px; color: #111; margin-bottom: 6px; }
  .header .meta { display: flex; justify-content: center; gap: 12px; font-size: 12px; color: #666; }
  .header .meta span { background: #f0f4ff; color: #2563eb; padding: 2px 10px; border-radius: 12px; font-weight: 600; }
  .stage { margin-bottom: 8px; }
  .stage-title { font-size: 18px; color: #2563eb; margin-bottom: 12px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  .stage-divider { border: none; border-top: 2px dashed #d1d5db; margin: 28px 0; }
  .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; text-align: center; }
  .stat-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #999; font-weight: 600; }
  .stat-value { display: block; font-size: 15px; font-weight: 700; color: #111; margin-top: 2px; }
  .section { background: #fafbfc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 12px; break-inside: avoid; }
  .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .section-name { font-size: 14px; font-weight: 700; color: #111; }
  .section-marks { font-size: 11px; font-weight: 600; background: #e8f0fe; color: #2563eb; padding: 3px 10px; border-radius: 6px; }
  .topics { list-style: none; padding: 0; columns: 2; column-gap: 24px; }
  .topics li { font-size: 12px; color: #444; padding: 3px 0 3px 16px; position: relative; break-inside: avoid; }
  .topics li::before { content: "•"; position: absolute; left: 0; color: #2563eb; font-weight: bold; }
  .no-topics { font-size: 12px; color: #999; font-style: italic; }
  .sources { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  .sources h3 { font-size: 13px; color: #666; margin-bottom: 8px; }
  .sources li { font-size: 11px; color: #2563eb; margin-bottom: 4px; list-style: none; }
  .sources a { color: #2563eb; text-decoration: none; }
  .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #e5e7eb; padding-top: 12px; }
  @media print { body { padding: 16px; } .section { break-inside: avoid; } }
</style>
</head><body>
  <div class="header">
    <h1>${escapeHtml(syllabus.examName)}</h1>
    <div class="meta">${meta}</div>
  </div>
  ${stagesHtml}
  ${sourcesHtml ? `<div class="sources"><h3>Sources</h3><ul>${sourcesHtml}</ul></div>` : ""}
  <div class="footer">Generated by JobsTrackr — Syllabus Finder</div>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
