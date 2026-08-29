/**
 * The ten questions, carried across from the old project.
 *
 * Deliberately apart from `exams.ts`: this is a couple of kilobytes and the
 * runner needs it to draw the first screen, while the catalogue is ~30 kB and
 * is not needed until there are answers to score. See the note in `exams.ts`.
 */

export interface QuizOption {
  value: string;
  label: string;
  sub: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  emoji: string;
  type: "single" | "multi";
  options: QuizOption[];
}

export const QUESTIONS: QuizQuestion[] = [
  {
    id: "education",
    question: "What's your highest education?",
    emoji: "🎓",
    type: "single",
    options: [
      { value: "10th", label: "10th Pass", sub: "Matriculation" },
      { value: "12th", label: "12th Pass", sub: "Intermediate / HSC" },
      { value: "diploma", label: "Diploma / ITI", sub: "Polytechnic or trade certificate" },
      { value: "btech", label: "B.Tech / B.E", sub: "Engineering degree" },
      { value: "bsc", label: "B.Sc", sub: "Science graduate" },
      { value: "ba", label: "B.A", sub: "Arts / Humanities graduate" },
      { value: "bcom", label: "B.Com / BBA / BCA", sub: "Commerce / Management graduate" },
      { value: "llb", label: "LLB / BA LLB", sub: "Law degree" },
      { value: "graduate", label: "Other Graduate", sub: "Any other bachelor's degree" },
      { value: "pg", label: "Post Graduate / PhD", sub: "Masters, M.Tech, LLM, MBA etc." },
    ],
  },
  {
    id: "age",
    question: "How old are you?",
    emoji: "🎂",
    type: "single",
    options: [
      { value: "17", label: "Under 18", sub: "Currently in school / 12th" },
      { value: "19", label: "18 – 21", sub: "Just started college or freshly graduated" },
      { value: "23", label: "22 – 25", sub: "Recent graduate" },
      { value: "27", label: "26 – 30", sub: "Working or preparing" },
      { value: "33", label: "31 – 35", sub: "Experienced aspirant" },
      { value: "38", label: "36+", sub: "SC/ST/OBC age relaxation may apply" },
    ],
  },
  {
    id: "category",
    question: "Your reservation category?",
    emoji: "📋",
    type: "single",
    options: [
      { value: "general", label: "General / UR", sub: "No reservation benefit" },
      { value: "obc", label: "OBC", sub: "+3 years age relaxation" },
      { value: "sc", label: "SC", sub: "+5 years age relaxation" },
      { value: "st", label: "ST", sub: "+5 years age relaxation" },
      { value: "ews", label: "EWS", sub: "Economically Weaker Section" },
    ],
  },
  {
    id: "location",
    question: "Where do you want to be posted?",
    emoji: "📍",
    type: "single",
    options: [
      { value: "home_state", label: "My home state only", sub: "State PSC, RRB, state police" },
      { value: "any", label: "Anywhere in India", sub: "Central govt, UPSC, SSC" },
      { value: "metro", label: "Metro city preferred", sub: "Banks, insurance, SEBI, RBI" },
    ],
  },
  {
    id: "sectors",
    question: "Which sectors interest you?",
    emoji: "🏛️",
    type: "multi",
    options: [
      {
        value: "administration",
        label: "Administration / Civil Services",
        sub: "IAS, SDM, BDO",
      },
      { value: "banking", label: "Banking & Finance", sub: "SBI, IBPS, RBI" },
      { value: "railways", label: "Railways", sub: "RRB, Indian Railways" },
      { value: "defence", label: "Defence / Armed Forces", sub: "Army, Navy, Air Force" },
      { value: "police", label: "Police / Paramilitary", sub: "BSF, CRPF, State Police" },
      { value: "teaching", label: "Teaching / Education", sub: "KVS, NVS, CTET" },
      { value: "engineering", label: "Engineering / Technical", sub: "ISRO, DRDO, SSC JE" },
      { value: "law", label: "Law / Judiciary", sub: "APO, Legal Officer" },
      { value: "insurance", label: "Insurance", sub: "LIC, GIC" },
      { value: "rural", label: "Rural / Agriculture", sub: "NABARD, RRB" },
    ],
  },
  {
    id: "interests",
    question: "What subjects are you strong in?",
    emoji: "📚",
    type: "multi",
    options: [
      {
        value: "maths",
        label: "Maths & Quantitative Aptitude",
        sub: "Numbers, data interpretation",
      },
      { value: "reasoning", label: "Logical Reasoning", sub: "Puzzles, verbal non-verbal" },
      { value: "gk", label: "General Knowledge", sub: "Current affairs, static GK" },
      { value: "english", label: "English", sub: "Reading, grammar, writing" },
      { value: "polity", label: "Polity & Governance", sub: "Constitution, public admin" },
      { value: "science", label: "Science & Technology", sub: "Physics, chemistry, bio" },
      { value: "law", label: "Law & Legal Studies", sub: "Constitution, IPC, contracts" },
      { value: "technical", label: "Engineering / Technical", sub: "Core branch subjects" },
      { value: "physical", label: "Physical Fitness", sub: "Comfortable with PET/PST" },
    ],
  },
  {
    id: "salary",
    question: "Minimum monthly salary expected?",
    emoji: "💰",
    type: "single",
    options: [
      { value: "15000", label: "₹15,000+", sub: "Any govt job is fine" },
      { value: "25000", label: "₹25,000+", sub: "SSC, Railways level" },
      { value: "35000", label: "₹35,000+", sub: "Banking clerk / PO level" },
      { value: "50000", label: "₹50,000+", sub: "Group A / officer level" },
      { value: "70000", label: "₹70,000+", sub: "RBI, UPSC, ISRO level" },
    ],
  },
  {
    id: "studyTime",
    question: "How many hours can you study daily?",
    emoji: "⏰",
    type: "single",
    options: [
      { value: "1", label: "1–2 hours", sub: "Side prep alongside job / college" },
      { value: "3", label: "3–4 hours", sub: "Regular part-time preparation" },
      { value: "6", label: "5–6 hours", sub: "Serious full-time preparation" },
      { value: "8", label: "7+ hours", sub: "100% dedicated exam preparation" },
    ],
  },
  {
    id: "difficulty",
    question: "What's your timeline?",
    emoji: "🎯",
    type: "single",
    options: [
      { value: "easy", label: "Get a job fast", sub: "1–3 months prep, easy exam" },
      { value: "medium", label: "6–12 months prep", sub: "Balanced effort and reward" },
      { value: "hard", label: "2–3 years, top post", sub: "Prestige over speed, UPSC-level" },
    ],
  },
  {
    id: "language",
    question: "Which language will you write the exam in?",
    emoji: "🗣️",
    type: "single",
    options: [
      { value: "hindi", label: "Hindi", sub: "Hindi medium preparation" },
      { value: "english", label: "English", sub: "English medium preparation" },
      {
        value: "regional",
        label: "Regional language",
        sub: "Odia, Tamil, Telugu, Marathi etc.",
      },
      { value: "any", label: "Flexible", sub: "Comfortable in multiple languages" },
    ],
  },
];
