/**
 * The skill vocabulary, and its labels.
 *
 * Keys are the contract — `public.skill_tags_of` emits them and
 * `profiles.skills` stores them — and the labels are free to change without a
 * migration, the same arrangement `SECTORS` in `vocab.ts` has with `jobs.tags`.
 *
 * A direct port of `getSkillLabel` from the old app's `jobMatcher.ts`, in the
 * same five groups it used. Nothing here imports anything, for the reason
 * `profile/enums.ts` spells out: a Client Component importing one label must
 * not pull Zod into the browser bundle.
 *
 * ── Why the whole list is offered, and not a shortlist ─────────────────────
 * The old wizard asked about seven skills and let people type the rest as free
 * text, which meant a GATE score was stored as the string "gate score" and
 * matched nothing. Every tag the matcher can detect is claimable here instead.
 * A tag that can be detected but not claimed is a job stuck in "almost there"
 * forever, for someone who already has the thing being asked for.
 */

export interface SkillGroup {
  /** Heading on the preferences form. */
  title: string;
  /** One line saying what this group is, or nothing when the title suffices. */
  hint?: string;
  skills: readonly { value: string; label: string }[];
}

export const SKILL_GROUPS: readonly SkillGroup[] = [
  {
    title: "Skills and tests",
    hint: "The ones clerical and technical posts ask for most often.",
    skills: [
      { value: "computer", label: "Computer proficiency (CCC / O Level / DCA)" },
      { value: "typing_english", label: "English typing" },
      { value: "typing_hindi", label: "Hindi typing" },
      { value: "stenography", label: "Stenography (shorthand)" },
      { value: "driving", label: "Driving licence" },
      { value: "swimming", label: "Swimming" },
      { value: "surveying", label: "Surveying" },
    ],
  },
  {
    title: "Qualifying scores and certifications",
    skills: [
      { value: "gate_score", label: "GATE / GPAT score" },
      { value: "net_slet", label: "UGC NET / CSIR NET / SLET / JRF" },
      { value: "ca_icwa", label: "CA / ICWA / CS" },
      { value: "cti_cits", label: "CTI / CITS" },
      { value: "jaiib_caiib", label: "JAIIB / CAIIB" },
      { value: "cfa_frm", label: "CFA / FRM" },
      { value: "nism", label: "NISM certification" },
      { value: "pmp", label: "PMP certification" },
      { value: "ccna_networking", label: "CCNA / CCNP / CompTIA" },
      { value: "afih", label: "AFIH (industrial health)" },
      { value: "boe_certificate", label: "BOE (boiler operation engineer)" },
      { value: "fssai", label: "FSSAI certification" },
      { value: "nis_coaching", label: "NIS coaching diploma" },
      { value: "medical_coding", label: "Medical coding (ICD-10)" },
      { value: "special_education", label: "Special education diploma" },
    ],
  },
  {
    /* These are the tags SQL treats as gates rather than gaps — see
       `public.blocker_skill_tags()`. A posting asking for one of them lands in
       "verify eligibility" until it is claimed here, because none of them can
       be acquired between now and a closing date. Claiming one is therefore
       the single highest-value thing on this form. */
    title: "Standards and languages",
    hint: "A posting asking for one of these stays under “worth checking” until you claim it.",
    skills: [
      { value: "physical_fitness", label: "Physical standards (height, chest, running)" },
      { value: "hindi_proficiency", label: "Hindi proficiency" },
      { value: "local_language", label: "A regional language" },
      { value: "sanskrit", label: "Sanskrit" },
      { value: "rci_registration", label: "RCI registration" },
    ],
  },
  {
    title: "Software and domain expertise",
    skills: [
      { value: "autocad", label: "AutoCAD" },
      { value: "gis", label: "GIS / remote sensing" },
      { value: "sap_erp", label: "SAP / ERP" },
      { value: "programming", label: "Programming" },
      { value: "braille", label: "Braille" },
      { value: "sign_language", label: "Sign language" },
      { value: "agriculture", label: "Agriculture / agronomy" },
      { value: "horticulture", label: "Horticulture" },
      { value: "fisheries", label: "Fisheries" },
      { value: "forestry", label: "Forestry" },
      { value: "veterinary", label: "Veterinary science" },
      { value: "geology", label: "Geology" },
      { value: "textile", label: "Textile technology" },
      { value: "food_technology", label: "Food technology" },
      { value: "biotechnology", label: "Biotechnology" },
      { value: "physiotherapy", label: "Physiotherapy" },
      { value: "clinical_psychology", label: "Clinical psychology" },
      { value: "social_work", label: "Social work (MSW / BSW)" },
      { value: "public_health", label: "Public health / epidemiology" },
    ],
  },
];

/** Every valid skill key, flattened. The server action validates against this. */
export const SKILL_KEYS: readonly string[] = SKILL_GROUPS.flatMap((g) =>
  g.skills.map((s) => s.value),
);

const SKILL_LABELS: Record<string, string> = Object.fromEntries(
  SKILL_GROUPS.flatMap((g) => g.skills.map((s) => [s.value, s.label] as const)),
);

/**
 * A skill's label, or a readable fallback.
 *
 * The fallback matters: `skill_tags_of` is the authority on what tags exist,
 * and adding one there is a migration this file need not block on. An unknown
 * tag renders as words rather than as `typing_hindi`.
 */
export function skillLabel(key: string): string {
  return SKILL_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Post classification, as `public.grade_of` infers it.
 *
 * The values are the contract — they are compared against `jobs.grade` in SQL —
 * so they are the full "Group A" strings rather than slugs.
 */
export const GRADES = [
  { value: "Group A", label: "Group A — officers" },
  { value: "Group B", label: "Group B — gazetted" },
  { value: "Group C", label: "Group C — clerical, SSC" },
  { value: "Group D", label: "Group D — MTS, support" },
] as const;

/**
 * Salary bands, as the old wizard framed them.
 *
 * Bands rather than two number inputs because that is the question people can
 * actually answer — "what should this pay" has a shape, and asking for a rupee
 * figure gets a made-up one. The value encodes the range so the form posts one
 * field, and `any` posts nothing at all.
 */
export const SALARY_BANDS = [
  { value: "0-20000", label: "Under ₹20,000" },
  { value: "20000-50000", label: "₹20,000 – ₹50,000" },
  { value: "50000-100000", label: "₹50,000 – ₹1,00,000" },
  { value: "100000-200000", label: "₹1,00,000 – ₹2,00,000" },
  { value: "200000-", label: "Above ₹2,00,000" },
] as const;

/** `"20000-50000"` → `[20000, 50000]`. Returns nulls for anything unparseable. */
export function parseSalaryBand(value: string | null): [number | null, number | null] {
  if (!value) return [null, null];
  const [min, max] = value.split("-");
  const toNumber = (part: string | undefined) => {
    if (!part) return null;
    const n = Number(part);
    return Number.isFinite(n) ? n : null;
  };
  return [toNumber(min), toNumber(max)];
}

/** The inverse, so the form can pre-select the band a stored pair came from. */
export function salaryBandOf(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  return (
    SALARY_BANDS.find((b) => {
      const [bMin, bMax] = parseSalaryBand(b.value);
      return bMin === min && bMax === max;
    })?.value ?? ""
  );
}
