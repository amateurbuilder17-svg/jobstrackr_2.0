import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SignInRequired } from "@/components/auth/sign-in-required";
import { ScanTextIcon } from "@/components/icons";
import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { DOCUMENT_TYPES } from "@/lib/ai/prompts/ocr";
import { DocumentRow } from "./document-row";
import { Uploader } from "./uploader";

export const metadata: Metadata = {
  title: "Scan a document",
  description: "Photograph a marksheet or ID and fill your profile from what it says.",
  robots: { index: false, follow: false },
};

/**
 * Scan a document.
 *
 * The old app called this "Your documents", which described a filing cabinet
 * rather than what people come here to do: photograph a certificate once and
 * stop typing the same twelve fields into every application.
 *
 * Nothing read from a document is written anywhere until its owner has seen it
 * field by field and ticked it. That is the whole shape of the feature and the
 * reason the review step is not a convenience — a model reading a photograph
 * gets things wrong, and the failure mode of writing first is a profile that
 * quietly disagrees with the certificate it came from.
 */
export default function DocumentsPage() {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        Scan a document
      </h1>
      <p className="mt-4 leading-relaxed text-ink-2">
        Photograph a marksheet, an ID or a certificate and we read the details out of it. You
        see everything it found and choose what to keep — nothing is saved to your profile until
        you say so.
      </p>

      {/* The uploader moved inside the boundary with the list. It writes to one
          account — a signed URL issued from the session — so showing it to a
          guest offers a button that can only fail; both halves are replaced by
          the sign-in card instead. */}
      <Suspense fallback={<BodySkeleton />}>
        <Documents />
      </Suspense>

      <p className="mt-10 border-t border-line pt-6 text-sm leading-relaxed text-ink-3">
        Your files are private to your account and are never shared. Delete one and both the
        file and everything read from it go with it. Once your profile is filled in,{" "}
        <Link href="/my-details" className="font-medium text-accent hover:underline">
          Copy my details
        </Link>{" "}
        gives you every field with one tap.
      </p>
    </div>
  );
}

async function Documents() {
  // Before the signed-URL call and before the list query, so a guest triggers
  // neither.
  const user = await getUser();
  if (!user) {
    return (
      <SignInRequired
        title="Sign in to scan a document"
        description="Your scans and everything read from them are private to your account, so this one needs you signed in."
        next="/documents"
        icon={ScanTextIcon}
      />
    );
  }

  const db = await sessionDb();

  const { data } = await db
    .from("documents")
    .select("id, kind, label, ocr_status, ocr_error, reviewed_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const documents = data ?? [];

  return (
    <>
      <Uploader />

      {documents.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="font-semibold text-ink">Nothing uploaded yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-3">
            A clear photo of one page works best. Flat, in good light, with all four corners in
            frame.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={{
                id: doc.id,
                kind: doc.kind,
                label: doc.label ?? typeLabel(doc.kind),
                status: doc.ocr_status,
                error: doc.ocr_error,
                reviewed: doc.reviewed_at !== null,
                createdAt: doc.created_at,
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function typeLabel(kind: string): string {
  return DOCUMENT_TYPES.find((t) => t.value === kind)?.label ?? "Document";
}

function BodySkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mt-6 h-40 rounded-md border border-line bg-surface-2" />
      <ul className="mt-6 flex flex-col gap-2.5">
        {[0, 1].map((i) => (
          <li key={i} className="h-28 rounded-md border border-line bg-surface-2" />
        ))}
      </ul>
    </div>
  );
}
