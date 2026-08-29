"use client";

import { useState } from "react";

import { CheckIcon, FileIcon } from "@/components/icons";
import { revealIdAction } from "@/lib/profile/pii-actions";

/**
 * One row: a label, a value, and a button that copies it.
 *
 * Two kinds of row, and the difference is the whole security model of the page.
 *
 * **An ordinary field** already has its value in the HTML. Copying is a
 * clipboard write and nothing else.
 *
 * **An identity number** does not. The page renders `****1234`; pressing copy
 * asks the server for that one value, writes it to the clipboard, and never
 * puts it on screen. The number is in memory for the length of the write and is
 * not stored in component state — a page that had already fetched all three
 * would be holding them for as long as the tab is open, for the sake of a
 * button nobody pressed.
 *
 * The clipboard write happens inside the click handler on purpose. Safari only
 * honours `navigator.clipboard.writeText` during a user gesture, and an `await`
 * before it loses that gesture — so for secret fields the value is fetched
 * first and written in a second, explicit press. That is a real trade (two taps
 * rather than one) made for a real reason: the alternative silently fails to
 * copy on iOS, which is most of this audience.
 */
export function CopyField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string | null;
  secret?: string;
}) {
  const [state, setState] = useState<"idle" | "revealed" | "copied" | "error">("idle");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Held only between the reveal press and the copy press. */
  const [revealed, setRevealed] = useState<string | null>(null);

  const empty = !value;

  async function write(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => {
        setState("idle");
        setRevealed(null);
      }, 2500);
    } catch {
      setState("error");
      setMessage("Could not reach the clipboard. Select the text instead.");
    }
  }

  function onPress() {
    if (empty) return;

    // Plain field: the value is already here.
    if (!secret) {
      void write(value);
      return;
    }

    // Second press — the value is in hand, and this press is the gesture
    // Safari needs.
    if (revealed) {
      void write(revealed);
      return;
    }

    setPending(true);
    setMessage(null);
    void revealIdAction(secret).then((result) => {
      setPending(false);
      if (result.ok) {
        setRevealed(result.value);
        setState("revealed");
        return;
      }
      setState("error");
      setMessage(
        result.reason === "rate_limited"
          ? "Too many at once. Wait a moment."
          : result.reason === "empty"
            ? "Nothing saved for this field."
            : "Could not fetch that. Try again.",
      );
    });
  }

  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-3">{label}</p>
        <p className="truncate text-sm font-medium text-ink">
          {empty ? <span className="font-normal text-ink-3 italic">Not saved</span> : value}
        </p>
        {message ? (
          <p role="alert" className="mt-0.5 text-xs text-critical">
            {message}
          </p>
        ) : null}
      </div>

      {empty ? null : (
        <button
          type="button"
          onClick={onPress}
          disabled={pending}
          aria-label={state === "revealed" ? `Copy ${label} to clipboard` : `Copy ${label}`}
          className={
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line " +
            "bg-surface px-2.5 text-xs font-medium text-ink-2 " +
            "transition-colors duration-(--duration-fast) hover:border-line-strong " +
            "hover:text-ink disabled:opacity-60"
          }
        >
          {state === "copied" ? (
            <>
              <CheckIcon className="size-3.5 text-accent" />
              Copied
            </>
          ) : state === "revealed" ? (
            <>
              <FileIcon className="size-3.5" />
              Copy now
            </>
          ) : pending ? (
            "…"
          ) : (
            <>
              <FileIcon className="size-3.5" />
              Copy
            </>
          )}
        </button>
      )}
    </div>
  );
}
