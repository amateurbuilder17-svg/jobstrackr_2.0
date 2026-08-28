import "server-only";

import {
  EVENT_TYPES,
  EXAM_STAGES,
  PHASE_STATUSES,
  type EventType,
  type ExamStage,
  type PhaseStatus,
  type StatusEvent,
  type StatusPhase,
  type StatusReport,
} from "@/lib/exams/report";

/**
 * The prompt, and the parser that makes its answer safe to store.
 *
 * Split from `exam-status.ts` — which makes the call — because these two halves
 * have different dependencies and only one of them is worth testing hard. Every
 * function here is pure: text in, canonical report out, no key, no network, no
 * environment. That is what lets `exam-status.test.ts` cover the shapes that
 * actually arrive without standing up a Gemini client.
 *
 * The **prompt** states a JSON contract. It cannot be enforced by the API —
 * v1beta refuses `responseMimeType: "application/json"` in the same request as
 * the search tool, and the search tool is the entire value of the feature — so
 * the contract is prose and the model honours it approximately.
 *
 * The **parser** is what makes that safe. It accepts the loose thing that
 * actually arrives, including the shapes the old project's cached rows are
 * full of, and emits exactly one canonical shape. Everything downstream reads
 * plain fields. This is the trade the old app got backwards: it stored the
 * model's output verbatim and pushed the coping onto 1,321 lines of card.
 *
 * Hand-rolled rather than a Zod schema, and that is a considered choice. Zod is
 * for input that is supposed to be valid, where rejecting it is the right
 * answer; here nothing is supposed to be valid and rejecting the whole report
 * because one date is prose would throw away the nine fields that were fine.
 * Every helper below coerces or drops, field by field.
 */

/* ── The subject ───────────────────────────────────────────────────────── */

export interface StatusSubject {
  /** From `subjectKeyFor`. Carried through so the caller cannot mismatch them. */
  key: string;
  label: string;
  organization: string | null;
  officialWebsite: string | null;
  /** The stage the person says they are at — "Prelims", "Mains". A hint only. */
  stage: string | null;
}

/* ── The prompt ────────────────────────────────────────────────────────── */

export const SYSTEM_PROMPT = `You are a research assistant for Indian government exam candidates.

Use Google Search to find CURRENT information from official sources before you answer. Prefer the conducting body's own website; use aggregator sites only to locate the official page, never as the answer.

Many Indian government exams run in stages — Prelims and Mains, or Tier 1 and Tier 2, or CBT 1 and CBT 2. Research every stage, and name each stage exactly as the conducting body names it.

Respond with a single JSON object and nothing else. No prose before it, no explanation after it, no markdown fence.

Be accurate or say nothing. A field you are unsure of must be null. Never state that a document is available unless you have found the live download page for it — "expected soon", "will be released shortly" and "notification issued" all mean it is NOT available.`;

/**
 * The contract. Kept close to the old app's on purpose: the field names are
 * what several thousand cached rows already use, and a model that has seen
 * this exact structure asked of it before produces it more reliably than a
 * cleaner one it has to be taught.
 */
