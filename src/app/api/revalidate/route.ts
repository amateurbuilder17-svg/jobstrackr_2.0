import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getServerEnv } from "@/lib/env.server";
import { isKnownTag } from "@/lib/db/tags";

/**
 * Cache invalidation endpoint.
 *
 * The counterpart to static rendering: pages live on the CDN until ingestion
 * posts here to say a tag's data changed. This is what decouples Supabase reads
 * from traffic, so it is also the endpoint an attacker would use to force
 * unlimited re-renders — hence the constant-time secret check and the strict
 * body schema.
 */

// No `runtime` or `dynamic` segment config here: both are rejected under
// `cacheComponents`, and neither is needed. Route handlers already run on the
// Node runtime and are already uncached — a cached invalidation endpoint would
// invalidate nothing at all.

const bodySchema = z.object({
  tags: z.array(z.string().min(1).max(200)).min(1).max(200),
});

/**
 * Constant-time comparison.
 *
 * A plain `===` on a secret leaks its length and, in principle, its content
 * through timing. The cost of doing this properly is a few lines, and the
 * comparison is not on any hot path.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself be a timing
  // signal — so length is folded into the result rather than short-circuiting.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!provided || !secretMatches(provided, env.REVALIDATE_SECRET)) {
    // No detail in the response: whether the secret was absent, malformed or
    // simply wrong is information an attacker would use and a caller does not
    // need. The distinction is worth logging, not returning.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  // An unrecognised tag is rejected rather than accepted. Accepting it would
  // succeed, invalidate nothing, and leave a typo in the ingestion worker
  // looking exactly like a working deploy — with pages quietly going stale.
  const unknown = parsed.data.tags.filter((tag) => !isKnownTag(tag));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "unknown tags", unknown, hint: "tags must be built by src/lib/db/tags.ts" },
      { status: 400 },
    );
  }

  const revalidated = [...new Set(parsed.data.tags)];

  // `{ expire: 0 }` marks the entries stale immediately rather than after a
  // profile window. Ingestion only calls this once it has committed a change,
  // so there is nothing to gain by holding the old copy any longer.
  for (const tag of revalidated) revalidateTag(tag, { expire: 0 });

  return NextResponse.json({ revalidated, count: revalidated.length });
}
