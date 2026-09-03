/**
 * Which sectors a posting belongs to.
 *
 * ## Why this exists
 *
 * `jobs.tags` is read by exactly two features: the Sector chips on /jobs
 * (`listJobs` does `tags @> [sector]`) and matching (`c.tags && me.preferred_
 * sectors`, in `match_tiers`). Both compare against `SECTORS` in
 * `lib/vocab.ts`. So the column has one job — carry `SECTORS` values — and
 * until this module existed it did not do it.
 *
 * What it carried instead came from the previous project's `generateTags`,
 * which tested a keyword with `text.includes(keyword)`. Unanchored substring
 * matching over government prose is not a near-miss; it is a different
 * function:
 *
 *   - `"lic"`  matched pub**lic**, po**lic**e, app**lic**ation → 59 rows tagged
 *     `insurance`, among them "UP Anganwadi" and "SSC GD Constable".
 *   - `"nda"`  matched seco**nda**ry, sta**nda**rd, ma**nda**tory → `upsc` on
 *     46 rows and `defence` on 48, most of them neither.
 *   - `"psc"`  matched u**psc** → "UPSC CDS (I) 2026" filed under `state_psc`.
 *   - `"bel"`  matched **bel**ow → `psu`.
 *   - `"bed "` matched descri**bed** → `teaching`.
 *   - `"rrb"`  matched "IBPS RRB PO", where RRB is Regional Rural *Bank* — the
 *     railway tag on a banking exam that prompted this rewrite.
 *
 * It also emitted a vocabulary nothing reads: qualification tiers
 * (`12th_pass`) duplicating the typed `min_qualification_level` column, job
 * groups (`group_c`) duplicating `grade`, and `state_psc` / `upsc` / `ssc`,
 * which are not `SECTORS` values and so could never match a saved preference
 * or a filter chip.
 *
 * ## The rules
 *
 * Two ideas do the work.
 *
 * **Match words, not substrings.** The text is reduced to single-spaced
 * alphanumerics and searched space-padded, so `lic` matches the word "LIC" and
 * nothing else. Every phrase below is written in that reduced form — `b tech`,
 * not `b.tech`.
 *
 * **Read the title and the employer, and nothing else.** Not the qualification
 * prose: that is where the boilerplate lives which produced "described" and
 * "public". A posting's sector is decided by who is hiring and what the post
 * is; the eligibility paragraph only adds noise, and noise is what is being
 * removed.
 *
 * Untagged is an allowed answer. A posting with no clear sector gets no tag
 * rather than a guess — an empty chip is a smaller lie than a wrong one.
 */

import { INDIAN_STATES, SECTORS } from "@/lib/vocab";

export type SectorTag = (typeof SECTORS)[number]["value"];

const SECTOR_LABELS = new Map<string, string>(SECTORS.map((s) => [s.value, s.label]));

/** A tag's chip label, or the raw value if an unknown one survives on a row. */
export function sectorLabel(tag: string): string {
  return SECTOR_LABELS.get(tag) ?? tag;
}

export interface SectorSubject {
  title: string;
  /** `organizations.name` — the strongest single signal there is. */
  organization?: string | null | undefined;
  /** `organizations.short_name`, for acronyms the name spells out. */
  shortName?: string | null | undefined;
}

/* ── Matching ──────────────────────────────────────────────────────────── */

/**
 * The subject as a bag of words, space-padded at both ends.
 *
 * Everything that is not a letter or digit becomes a space, so "CSIR-SERC",
 * "B.Tech" and "Grade-I" reduce to words a phrase list can name. The padding
 * is what makes `includes(" lic ")` a whole-word test without a regex.
 */
