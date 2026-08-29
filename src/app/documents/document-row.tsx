"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CheckIcon, FileIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  acceptFieldsAction,
  deleteDocumentAction,
  getSuggestionsAction,
  runOcrAction,
} from "@/lib/documents/actions";
import type { Suggestion } from "@/lib/documents/fields";

/**
 * One uploaded document, and everything you can do with it.
 *
 * The review step is the point of the whole feature and the reason nothing here
 * is automatic. A model reading a photograph gets things wrong — a `5` for an
 * `S`, a father's name in the name field — and the old app's flow wrote the
 * result into the profile and then offered a "conflict modal" to sort out
 * afterwards. This asks first: every field is a checkbox showing what it would
 * replace, and only ticked ones are written.
 *
 * Suggestions are fetched on demand rather than rendered with the page. They
 * contain somebody's identity details, and there is no reason for them to be in
 * the HTML of a list they have not opened yet.
 */

interface Doc {
  id: string;
  kind: string;
  label: string;
  status: string;
  error: string | null;
  reviewed: boolean;
  createdAt: string;
}

export function DocumentRow({ doc }: { doc: Doc }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "read" | "delete" | "save">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(doc.error);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  async function read() {
    setBusy("read");
    setError(null);
    setMessage(null);
    const result = await runOcrAction(doc.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(result.message ?? null);
    await review();
    router.refresh();
  }

  async function review() {
    const found = await getSuggestionsAction(doc.id);
    setSuggestions(found);
    // Everything ticked by default. The common case is that the reading is
    // right, and making somebody tick eight boxes to accept a correct answer is
    // the kind of friction that gets a feature abandoned — while unticking the
    // one wrong line is quick.
    setChosen(new Set(found.map((s) => s.key)));
  }

  async function save() {
    setBusy("save");
    const result = await acceptFieldsAction(doc.id, [...chosen]);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(result.message ?? null);
    setSuggestions(null);
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    const result = await deleteDocumentAction(doc.id);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <li className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <FileIcon className="mt-0.5 size-[1.15rem] shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{doc.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <time dateTime={doc.createdAt}>{formatDate(doc.createdAt)}</time>
            <StatusBadge status={doc.status} reviewed={doc.reviewed} />
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 text-sm text-critical">
          {error}
        </p>
      ) : null}
      {message && !suggestions ? (
        <p role="status" className="mt-2.5 text-sm text-accent">
          {message}
        </p>
      ) : null}

      {suggestions ? (
        <div className="mt-3 rounded-md border border-line bg-surface-2 p-3">
          {suggestions.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nothing in this one that is new to your profile.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">
                Found {suggestions.length} field{suggestions.length === 1 ? "" : "s"}. Untick
                anything that looks wrong.
              </p>
              <ul className="mt-2.5 flex flex-col gap-1">
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface">
                      <input
                        type="checkbox"
                        checked={chosen.has(s.key)}
                        onChange={(event) => {
                          setChosen((prev) => {
                            const next = new Set(prev);
                            if (event.target.checked) next.add(s.key);
                            else next.delete(s.key);
                            return next;
                          });
                        }}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-ink-3">
                          {s.label}
                          {s.education ? " · education" : ""}
                        </span>
                        <span className="block text-sm text-ink">
                          {s.current ? (
                            <>
                              <span className="text-ink-3 line-through">{s.current}</span>
                              <span className="mx-1.5 text-ink-3">→</span>
                            </>
                          ) : null}
                          {String(s.value)}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy !== null || chosen.size === 0}
                  onClick={() => void save()}
                >
                  <CheckIcon className="size-3.5" />
                  {busy === "save" ? "Saving…" : `Save ${String(chosen.size)}`}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSuggestions(null);
                  }}
                >
                  Not now
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {doc.status === "done" && !suggestions ? (
          <Button variant="secondary" size="sm" onClick={() => void review()}>
            Review what we found
          </Button>
        ) : null}
        {doc.status !== "done" || doc.reviewed ? (
          <Button
            variant={doc.status === "done" ? "ghost" : "secondary"}
            size="sm"
            disabled={busy !== null}
            onClick={() => void read()}
          >
            {busy === "read" ? "Reading…" : doc.status === "pending" ? "Read it" : "Read again"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void remove()}
          className="text-critical"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </li>
  );
}

function StatusBadge({ status, reviewed }: { status: string; reviewed: boolean }) {
  if (status === "failed") return <Badge tone="critical">Could not read</Badge>;
  if (status === "processing") return <Badge tone="warn">Reading…</Badge>;
  if (status === "done" && !reviewed) return <Badge tone="accent">Needs review</Badge>;
  if (status === "done") return <Badge tone="good">Reviewed</Badge>;
  return <Badge>Not read yet</Badge>;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