export function buildPrompt(subject: StatusSubject, today: Date): string {
  const formatted = today.toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const facts = [
    `Exam: ${subject.label}`,
    subject.organization ? `Conducting body: ${subject.organization}` : null,
    subject.officialWebsite ? `Official website: ${subject.officialWebsite}` : null,
    subject.stage ? `The candidate is tracking this stage: ${subject.stage}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `Today is ${formatted} (India). Anything dated after today has not happened yet.

${facts}

Search for the current status of this exam and every stage of it.

Return ONLY this JSON object:
{
  "summary": "one or two sentences on where this exam has got to",
  "current_status": "not_yet_notified | registration_open | registration_closed | exam_scheduled | admit_card_available | exam_completed | result_declared",
  "phases": {
    "phase1": {
      "name": "the official name of the first stage, e.g. Tier 1 or Prelims",
      "status": "not_applicable | not_yet_notified | registration_open | registration_closed | exam_scheduled | admit_card_available | exam_completed | result_declared",
      "admit_card_available": false,
      "admit_card_link": "the official download URL, or null",
      "exam_date": "YYYY-MM-DD or null",
      "exam_details": "timing, shift and centre information, or null",
      "result_available": false,
      "result_link": "the official result URL, or null",
      "result_date": "YYYY-MM-DD or null"
    },
    "phase2": { "same fields, or status \\"not_applicable\\" if this exam has a single stage" }
  },
  "predicted_events": [
    {
      "event_type": "application_open | application_close | admit_card | exam_date | result",
      "phase": 1,
      "predicted_date": "YYYY-MM-DD",
      "confidence": "high | medium | low",
      "notes": "why, in a few words"
    }
  ],
  "latest_updates": ["short factual lines about what has happened recently"],
  "recommendations": ["what the candidate should do next"],
  "confidence_score": 0
}

Rules:
- Every date is ISO "YYYY-MM-DD". If a source gives only a month, use predicted_events with confidence "low" rather than inventing a day.
- "admit_card_available" and "result_available" are booleans, never strings, and are true only if the download page is live today.
- Links must be official conducting-body or government URLs. Never link an aggregator, a news site, a WhatsApp group or a Telegram channel.
- "confidence_score" is 0-100 and is your confidence in this whole answer, based on how recent and how official your sources were.`;
}

/* ── Coercion helpers ──────────────────────────────────────────────────── */

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Loose)
    : null;
}

function asText(value: unknown, max = 600): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "n/a") {
    return null;
  }
  return trimmed.slice(0, max);
}

/**
 * Strictly true, never truthy.
 *
 * The failure this exists for is documented on `StatusPhase.admitCardAvailable`:
 * asked for a boolean, the model answers `"February 7 expected"` often enough
 * that treating the field as truthy told people to go and download an admit
 * card that did not exist.
 */
function asStrictBoolean(value: unknown): boolean {
  return value === true;
}

function asStringList(value: unknown, max = 6): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = asText(item, 300);
    if (text !== null) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * A date, or nothing.
 *
 * ISO and month-name forms are accepted. Purely numeric slash forms are
 * deliberately not: "03/04/2026" is 3 April to an Indian source and 4 March to
 * an American one, and this app has one job that a wrong exam date destroys.
 * Absent beats plausible-and-wrong — the same rule the exam matcher works to.
 */
export function asIsoDate(value: unknown): string | null {
  const text = asText(value, 60);
  if (text === null) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // "15 March 2026" / "15 Mar 2026"
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(text);
  if (dmy) {
    const month = MONTHS[(dmy[2] ?? "").slice(0, 3).toLowerCase()];
    if (month) return validDate(Number(dmy[3]), month, Number(dmy[1]));
  }

  // "March 15, 2026" / "Mar 15 2026"
  const mdy = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (mdy) {
    const month = MONTHS[(mdy[1] ?? "").slice(0, 3).toLowerCase()];
    if (month) return validDate(Number(mdy[3]), month, Number(mdy[2]));
  }

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${String(year)}-${pad(month)}-${pad(day)}`;

  // Rejects 31 February and friends: Date rolls them forward silently.
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCDate() === day && parsed.getUTCMonth() + 1 === month ? iso : null;
}

/**
 * Hosts that are never the answer.
 *
 * The prompt asks for official links and mostly gets them. Mostly is not good
 * enough for a link labelled "Download admit card": an aggregator link there
 * sends someone to a page of adverts at the moment they are most anxious, and
 * a WhatsApp link sends them somewhere this app should not be sending anyone.
 * The old app filtered these at every one of a dozen render sites; here they
 * never enter the stored report.
 */
const BLOCKED_LINK_HOSTS = [
  "freejobalert",
  "wa.me",
  "whatsapp.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  "facebook.com",
  "youtube.com",
  "instagram.com",
];

export function asOfficialLink(value: unknown): string | null {
  const text = asText(value, 500);
  if (text === null) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (BLOCKED_LINK_HOSTS.some((blocked) => host.includes(blocked))) return null;

  return url.toString();
}

function asStage(value: unknown, fallback: ExamStage): ExamStage {
  const text = asText(value, 60)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!text) return fallback;

  // The one alias worth carrying: the old prompt asked for this spelling and
  // several thousand cached rows use it.
  const canonical = text === "not_notified" ? "not_yet_notified" : text;

  return (EXAM_STAGES as readonly string[]).includes(canonical)
    ? (canonical as ExamStage)
    : fallback;
}

function asPhaseStatus(value: unknown, fallback: PhaseStatus): PhaseStatus {
  const text = asText(value, 60)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!text) return fallback;
  const canonical = text === "not_notified" ? "not_yet_notified" : text;
  return (PHASE_STATUSES as readonly string[]).includes(canonical)
    ? (canonical as PhaseStatus)
    : fallback;
}

