import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BigCountdown } from "@/components/countdown/big-countdown";
import { NowProvider } from "@/components/countdown/now-provider";
import { absolute } from "@/lib/countdown/remaining";
import { listCountdowns } from "@/lib/db/queries/countdown";

export const metadata: Metadata = {
  title: "Live countdown",
  description: "The next application deadline, counting down.",
  alternates: { canonical: "/countdown/live" },
  // A single-purpose view of data indexed elsewhere; no reason for it to
  // compete with /countdown in results.
  robots: { index: false, follow: true },
};

/**
 * The next deadline, alone on the screen.
 *
 * The old app called this the fullscreen countdown and it was a separate
 * feature with its own route and its own timer. Here it is the same components
 * with fewer of them — which is the point of having built the card and the
 * digits as separate pieces.
 */
export default function LiveCountdownPage() {
  return (
    <div className="mx-auto flex w-full max-w-[46ch] flex-col justify-center px-4 py-14 sm:px-6">
      <Suspense fallback={<div className="h-48 rounded-md border border-line bg-surface-2" />}>
        <Next />
      </Suspense>
    </div>
  );
}

async function Next() {
  const [item] = await listCountdowns(1);

  if (!item) {
    return (
      <p className="text-center text-ink-2">
        Nothing is closing right now.{" "}
        <Link href="/jobs" className="font-medium text-accent hover:underline">
          Browse jobs
        </Link>
      </p>
    );
  }

  return (
    <div className="text-center">
      <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">{item.label}</p>
      <h1 className="mt-1.5 font-cond text-2xl font-bold tracking-tight text-balance text-ink">
        {item.title}
      </h1>
      <p className="mt-1 text-sm text-ink-3">
        <time dateTime={item.at}>{absolute(item.at)}</time>
      </p>

      <div className="mt-7 text-left">
        <NowProvider>
          <BigCountdown at={item.at} label={item.label} />
        </NowProvider>
      </div>

      <p className="mt-8 flex justify-center gap-4 text-sm">
        <Link href={item.href} className="font-medium text-accent hover:underline">
          Read the notification
        </Link>
        <Link href="/countdown" className="font-medium text-accent hover:underline">
          All countdowns
        </Link>
      </p>
    </div>
  );
}
