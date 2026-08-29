"use client";

import { useState } from "react";

import { CheckIcon, ShareIcon } from "@/components/icons";

/**
 * Share the app.
 *
 * `navigator.share` where it exists — on Android and iOS that is the system
 * sheet, which is the only way to reach WhatsApp, where this audience actually
 * shares things. Everywhere else, and whenever the sheet is unavailable, the
 * text goes to the clipboard and the row says so.
 *
 * An abort is not a failure. Dismissing the system sheet rejects the promise
 * with `AbortError`, and treating that as an error would copy to the clipboard
 * every time someone changed their mind — the one case where doing nothing is
 * exactly right.
 */
const SHARE_TEXT =
  "JobsTrackr — government job notifications, exam updates and eligibility " +
  "tracking, in one place.\n\nhttps://www.jobstrackr.in/";

/**
 * The Web Share API as it actually exists.
 *
 * The DOM lib declares `share` and `canShare` as always present on `Navigator`.
 * They are not: desktop Firefox has neither, and nor does any browser older
 * than the API. Assigning the real `navigator` to this shape is what makes the
 * feature detection below a genuine check rather than decoration the compiler
 * can see through.
 */
interface ShareCapableNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

export function ShareAppButton({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const data = { title: "JobsTrackr", text: SHARE_TEXT };

    // Narrowed to the view below, where both members are optional. An
    // intersection would not do it — intersecting with `Navigator` keeps the
    // required declarations and the guards lint as dead code.
    const nav: ShareCapableNavigator = navigator;

    if (nav.share && nav.canShare?.(data)) {
      try {
        await nav.share(data);
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        // Anything else — a browser that claims support and then refuses,
        // a permissions policy — falls through to the clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(SHARE_TEXT);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // A clipboard write can be refused outright — Safari without a user
      // gesture it recognises, or a page served over http. There is nothing
      // useful left to try, and a thrown error here would take the menu down
      // with it.
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        void share();
      }}
      className={className}
    >
      {copied ? (
        <CheckIcon className="size-[1.15rem] shrink-0 text-accent" />
      ) : (
        <ShareIcon className="size-[1.15rem] shrink-0 text-ink-3" />
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-ink">
          {copied ? "Link copied" : "Share this app"}
        </span>
        <span className="block truncate text-xs text-ink-3">
          {copied ? "Paste it anywhere" : "Send JobsTrackr to a friend"}
        </span>
      </span>
    </button>
  );
}