const EVENT_ALIASES: Record<string, EventType> = {
  exam: "exam_date",
  examination: "exam_date",
  exam_dates: "exam_date",
  admit_card_date: "admit_card",
  hall_ticket: "admit_card",
  result_date: "result",
  registration_open: "application_open",
  registration_close: "application_close",
  last_date: "application_close",
  application_last_date: "application_close",
};

function asEventType(value: unknown): EventType | null {
  const text = asText(value, 60)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!text) return null;
  if ((EVENT_TYPES as readonly string[]).includes(text)) return text as EventType;
  return EVENT_ALIASES[text] ?? null;
}

/* ── Normalising ───────────────────────────────────────────────────────── */

function normalizePhase(raw: unknown, index: number): StatusPhase | null {
  const obj = asObject(raw);
  if (!obj) return null;

  return {
    name: asText(obj.name, 80) ?? (index === 0 ? "Stage 1" : "Stage 2"),
    status: asPhaseStatus(obj.status, index === 0 ? "not_yet_notified" : "not_applicable"),
    admitCardAvailable: asStrictBoolean(obj.admit_card_available),
    admitCardLink: asOfficialLink(obj.admit_card_link),
    examDate: asIsoDate(obj.exam_date),
    examDetails: asText(obj.exam_details, 400),
    resultAvailable: asStrictBoolean(obj.result_available),
    resultLink: asOfficialLink(obj.result_link),
    resultDate: asIsoDate(obj.result_date),
  };
}

/**
 * Every place a phase has ever been written, reduced to an ordered pair.
 *
 * `phases.phase1` is what the current prompt asks for. `phase_1` at the root
 * is what an older prompt produced. A bare array is what a model that ignored
 * the contract produces. All three arrive; one shape leaves.
 */
function collectPhases(root: Loose): [unknown, unknown] {
  const phases = asObject(root.phases);

  if (Array.isArray(root.phases)) {
    return [root.phases[0], root.phases[1]];
  }

  return [
    phases?.phase1 ?? phases?.phase_1 ?? root.phase_1 ?? null,
    phases?.phase2 ?? phases?.phase_2 ?? root.phase_2 ?? null,
  ];
}

