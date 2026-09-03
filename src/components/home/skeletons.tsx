import { cn } from "@/lib/cn";

export function SectionHeaderSkeleton({
  titleWidth = "w-32",
  hasSubtitle = true,
  hasAction = true,
}: {
  titleWidth?: string;
  hasSubtitle?: boolean;
  hasAction?: boolean;
}) {
  return (
    <div
      className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 sm:mb-3.5 sm:gap-3"
      aria-hidden="true"
    >
      <div className="flex min-w-0 gap-2.5 sm:gap-3">
        <span className="mt-0.5 w-[3px] shrink-0 rounded-full bg-brand/40" />
        <div className="min-w-0 space-y-1.5">
          <div className={cn("skeleton h-4 sm:h-5", titleWidth)} />
          {hasSubtitle ? <div className="skeleton h-3 w-40 sm:h-3.5 sm:w-48" /> : null}
        </div>
      </div>
      {hasAction ? <div className="skeleton h-4 w-16" /> : null}
    </div>
  );
}

export function TrackedExamsSkeleton() {
  return (
    <section aria-label="Loading your exams" className="animate-in fade-in duration-200">
      <SectionHeaderSkeleton titleWidth="w-28" />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar scroll-pl-4 scroll-px-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="w-[clamp(15rem,72vw,18rem)] shrink-0 rounded-2xl border border-border bg-card p-3 shadow-card sm:p-3.5"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 sm:gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="skeleton size-[clamp(2rem,7.5vw,2.25rem)] rounded-xl" />
                  <div className="skeleton h-4 w-16 rounded-full" />
                </div>
                <div className="skeleton h-4 w-36" />
                <div className="skeleton h-3 w-20" />
              </div>
              <div className="skeleton size-[clamp(2.25rem,8.5vw,2.5rem)] shrink-0 rounded-full" />
            </div>
            <div className="skeleton mt-2.5 h-3 w-28 border-t border-border/50 pt-2" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ClosingSoonSkeleton() {
  return (
    <section
      aria-label="Loading closing soon recruitments"
      className="animate-in fade-in duration-200"
    >
      <SectionHeaderSkeleton titleWidth="w-28" />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar scroll-pl-4 scroll-px-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="w-[clamp(17rem,80vw,20rem)] shrink-0 rounded-2xl border border-brand/25 bg-brand-soft/70 p-3 shadow-card sm:p-3.5"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="skeleton size-[clamp(2rem,7.5vw,2.25rem)] rounded-xl" />
                <div className="skeleton h-3.5 w-28" />
              </div>
              <div className="skeleton h-5 w-20 rounded-full shrink-0" />
            </div>

            <div className="skeleton mt-2 h-4.5 w-4/5" />
            <div className="skeleton mt-1 h-3.5 w-3/5" />

            <div className="skeleton mt-2.5 h-8 w-full rounded-xl" />

            <div className="skeleton mt-2.5 h-3.5 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function JustPublishedSkeleton() {
  return (
    <section
      aria-label="Loading just published recruitments"
      className="animate-in fade-in duration-200"
    >
      <SectionHeaderSkeleton titleWidth="w-28" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 sm:gap-3">
              <div className="skeleton size-[clamp(2rem,7.5vw,2.25rem)] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-3 w-2/5" />
                <div className="skeleton h-5 w-24 rounded-full" />
              </div>
              <div className="skeleton mt-1 size-[clamp(0.875rem,3.4vw,1rem)] shrink-0 rounded-xs" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PopularExamsSkeleton() {
  return (
    <section aria-label="Loading popular exams" className="animate-in fade-in duration-200">
      <SectionHeaderSkeleton titleWidth="w-28" hasAction={false} />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar scroll-pl-4 scroll-px-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex w-[clamp(7.25rem,33vw,8.75rem)] shrink-0 flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-card sm:p-3.5"
          >
            <div className="skeleton size-[clamp(2rem,7.5vw,2.25rem)] rounded-xl" />
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-3 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function LatestUpdatesSkeleton() {
  return (
    <section aria-label="Loading exam updates" className="animate-in fade-in duration-200">
      <SectionHeaderSkeleton titleWidth="w-32" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 sm:gap-3">
              <div className="skeleton size-[clamp(2rem,7.5vw,2.25rem)] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="skeleton h-4 w-16 rounded-full" />
                  <div className="skeleton h-3 w-20" />
                </div>
                <div className="skeleton h-4 w-4/5" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-3 w-2/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MatchedForYouSkeleton() {
  return (
    <section
      aria-label="Loading matched recruitments"
      className="animate-in fade-in duration-200"
    >
      <SectionHeaderSkeleton titleWidth="w-44" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-3.5 shadow-card sm:p-4"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 sm:gap-3">
              <div className="skeleton size-[clamp(2rem,7.5vw,2.25rem)] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="skeleton h-4 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
                <div className="skeleton h-3 w-2/5" />
                <div className="skeleton h-5 w-24 rounded-full" />
              </div>
              <div className="skeleton mt-1 size-[clamp(0.875rem,3.4vw,1rem)] shrink-0 rounded-xs" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end px-2 py-1.5">
        <div className="skeleton h-4 w-40" />
      </div>
    </section>
  );
}
