import {
  CalendarIcon,
  ClockIcon,
  CreditCardIcon,
  GraduationCapIcon,
  MapPinIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";
import { decodeEntities, truncateWords } from "@/lib/format/text";

/**
 * How much of `qualification_summary` a grid cell will carry.
 *
 * The median summary is 14 words; the top decile is 109 and the longest in
 * production is 1,177, because the scrapers flatten whole post-wise
 * eligibility tables into this column. Left unclamped, one such row stretches
 * the card to several screens on desktop and buries the eight facts beside it.
 *
 * 16 words fits the narrowest cell (a third of the column at `sm`) in four
 * lines and still carries a real answer — "Bachelor's degree in Engineering
 * from a recognised university" survives whole. Anything longer is prose, and
 * prose belongs in the Eligibility section, which is where the cell points.
 */
const QUALIFICATION_WORDS = 16;

/** Whether the summary is long enough that the cell will clamp it. */
export function isLongQualification(value: string | null): boolean {
  return value !== null && truncateWords(value, QUALIFICATION_WORDS) !== null;
}

export interface JobDetailGridProps {
  vacancies: string | null;
  salary: string | null;
  qualification: string | null;
  ageLimit: string | null;
  location: string | null;
  fee: string | null;
  opensOn: string | null;
  closesOn: string | null;
  admitCard: string | null;
}

export function JobDetailGrid({
  vacancies,
  salary,
  qualification,
  ageLimit,
  location,
  fee,
  opensOn,
  closesOn,
  admitCard,
}: JobDetailGridProps) {
  // The cell carries the opening of a long summary and hands the rest to the
  // Eligibility section below, rather than printing 1,177 words in a box
  // sized for two lines.
  const fullQualification = qualification?.trim() ? decodeEntities(qualification.trim()) : null;
  const clipped = fullQualification
    ? truncateWords(fullQualification, QUALIFICATION_WORDS)
    : null;
  const qualificationText = clipped ?? fullQualification;
  const clamped = clipped !== null;

  const leftItems = [
    {
      icon: <UserIcon className="size-4 sm:size-4.5" aria-hidden="true" />,
      label: "Age limit",
      value: ageLimit ?? "As per rules",
    },
    {
      icon: <CalendarIcon className="size-4 sm:size-4.5" aria-hidden="true" />,
      label: "Opens on",
      value: opensOn ?? "Announced",
    },
    {
      icon: <CreditCardIcon className="size-4 sm:size-4.5" aria-hidden="true" />,
      label: "Application fee",
      value: fee ?? "Check details",
    },
  ];

  const rightItems = [
    {
      icon: <MapPinIcon className="size-4 sm:size-4.5" aria-hidden="true" />,
      label: "Location",
      value: location ?? "All India",
    },
    {
      icon: <CalendarIcon className="size-4 sm:size-4.5" aria-hidden="true" />,
      label: "Closes on",
      value: closesOn ?? "Not announced",
    },
    {
      icon: <ClockIcon className="size-4 sm:size-4.5" aria-hidden="true" />,
      label: "Admit card",
      value: admitCard ?? "To be announced",
    },
  ];

  return (
    <div className="mt-6 space-y-3">
      {/* Upper Box: Responsive layout ensuring all contents are fully visible without truncation */}
      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-xs">
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4">
          {/* Vacancies */}
          <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
            <div className="flex size-9.5 sm:size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand dark:bg-brand-soft/20 mt-0.5">
              <UsersIcon className="size-4 sm:size-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs text-ink-3 leading-none">Vacancies</p>
              <p className="mt-1 text-xs sm:text-sm font-bold text-ink leading-snug break-words">
                {vacancies ?? "Check notice"}
              </p>
            </div>
          </div>

          {/* Salary */}
          <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
            <div className="flex size-9.5 sm:size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand dark:bg-brand-soft/20 font-bold text-xs sm:text-sm mt-0.5">
              ₹
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs text-ink-3 leading-none">Salary</p>
              <p className="mt-1 text-xs sm:text-sm font-bold text-ink leading-snug break-words">
                {salary ?? "As per rules"}
              </p>
            </div>
          </div>

          {/* Qualification: Spans full width across 2 columns on mobile, 1 column on desktop */}
          <div className="col-span-2 sm:col-span-1 flex items-start gap-2.5 sm:gap-3 min-w-0 border-t border-line/60 pt-3 sm:border-t-0 sm:pt-0">
            <div className="flex size-9.5 sm:size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand dark:bg-brand-soft/20 mt-0.5">
              <GraduationCapIcon className="size-4 sm:size-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs text-ink-3 leading-none">Qualification</p>
              {/* Mobile: full qualification text without truncation */}
              <p className="mt-1 text-xs font-bold text-ink leading-snug break-words sm:hidden">
                {fullQualification ?? "Check notice"}
              </p>
              {/* Desktop: truncated to QUALIFICATION_WORDS when long, with line-clamp safeguard */}
              <p className="mt-1 hidden sm:block sm:line-clamp-4 text-xs sm:text-sm font-bold text-ink leading-snug break-words">
                {qualificationText ?? "Check notice"}
              </p>
              {/* Only when something was cut, on desktop pointing to the Eligibility section */}
              {clamped ? (
                <a
                  href="#eligibility"
                  className="mt-1 hidden sm:inline-block text-[11px] sm:text-xs font-semibold text-brand transition-colors hover:text-ink"
                >
                  Read in full
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Lower Box: 2-column layout without middle icons, ensuring full text visibility */}
      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-8 sm:gap-y-5">
          {/* Left Column */}
          <div className="space-y-4 sm:space-y-5">
            {leftItems.map((item) => (
              <div key={item.label} className="flex items-start gap-2.5 sm:gap-3 min-w-0">
                <div className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand dark:bg-brand-soft/20 mt-0.5">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] sm:text-xs text-ink-3 leading-none">{item.label}</p>
                  <p className="mt-1 text-xs sm:text-sm font-bold text-ink leading-snug break-words">
                    {item.value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Right Column */}
          <div className="space-y-4 sm:space-y-5">
            {rightItems.map((item) => (
              <div key={item.label} className="flex items-start gap-2.5 sm:gap-3 min-w-0">
                <div className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand dark:bg-brand-soft/20 mt-0.5">
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] sm:text-xs text-ink-3 leading-none">{item.label}</p>
                  <p className="mt-1 text-xs sm:text-sm font-bold text-ink leading-snug break-words">
                    {item.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
