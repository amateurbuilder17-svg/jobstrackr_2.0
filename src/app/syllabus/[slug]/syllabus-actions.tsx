"use client";

import { useState } from "react";

import { FileIcon, ShareIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { Syllabus } from "@/lib/syllabus/schema";

import { toPlainText } from "./present";

/**
 * Download · Share, the old result screen's two header actions.
 *
 * Both are the old app's behaviour with one change each. The print sheet is
 * loaded on click rather than with the page — it is a full stylesheet and a
 * document builder, and it should not be in the first load of a page that is
 * mostly read and rarely printed. And sharing falls back to copying the *link*
 * with the summary text, rather than only the link, so a paste into a chat that
 * strips previews still carries something readable.
 */
export function SyllabusActions({ syllabus, slug }: { syllabus: Syllabus; slug: string }) {
  const [message, setMessage] = useState("");

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => {
          void print();
        }}
        aria-label={`Download the ${syllabus.examName} syllabus`}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3",
          "text-xs font-semibold text-ink-2 shadow-xs transition-colors",
          "hover:border-line-strong hover:text-ink",
        )}
      >
        <FileIcon className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">PDF</span>
      </button>

      <button
        type="button"
        onClick={() => {
          void share();
        }}
        aria-label={`Share the ${syllabus.examName} syllabus`}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3",
          "text-xs font-semibold text-ink-2 shadow-xs transition-colors",
          "hover:border-line-strong hover:text-ink",
        )}
      >
        <ShareIcon className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Share</span>
      </button>

      {/* Same convention as the job page: announced, not toasted. */}
      <span aria-live="polite" className="sr-only">
        {message}
      </span>
      {message ? (
        <span className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-bg shadow-lg">
          {message}
        </span>
      ) : null}
    </div>
  );

  async function print() {
    const { buildPrintSheet } = await import("./print-sheet");

    // The old app opened a popup and `document.write` into it. An offscreen
    // iframe with `srcdoc` does the same job without either: no popup blocker
    // to lose the sheet to on mobile Safari, and no deprecated API. It is
    // same-origin, so `contentWindow.print()` opens the browser's own print
    // dialog with "Save as PDF" in it.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.srcdoc = buildPrintSheet(syllabus);

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        say("Could not open the print view");
        return;
      }
      // Printing before the stylesheet applies produces an unstyled sheet in
      // Chrome, hence the frame after load rather than the load itself.
      setTimeout(() => {
        win.focus();
        win.print();
        // `print()` is modal in every browser that has it, so this runs once
        // the dialog closes. The delay covers the ones where it is not.
        setTimeout(() => {
          frame.remove();
        }, 1000);
      }, 300);
    };

    document.body.appendChild(frame);
  }

  async function share() {
    const url = `${window.location.origin}/syllabus/${slug}`;
    const title = `${syllabus.examName} — Syllabus`;

    // Checked as a function, not for truthiness: the DOM types declare it
    // unconditionally but it is absent on desktop Firefox and outside a secure
    // context.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `Syllabus for ${syllabus.examName}`, url });
        return;
      } catch {
        // Dismissing the sheet throws AbortError, which is not a failure —
        // fall through to the clipboard rather than reporting anything.
      }
    }

    try {
      await navigator.clipboard.writeText(`${toPlainText(syllabus)}\n\n${url}`);
      say("Syllabus copied");
    } catch {
      say("Could not copy the syllabus");
    }
  }

  function say(text: string) {
    setMessage(text);
    setTimeout(() => {
      setMessage("");
    }, 2200);
  }
}
