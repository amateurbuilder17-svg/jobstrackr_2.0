"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import { fetchSyllabus } from "@/lib/ai/syllabus";
import { GeminiError, hasApiKeys } from "@/lib/ai/gemini";
import type { FormState } from "@/lib/auth/form-state";
import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { getSyllabusByKey, putSyllabus } from "@/lib/db/queries/syllabus";
import { tags } from "@/lib/db/tags";
import { consume, LIMITS } from "@/lib/rate-limit";
import { isSearchable, syllabusKey, syllabusSlug } from "./key";

/**
 * Searching for a syllabus.
 *
 * The order of the gates is the whole design, and it is cheapest-first on
 * purpose — each one refuses without spending what the next one would:
 *
 *   1. **Is this even a search?** Two characters is not an exam name.
 *   2. **Is it already cached?** This is the common path and it costs one
 *      indexed lookup. Crucially it runs *before* the sign-in check, so a guest
 *      following a shared link to a syllabus somebody else fetched is not asked
 *      to make an account to read a public document.
 *   3. **Is there a session?** Only now, and only because what follows spends
 *      money. A guest is sent to sign-in with their search preserved.
 *   4. **The in-process bucket.** Refuses a double-submit without touching
 *      Postgres.
 *   5. **Is the pool configured?** Checked before quota, so a misconfigured
 *      deployment does not charge somebody a search they could never have got.
 *   6. **`claim_ai_quota`.** The real ceiling: atomic and shared across
 *      instances, so two tabs cannot both see the same count and both proceed.
 *
 * Only past all six does a 30-second grounded call happen.
 */

/** A syllabus is a bigger answer than a status report, and slower to produce. */
const DAILY_LIMIT = 5;
const COOLDOWN_SECONDS = 30;

export async function searchSyllabusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = formData.get("q");
  const query = typeof raw === "string" ? raw.trim() : "";

  if (!isSearchable(query)) {
    return {
      ok: false,
      errors: { q: "Enter an exam name — for example, SSC CGL or RRB NTPC." },
    };
  }

  const key = syllabusKey(query);
  const slug = syllabusSlug(query);

  // ── 2. Already have it? ───────────────────────────────────────────────
  const cached = await getSyllabusByKey(key);
  if (cached) redirect(`/syllabus/${cached.slug}`);

  // ── 3. Spending money needs a name ────────────────────────────────────
  // Answered in place rather than with a redirect. Throwing somebody who typed
  // an exam name into a password field loses both the search and the reason for
  // asking; `authRequired` lets the form say what it needs and offer the way in
  // with the query still in the box.
  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      authRequired: `/syllabus?q=${encodeURIComponent(query)}`,
      errors: {
        form: "Sign in to look up a syllabus — it is free, and your searches stay with your account.",
      },
    };
  }

  // ── 4. The cheap refusal ──────────────────────────────────────────────
  if (!consume(`syllabus:${user.id}`, LIMITS.ai)) {
    return { ok: false, errors: { form: "One at a time — try again in a few seconds." } };
  }

  // ── 5. Can this deployment answer at all? ─────────────────────────────
  if (!(await hasApiKeys())) {
    return {
      ok: false,
      errors: { form: "Syllabus search is not configured on this deployment." },
    };
  }

  // ── 6. The real ceiling ───────────────────────────────────────────────
  const db = await sessionDb();
  const { data: quota, error: quotaError } = await db.rpc("claim_ai_quota", {
    p_kind: "syllabus",
    p_daily_limit: DAILY_LIMIT,
    p_cooldown_seconds: COOLDOWN_SECONDS,
  });

  if (quotaError) {
    console.error(`[syllabus] quota check failed: ${quotaError.message}`);
    return { ok: false, errors: { form: "Could not search just now. Try again shortly." } };
  }

  const claim = quota[0];
  if (!claim?.allowed) {
    const wait = claim?.retry_after ?? COOLDOWN_SECONDS;
    return {
      ok: false,
      errors: {
        form:
          wait <= 120
            ? `Just a moment — you can search again in ${String(wait)}s.`
            : `That is all ${String(DAILY_LIMIT)} searches for today. They reset at midnight.`,
      },
    };
  }

  // ── The expensive part ────────────────────────────────────────────────
  let fetched;
  try {
    fetched = await fetchSyllabus(query);
  } catch (error) {
    const failure = error instanceof GeminiError ? error : null;
    console.error(`[syllabus] "${key}" failed: ${String(error)}`);
    return {
      ok: false,
      errors: {
        form: failure?.unusable
          ? "Syllabus search is unavailable right now."
          : "Could not reach the search service. Try again in a minute.",
      },
    };
  }

  const { result } = fetched;

  if (result.kind === "not-found") {
    // The model's own answer, and a different thing from a broken one. The
    // quota is spent either way — that is honest, the call happened — but the
    // sentence has to say which of the two occurred.
    return {
      ok: false,
      errors: {
        q: `No official syllabus found for "${query}". Check the exam's name, or try the conducting body's abbreviation.`,
      },
    };
  }

  if (result.kind === "unreadable") {
    console.warn(`[syllabus] unreadable answer for "${key}": ${result.reason}`);
    return {
      ok: false,
      errors: { form: "The answer came back garbled. Try that search once more." },
    };
  }

  await putSyllabus({
    slug,
    examKey: key,
    syllabus: {
      ...result.syllabus,
      // From the grounded search pass, not from the parsed JSON. The pass that
      // produced that JSON has no search tool — it only reshapes text it was
      // handed — so a URL in its output would be recalled rather than visited,
      // and a recalled URL under a heading reading "Official Sources" is the
      // one kind of wrong this feature cannot afford. See `officialUrls`.
      sources: fetched.sources,
    },
    grounded: fetched.grounded,
    model: fetched.model,
  });

  // Both tags, and both matter. The detail page's cache entry either does not
  // exist yet or holds a version from before this refresh; the list is what the
  // search page and the sitemap render, and it has just gained an entry.
  // `{ expire: 0 }` for the same reason the revalidation endpoint uses it: the
  // write has committed, so holding the old copy for a profile window would
  // send this person to a page that does not yet show what they just fetched.
  revalidateTag(tags.syllabus(slug), { expire: 0 });
  revalidateTag(tags.syllabusList(), { expire: 0 });

  redirect(`/syllabus/${slug}`);
}
