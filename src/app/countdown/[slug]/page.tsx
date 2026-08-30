import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BigCountdown } from "@/components/countdown/big-countdown";
import { NowProvider } from "@/components/countdown/now-provider";
import { ChevronRightIcon, TimerIcon } from "@/components/icons";
import { ShareAppButton } from "@/components/shell/share-app-button";
import { absolute } from "@/lib/countdown/remaining";
import { getCountdown } from "@/lib/db/queries/countdown";
import { listJobSlugsForBuild } from "@/lib/db/queries/jobs";

/**
 * One countdown, big, shareable.
 *
 * `generateStaticParams` over the job slugs — unlike `/syllabus/[slug]`, these
 * params exist at build time, so this route prerenders properly and needs no
 * `instant = false`. Every prerendered page carries the absolute date; the
 * digits fill in on hydration.
 */
export async function generateStaticParams() {
  const slugs = await listJobSlugsForBuild();
  return slugs.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = await getCountdown(slug);
  if (!item) return { title: "Countdown not found" };

  return {
    title: `${item.title} — countdown`,
    description: `${item.label} on ${absolute(item.at)}. Counting down live.`,
    alternates: { canonical: `/countdown/${slug}` },
  };
}

export default async function CountdownDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getCountdown(slug);
  if (!item) notFound();

  return (
    <div className="mx-auto w-full max-w-[56ch] px-4 py-10 sm:px-6 lg:py-14">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-3">
        <Link href="/countdown" className="hover:text-ink-2 hover:underline">
          Countdown
        </Link>
      </nav>

      <p className="mt-3 text-2xs font-medium tracking-wide text-ink-3 uppercase">
        {item.label}
        {item.organization ? ` · ${item.organization}` : ""}
      </p>
      <h1 className="mt-1 font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        {item.title}
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        <time dateTime={item.at}>{absolute(item.at)}</time>, 23:59 IST
      </p>

      <div className="mt-7">
        <NowProvider>
          <BigCountdown at={item.at} label={item.label} />
        </NowProvider>
      </div>

      <div className="mt-8 flex flex-col gap-1 border-t border-line pt-6">
        <Link
          href={item.href}
          className={
            "flex items-center gap-3 rounded-md px-3 py-2.5 " +
            "transition-colors duration-(--duration-fast) hover:bg-surface-2"
          }
        >
          <TimerIcon className="size-[1.15rem] shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 text-sm font-medium text-ink">
            {item.kind === "job" ? "Read the notification" : "See updates for this exam"}
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-ink-3" />
        </Link>
        <ShareAppButton
          className={
            "flex w-full items-center gap-3 rounded-md px-3 py-2.5 " +
            "transition-colors duration-(--duration-fast) hover:bg-surface-2"
          }
        />
      </div>
    </div>
  );
}
