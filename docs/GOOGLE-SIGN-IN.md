# Google sign-in, and why the consent screen said `supabase.co`

## The symptom

Signing in with Google locally, the account chooser read:

> Choose an account — **to continue to JobsTrackr**

The same button on the deployed site read:

> Choose an account — **to continue to wqiffxkakigmtzrficrp.supabase.co**

…with the same footer offering "wqiffxkakigmtzrficrp.supabase.co's Privacy
Policy and Terms of Service".

## What is actually different

Nothing about the credentials. Same Google Cloud project (`jobstrackr-484408`),
same OAuth client ID, same secret, same Supabase provider configuration. The
tokens are not different, and no dashboard setting was out of sync.

What differs is **the `redirect_uri` Google is handed**, and Google labels the
consent screen after the host of that URI:

| | `redirect_uri` sent to Google | What Google shows |
|---|---|---|
| Local | `http://127.0.0.1:54421/auth/v1/callback` | falls back to the consent screen's **app name** — "JobsTrackr" |
| Deployed | `https://wqiffxkakigmtzrficrp.supabase.co/auth/v1/callback` | the **host**, verbatim |

A loopback address is not a site Google can attribute a page to, so locally it
has nothing to print but the app name. In production it has a real host, and it
prints it. It will only print your app's name instead if that host is a domain
you have verified as an *authorised domain* on the OAuth consent screen — and
`supabase.co` is not a domain we own, so it can never be verified here.

This is why no amount of editing the app name, uploading a logo, or submitting
the app for verification changes it. The string is coming from the redirect
host, and on hosted Supabase that host is fixed: GoTrue builds it from the
project's `API_EXTERNAL_URL`, which is not configurable on the free plan.

## The two ways out

1. **Supabase custom domain** (`auth.jobstrackr.in`). The official answer, and
   the one Supabase documents. It is a paid add-on on top of a Pro plan, so it
   is out for this project.

2. **Ask Google from our own origin.** Google Identity Services issues an ID
   token to a page rather than to a redirect target. The request comes from
   `https://jobstrackr.in`, so that is what Google labels it with, and
   `supabase.co` never appears in the round trip at all. The token is then
   traded for the ordinary Supabase session. Free, and this is what is
   implemented.

## How it is wired

| File | Role |
|---|---|
| `src/app/(auth)/google-identity.tsx` | Loads GIS, renders Google's button, gets an ID token |
| `src/app/auth/google/route.ts` | `POST` — trades that token for a Supabase session cookie |
| `src/app/(auth)/google-auth.tsx` | Picks GIS when configured; falls back to the redirect flow otherwise |
| `src/app/auth/callback/route.ts` | Unchanged. Still serves the redirect flow, email confirmation and recovery |

The nonce is generated in the browser: Google is given its SHA-256 and Supabase
is given the raw value, which is what binds a token to the button press that
asked for it.

**The redirect flow is still there and still works.** It renders whenever the
client ID is unset or Google's script is blocked — an ad blocker or a corporate
proxy does that often enough that a sign-in page must not depend on it. Sessions
from both paths are identical, and both land on the same Supabase user.

## Setup this needs

### 1. Environment

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=58983953232-….apps.googleusercontent.com
```

In `.env.local` and in Vercel → Settings → Environment Variables, for
Production **and** Preview. A client ID is public by design — Google's own docs
put it in the page source — and the matching secret stays where it already is,
in Supabase → Authentication → Providers → Google.

Leave it unset and nothing breaks; the button reverts to the redirect flow and
the consent screen goes back to reading `supabase.co`.

### 2. Google Cloud Console → Credentials → the Web OAuth client

Add every origin the button is served from to **Authorised JavaScript origins**.
This is a separate list from the redirect URIs, and it is the one GIS checks:

```
https://jobstrackr.in
https://www.jobstrackr.in
http://localhost:3100
```

Leave the existing **Authorised redirect URIs** alone. They are what the
fallback path uses:

```
http://127.0.0.1:54421/auth/v1/callback
https://wqiffxkakigmtzrficrp.supabase.co/auth/v1/callback
```

Preview deployments get a new hostname per deploy, which cannot be pre-registered
— they fall back to the redirect flow, which is correct behaviour rather than a
gap to close.

### 3. Google Cloud Console → OAuth consent screen

The **App name** is now what users read. Set it to `JobsTrackr`, with the app
logo, and point the privacy policy and terms links at `jobstrackr.in`'s own
pages rather than leaving them to default.

### 4. Nothing in Supabase

The provider configuration is already correct. Supabase validates the ID token's
audience against the client ID configured there, and it is the same one.

## Headers this needed

Both are in `next.config.ts`, both commented in place:

- **CSP.** `default-src 'self'` refused Google's script, stylesheet, token
  endpoint and button iframe, and refused them silently — the button just never
  appeared. Four directives now name the `accounts.google.com/gsi/` origins
  explicitly rather than opening up `google.com`.
- **`Cross-Origin-Opener-Policy`.** Relaxed from `same-origin` to
  `same-origin-allow-popups`. Google's sign-in popup has to talk back to the
  window that opened it; under `same-origin` that link is severed and the sign-in
  completes in a popup that then closes with nobody listening. The relaxation is
  outbound only — another origin still gets no handle on this one, and framing
  is still refused by `frame-ancestors 'none'`.
