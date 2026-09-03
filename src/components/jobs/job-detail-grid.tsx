import {
  CalendarIcon,
  ClockIcon,
  CreditCardIcon,
  GraduationCapIcon,
  MapPinIcon,
  UserIcon,
  UsersIcon,
} from "@/components/icons";

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
              <p className="mt-1 text-xs sm:text-sm font-bold text-ink leading-snug break-words">
                {qualification ?? "Check notice"}
              </p>
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