function reduce(subject: SectorSubject): { text: string; words: string[] } {
  const raw = [subject.title, subject.organization, subject.shortName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return { text: ` ${raw} `, words: raw.length > 0 ? raw.split(" ") : [] };
}

interface Reader {
  /** True when any phrase appears as a whole word, or whole run of words. */
  has: (...phrases: string[]) => boolean;
  /** True when any single word matches — for families like `*psc`. */
  word: (pattern: RegExp) => boolean;
  /**
   * True when a word from each list appears within `NEAR` words of the other.
   *
   * Presence alone is not evidence that two words belong together. "SSC GD
   * Constable … in Assam Rifles" (employer: Staff Selection Commission) has a
   * state name and the word "commission" in it, and is a central force
   * recruited by a central body. Requiring adjacency is what separates
   * "Assam Rifles" from "Government of Assam".
   */
  near: (left: readonly string[], right: readonly string[]) => boolean;
}

/** How far apart two words may sit and still be read as one name. */
const NEAR = 3;

function reader(subject: SectorSubject): Reader {
  const { text, words } = reduce(subject);
  const indexesOf = (phrases: readonly string[]): number[] => {
    const found: number[] = [];
    phrases.forEach((phrase) => {
      const parts = phrase.split(" ");
      words.forEach((_, i) => {
        if (parts.every((part, k) => words[i + k] === part)) found.push(i);
      });
    });
    return found;
  };

  return {
    has: (...phrases) => phrases.some((phrase) => text.includes(` ${phrase} `)),
    word: (pattern) => words.some((w) => pattern.test(w)),
    near: (left, right) => {
      const rights = indexesOf(right);
      if (rights.length === 0) return false;
      return indexesOf(left).some((l) => rights.some((r) => Math.abs(l - r) <= NEAR));
    },
  };
}

/** State and UT names, reduced the same way the subject is. */
const STATE_WORDS: readonly string[] = [
  ...INDIAN_STATES.filter((s) => s !== "All India").map((s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  ),
  // The abbreviations the feed actually uses in titles — "UP Anganwadi",
  // "HP JSV", "WB Police". Two-letter forms are listed explicitly rather than
  // inferred, because most two-letter words are not states.
  "up",
  "mp",
  "hp",
  "wb",
  "tn",
  "cg",
  "jk",
  "odisha",
  "orissa",
  // The union territories whose canonical names are too long to appear whole.
  "andaman",
  "nicobar",
  "dadra",
  "daman",
  "diu",
  "uttaranchal",
  "bengal",
];

/* ── The acronyms that mean two things ─────────────────────────────────── */

/**
 * Resolved once and shared, because getting one of these wrong is the whole
 * reason this module was written.
 */
function senses(r: Reader) {
  const banking = r.has(
    "bank",
    "banks",
    "banking",
    "ibps",
    "sbi",
    "rbi",
    "nabard",
    "sidbi",
    "regional rural",
    "gramin bank",
  );

  return {
    banking,

    /**
     * RRB. "IBPS RRB PO" is a *Regional Rural Bank* exam; "RRB NTPC" is the
     * Railway Recruitment Board. Any other banking word present decides it,
     * and a bare RRB is the railway board — the common case, and the one
     * candidates mean.
     */
    railway:
      (r.has("rrb", "rrc") && !banking) ||
      r.has(
        "railway",
        "railways",
        "rail",
        "metro",
        "dmrc",
        "ncrtc",
        "krcl",
        "konkan railway",
        "rites",
        "ircon",
        "rvnl",
        "dfccil",
        "railtel",
        "concor",
        "irctc",
        "rpf",
        "icf",
        "clw",
        "dlw",
        "banaras locomotive",
      ),

    /**
     * SSC. The Staff Selection Commission recruits for central government;
     * "Indian Army SSC Technical" is a *Short Service Commission* entry, which
     * is defence and not the SSC at all.
     */
    shortService:
      r.has("ssc") && r.has("army", "navy", "air force", "short service", "technical entry"),
  };
}

/**
 * Is the employer a state body?
 *
 * Deliberately not "does a state name appear". AIIMS Delhi, IIT Delhi and
 * Delhi University are central institutions that happen to sit in a state, and
 * the place name alone mis-files all three. Either the marker is unambiguous
 * on its own (a state PSC, a subordinate services board, an Anganwadi
 * project), or a state name has to appear next to a governmental one.
 */
function isStateBody(r: Reader): boolean {
  // The Union commission and the Union government are never state bodies,
  // whatever else the string happens to contain.
  if (r.has("upsc", "union public service commission")) return false;
  if (r.has("government of india", "govt of india")) return false;

  // BPSC, WBPSC, HPPSC — every state commission is "<state>psc" as one word.
  // `upsc` is already excluded above.
  if (r.word(/^[a-z]{1,4}psc$/)) return true;
  if (r.has("psc", "public service commission")) return true;

  // Boards and schemes that only exist at state level.
  if (
    r.has(
      "subordinate service",
      "subordinate services",
      "subordinate staff",
      "service selection board",
      "services selection board",
      "vyapam",
      "anganwadi",
      "aanganwadi",
      "icds",
      "panchayat",
      "zilla",
      "zila",
      "collectorate",
      "tehsil",
      "nagar nigam",
      "nagar palika",
      "nagar parishad",
      "municipal",
      "revenue department",
      "vibhag",
    )
  ) {
    return true;
  }

  // Otherwise: a state name *next to* something governmental — "Government of
  // Odisha", "Maharashtra Police", "Bihar Staff Selection Commission" — rather
  // than merely in the same string as one.
  return r.near(STATE_WORDS, GOVERNMENTAL);
}

/** Words that make a state name governmental rather than geographic. */
const GOVERNMENTAL: readonly string[] = [
  "government",
  "govt",
  "state",
  "directorate",
  "department",
  "commission",
  "board",
  "police",
  "district",
  "secretariat",
  "mission",
  "society",
  "authority",
  "council",
  "corporation",
  "administration",
];

/* ── The taxonomy ──────────────────────────────────────────────────────── */

/**
 * One rule per `SECTORS` value, in the order they are declared there.
 *
 * The rules are not exclusive, and should not be: a Railway Recruitment Board
 * junior-engineer post is `railway` and `engineering`; an SSC constable post
 * is `police`, `defence` and `central-govt`. Overlap is the honest answer for
 * a set of chips somebody can tick more than one of.
 */
const RULES: { tag: SectorTag; test: (r: Reader, s: ReturnType<typeof senses>) => boolean }[] =
  [
    {
      tag: "banking",
      test: (r, s) =>
        s.banking ||
        r.has(
          "bank of baroda",
          "canara",
          "union bank",
          "indian overseas",
          "punjab national",
          "bandhan",
          "cooperative bank",
          "co operative bank",
          "apex bank",
          "exim",
          "nhb",
          // "Banking & insurance". The insurers are named, rather than inferred
          // from the word "insurance", which ESIC — a health body — also carries.
          "lic",
          "life insurance corporation",
          "niacl",
          "new india assurance",
          "uiic",
          "united india insurance",
          "oicl",
          "oriental insurance",
          "nicl",
          "national insurance",
          "gic",
          "general insurance",
          "irda",
          "irdai",
          "insurance company",
        ),
    },
    { tag: "railway", test: (_r, s) => s.railway },
    {
      tag: "defence",
      test: (r, s) =>
        s.shortService ||
        r.has(
          "army",
          "navy",
          "naval",
          "air force",
          "iaf",
          "afcat",
          "agniveer",
          "agnipath",
          "coast guard",
          "defence",
          "defense",
          "military",
          "nda",
          "cds",
          "territorial army",
          "sainik school",
          "rashtriya military",
          "drdo",
          "ordnance",
          "cantonment",
          "military engineer services",
          "border roads",
          "echs",
          "dgqa",
          "hindustan aeronautics",
          "bharat dynamics",
          "garden reach",
          "mazagon",
          "goa shipyard",
          "cochin shipyard",
          "beml",
          "midhani",
          // The label is "Defence & paramilitary", so the CAPFs belong here as
          // well as under police.
          "capf",
          "crpf",
          "bsf",
          "cisf",
          "itbp",
          "ssb",
          "assam rifles",
          "nsg",
          "paramilitary",
        ),
    },
    {
      tag: "teaching",
      test: (r) =>
        r.has(
          // The post.
          "teacher",
          "teachers",
          "teaching",
          "professor",
          "lecturer",
          "faculty",
          "tgt",
          "pgt",
          "prt",
          "principal",
          "headmaster",
          "instructor",
          "tutor",
          "tet",
          "ctet",
          "shikshan",
          "shikshak",
          "adhyapak",
          "academic",
          // The employer — an education-sector body, whoever the post is for.
          "university",
          "college",
          "school",
          "vidyalaya",
          "vidyapeeth",
          "mahavidyalaya",
          "kvs",
          "nvs",
          "navodaya",
          "kendriya",
          "institute of technology",
          "institute of management",
          "iit",
          "nit",
          "iiit",
          "iim",
          "iiser",
          "iisc",
          "education",
          "educational",
          "shiksha",
          "ncert",
          "ugc",
          "aicte",
          "cbse",
        ),
    },
    {
      tag: "engineering",
      test: (r) =>
        r.has(
          "engineer",
          "engineers",
          "engineering",
          "je",
          "ae",
          "aee",
          "technician",
          "technical assistant",
          "draftsman",
          "draughtsman",
          "overseer",
          "surveyor",
          "foreman",
          "b tech",
          "polytechnic",
          "electrician",
          "fitter",
          "machinist",
          "welder",
          "lineman",
          "architect",
        ),
    },
    {
      tag: "medical",
      test: (r) =>
        r.has(
          "medical",
          "doctor",
          "mbbs",
          "bds",
          "dental",
          "dentist",
          "nurse",
          "nursing",
          "gnm",
          "anm",
          "pharmacist",
          "pharmacy",
          "hospital",
          "health",
          "aiims",
          "esic",
          "pgimer",
          "jipmer",
          "nimhans",
          "icmr",
          "ayush",
          "bams",
          "bhms",
          "bums",
          "homoeopathy",
          "ayurved",
          "ayurveda",
          "unani",
          "paramedical",
          "radiographer",
          "radiology",
          "radiologist",
          "cancer",
          "oncology",
          "physiotherapist",
          "physiotherapy",
          "lab technician",
          "laboratory technician",
          "senior resident",
          "junior resident",
          "surgeon",
          "veterinary",
          "dispensary",
          "sanitary",
          "asha",
        ),
    },
    {
      tag: "police",
      test: (r) =>
        r.has(
          "police",
          "constable",
          "sub inspector",
          "head constable",
          "asi",
          "capf",
          "crpf",
          "bsf",
          "cisf",
          "itbp",
          "ssb",
          "rpf",
          "assam rifles",
          "nsg",
          "home guard",
          "homeguard",
          "jail",
          "prison",
          "warder",
          "excise",
          "vigilance",
          "forensic",
          "chowkidar",
        ) ||
        // "Security Officer" is a security post; "Chief Information Security
        // Officer" is an IT one wearing the same word.
        (r.has("security") &&
          !r.has(
            "information security",
            "cyber security",
            "cybersecurity",
            "network security",
          )),
    },
    {
      tag: "clerical",
      test: (r) =>
        r.has(
          "clerk",
          "clerks",
          "clerkship",
          "clerical",
          "ldc",
          "udc",
          "lower division",
          "upper division",
          "office assistant",
          "office attendant",
          "junior assistant",
          "senior assistant",
          "assistant grade",
          "stenographer",
          "steno",
          "typist",
          "data entry",
          "computer operator",
          "mts",
          "multi tasking",
          "multitasking",
          "peon",
          "sevadar",
          "sahayak",
          "accountant",
          "cashier",
          "store keeper",
          "storekeeper",
        ),
    },
    {
      tag: "central-govt",
      test: (r, s) =>
        r.has("upsc", "union public service commission") ||
        (r.has("ssc", "staff selection commission") && !s.shortService && !isStateBody(r)) ||
        r.has(
          "government of india",
          "govt of india",
          "ministry of",
          "india post",
          "postal",
          "gramin dak sevak",
          "epfo",
          "income tax",
          "cbic",
          "cbdt",
          "customs",
          "central government",
          "central govt",
          "comptroller and auditor",
          "intelligence bureau",
          "election commission",
          "niti aayog",
          "csir",
          "icar",
          "isro",
        ),
    },
    { tag: "state-govt", test: (r) => isStateBody(r) },
    {
      tag: "psu",
      test: (r, s) =>
        // "RRB NTPC" is Non-Technical Popular Categories, a railway exam — not
        // the National Thermal Power Corporation.
        (r.has("ntpc") && !s.railway) ||
        r.has(
          "bhel",
          "gail",
          "ongc",
          "iocl",
          "indian oil",
          "bpcl",
          "hpcl",
          "coal india",
          "sail",
          "steel authority",
          "pgcil",
          "powergrid",
          "power grid",
          "nhpc",
          "sjvn",
          "nlc",
          "npcil",
          "nuclear power",
          "bharat electronics",
          "ecil",
          "bsnl",
          "mtnl",
          "becil",
          "wapcos",
          "engineers india",
          "nbcc",
          "mmtc",
          "food corporation",
          "airports authority",
          "nhai",
          "nhidcl",
          "public sector",
          "maharatna",
          "navratna",
          "mini ratna",
          "miniratna",
          "nigam",
          "corporation limited",
          "india limited",
          "shipyard",
          "refinery",
        ),
    },
    {
      tag: "judiciary",
      test: (r) =>
        r.has(
          "court",
          "courts",
          "judge",
          "judicial",
          "judiciary",
          "tribunal",
          "legal",
          "advocate",
          "prosecutor",
          "magistrate",
          "nyayalaya",
          "lok adalat",
          "law officer",
          "law clerk",
          "public prosecutor",
        ),
    },
  ];

/**
 * The sector tags for a posting, in `SECTORS` order.
 *
 * The order is stable so a re-run produces an identical array and ingestion's
 * content hash does not report an unchanged row as changed.
 */
export function sectorTagsOf(subject: SectorSubject): SectorTag[] {
  const r = reader(subject);
  const s = senses(r);
  return RULES.filter((rule) => rule.test(r, s)).map((rule) => rule.tag);
}
