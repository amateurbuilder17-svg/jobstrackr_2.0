import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/auth/form-state";
import { sessionDb } from "@/lib/db/clients";

/**
 * Where every out-of-band sign-in lands: Google, the signup confirmation email,
 * and the password-recovery link all come back here with a one-time code.
 *
 * A Route Handler rather than a page, because the only job is to trade the code
 * for a session cookie and redirect. Rendering anything would mean a visible
 * intermediate screen on a step the user should never notice.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Supabase reports a refused or expired grant in the query string rather than
  // by status code. Surfacing its description is safe — it describes the link,
  // not the account.
  const authError = searchParams.get("error_description") ?? searchParams.get("error");
  if (authError) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(authError)}`);
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent("That sign-in link is not valid.")}`,
    );
  }

  const db = await sessionDb();
  const { error } = await db.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent("That link has expired. Please try again.")}`,
    );
  }

  // `origin` comes from the incoming request rather than the configured site
  // URL so that preview deployments redirect to themselves instead of to
  // production. `next` is already constrained to a relative path.
  return NextResponse.redirect(`${origin}${next}`);
}