function normalizeEvents(root: Loose, phases: StatusPhase[]): StatusEvent[] {
  const events: StatusEvent[] = [];
  const seen = new Set<string>();

  const add = (
    type: EventType | null,
    date: string | null,
    phase: number | null,
    certainty: StatusEvent["certainty"],
    notes: string | null,
  ) => {
    if (type === null || date === null) return;
    const key = `${type}:${date}:${String(phase ?? 0)}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({ type, phase, date, certainty, notes });
  };

  const raw = Array.isArray(root.predicted_events) ? root.predicted_events : [];
  for (const item of raw) {
    const obj = asObject(item);
    if (!obj) continue;

    const phase = Number(obj.phase);
    const certainty = asText(obj.confidence, 10)?.toLowerCase();

    add(
      asEventType(obj.event_type),
      // `date` is the field an older prompt used.
      asIsoDate(obj.predicted_date ?? obj.date),
      phase === 1 || phase === 2 ? phase : null,
      certainty === "high" || certainty === "medium" || certainty === "low" ? certainty : null,
      asText(obj.notes, 200),
    );
  }

  // Dates the model expressed structurally but did not repeat as events. The
  // old normaliser did this too, and for the same reason: the timeline should
  // be the complete list, not the subset the model happened to say twice.
  phases.forEach((phase, index) => {
    add("exam_date", phase.examDate, index + 1, "high", null);
    add("result", phase.resultDate, index + 1, "high", null);
  });

  // Flat fields from the oldest cached shape.
  add("application_close", asIsoDate(root.last_date_to_apply), null, null, null);
  add("exam_date", asIsoDate(root.exam_dates ?? root.exam_date), null, null, null);
  add("result", asIsoDate(root.expected_result_date), null, null, null);

  return events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
}

/**
 * The checks that stop a fluent answer being a wrong one.
 *
 * Each is a real failure seen in production, not a hypothetical:
 *
 *   • an admit card reported "available" for an exam three months away
 *   • a result reported "declared" with a result date next week
 *   • a badge reading "Admit card out" above a section reading "Pending",
 *     because the headline status and the phase field were set independently
 *
 * The third is why the stage is reconciled against the phase evidence rather
 * than trusted. The old card patched that disagreement in the reader with a
 * forty-entry keyword list matching phrases like "admit card link activated";
 * fixing it once on the way in removes the need for any of that.
 */
function applyDefensiveChecks(report: StatusReport, now: Date): StatusReport {
  const today = now.toISOString().slice(0, 10);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const phases = report.phases.map((phase): StatusPhase => {
    let admitCardAvailable = phase.admitCardAvailable;
    let resultAvailable = phase.resultAvailable;

    // An admit card is issued days to a fortnight before the exam, never a
    // month and a half. A claim otherwise is a hallucination with a date
    // attached, and the date is the part we can check.
    if (admitCardAvailable && phase.examDate !== null && phase.examDate > in30Days) {
      admitCardAvailable = false;
    }

    // A result that "is available" on a date in the future is not available.
    if (resultAvailable && phase.resultDate !== null && phase.resultDate > today) {
      resultAvailable = false;
    }

    return {
      ...phase,
      admitCardAvailable,
      resultAvailable,
      // A link to a document that is not out yet is a link to a 404.
      admitCardLink: admitCardAvailable ? phase.admitCardLink : null,
      resultLink: resultAvailable ? phase.resultLink : null,
    };
  });

  const first = phases[0];
  const anyResult = phases.some((p) => p.resultAvailable);
  let stage = report.stage;

  // Reconcile in both directions, so the headline and the sections agree.
  if (stage === "result_declared" && !anyResult) stage = "exam_completed";
  if (stage === "admit_card_available" && first?.admitCardAvailable !== true) {
    stage = first?.examDate !== null ? "exam_scheduled" : "registration_closed";
  }
  if (
    first?.admitCardAvailable === true &&
    EXAM_STAGES.indexOf(stage) < EXAM_STAGES.indexOf("admit_card_available")
  ) {
    stage = "admit_card_available";
  }
  if (anyResult) stage = "result_declared";

  return { ...report, stage, phases };
}

/* ── Parsing ───────────────────────────────────────────────────────────── */

/**
 * The JSON object inside whatever the model actually sent.
 *
 * Fences get stripped, and a leading apology ("Here is the JSON you asked
 * for:") is survived by slicing from the first brace to the last. Both happen
 * often enough to be worth the six lines.
 */
export function extractJson(text: string): string | null {
  let body = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(body);
  if (fenced?.[1]) body = fenced[1].trim();

  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  return body.slice(start, end + 1);
}

/** Loose model output in, one canonical report out — or null if it was junk. */
export function parseStatusReport(text: string, now: Date = new Date()): StatusReport | null {
  const json = extractJson(text);
  if (json === null) return null;

  let root: Loose | null;
  try {
    root = asObject(JSON.parse(json));
  } catch {
    return null;
  }
  if (root === null) return null;

  const [rawFirst, rawSecond] = collectPhases(root);

  // The oldest cached shape put phase one's fields at the root. Folded in
  // rather than read as a fallback at every call site, which is what the old
  // `getPhaseData` did.
  const first = normalizePhase(rawFirst, 0) ?? {
    name: "Stage 1",
    status: asPhaseStatus(root.current_status, "not_yet_notified"),
    admitCardAvailable: asStrictBoolean(root.admit_card_available),
    admitCardLink: asOfficialLink(root.admit_card_link),
    examDate: asIsoDate(root.exam_dates ?? root.exam_date),
    examDetails: asText(root.exam_details, 400),
    resultAvailable: asStrictBoolean(root.result_available),
    resultLink: asOfficialLink(root.result_link),
    resultDate: asIsoDate(root.expected_result_date),
  };

  const second = normalizePhase(rawSecond, 1);
  const phases = second && second.status !== "not_applicable" ? [first, second] : [first];

  const confidenceRaw = Number(root.confidence_score);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(100, Math.max(0, Math.round(confidenceRaw)))
    : null;

  const report: StatusReport = {
    summary: asText(root.summary, 600),
    stage: asStage(
      root.current_status,
      first.status === "not_applicable" ? "not_yet_notified" : first.status,
    ),
    phases,
    events: normalizeEvents(root, phases),
    updates: asStringList(root.latest_updates),
    recommendations: asStringList(root.recommendations, 5),
    confidence,
  };

  // A report with no status, no summary and no dates is a parse that happened
  // to succeed on an empty object. Nothing is better than that on screen.
  const empty =
    report.summary === null &&
    report.events.length === 0 &&
    report.updates.length === 0 &&
    report.stage === "not_yet_notified" &&
    !first.admitCardAvailable;
  if (empty && report.phases.length === 1 && first.examDate === null) return null;

  return applyDefensiveChecks(report, now);
}
