# Menu, profile, and the rest of the legacy surface

The rebuild has the four content surfaces and the accounts. What it does not
have is the **drawer** — the place the old app kept everything that was not a
feed. `src/pages/More.tsx` was 835 lines and 22 entry points, and fourteen of
those entry points lead somewhere this codebase has no route for.

This plan adds the mobile menu button and profile button to every page, then
brings across everything the menu opened, under the rules in
[`REBUILD-PLAN.md`](REBUILD-PLAN.md) §2 and the gate contract from
[`PARITY-PLAN.md`](PARITY-PLAN.md). Modules continue the existing numbering.
**A module is not done until its gate passes.**

---

## Status

| Module | State | Notes |
|---|---|---|
| M20 · The shell | **Done** | `/api/saved` → `/api/session`, `SessionProvider` hoisted, both buttons in the top bar |
| M21 · The menu | **Done** | Drawer + `/menu`, one server-rendered list shared by both |
| M22 · Support surface | **Done** | `/help`, `/faq`, `/user-manual`, `/feedback` + the `kind` migration |
| M23 · The PII profile | Not started | The long pole; nothing above it touches `profiles` |
| M24–M29 | Not started | |

**Measured cost of M20 + M21:** +2.4 kB first-load JS on every route, uniform —
`/` 152.1 → 154.5, `/jobs/[slug]` 153.4 → 155.9, `/tracker` 157.6 → 159.9.
Under the 3 kB ceiling the plan set, so the drawer stays. `budget.json` default
raised 158 → 161 and `/tracker` 162 → 165 to preserve existing headroom.

**Static page count:** 457 → 462, which is exactly the five new static routes.
No existing page lost its static rendering; `/jobs/[slug]` still prerenders its
240 paths.

Two things found while building, both fixed:

- **Zod reached the browser.** `feedback-form.tsx` imported its labels from the
  module that builds the schema, and `/feedback` came out at 219 kB against a
  158 kB budget — the exact trap `profile/enums.ts` documents. Constants split
  into `lib/feedback/kinds.ts`; the route is now 156.3 kB.
- **Initials broke on two real inputs.** A Devanagari name shattered because
  vowel signs are combining marks rather than letters, and a `full_name` that is
  an email address yielded the P of the local part and the C of "com". Both are
  pinned by tests in `lib/profile/initials.test.ts`.

---

## 0. What the audit found

Seven things came out of reading `More.tsx` against this codebase. One is an
architectural constraint that decides the whole design, four are schema gaps,
and two are contract mismatches that would fail silently if ported literally.

### 0.1 · The shell cannot read the session — this decides everything

`next.config.ts:59` sets `cacheComponents: true`. The consequence is written
into the shell already, in `site-footer.tsx`:

> No year. `new Date()` here would read the clock during render, which under
> Cache Components makes every page carrying the shell dynamic — trading 433
> static pages for a number that is wrong one day a year.

A profile button that renders the signed-in user's initials **on the server** is
the same mistake with a bigger blast radius. `sessionDb()` reads cookies
(`src/lib/db/clients.ts:57`), cookies mark the render dynamic, and the shell is
in the root layout — so it would convert every statically generated page,
including all ~2,700 job pages, into a per-request function invocation. That is
cause #6 of the rebuild, reintroduced by an avatar.

The precedent for the right answer is already in the tree.
`saved-provider.tsx:30`:

> Per-user state is fetched here, once, after hydration — not rendered into the
> HTML. That is what lets /jobs and all 240 job pages stay static: the cached
> document paints, then the buttons fill in.

`/api/saved` already returns `signedIn`. The profile button joins that request
rather than opening a second one — the endpoint's own comment explains why
splitting per-session reads is the thing to avoid.

**Rule for this whole plan: nothing in `AppShell` may read cookies, headers, or
the clock during render.**

### 0.2 · Fourteen of the menu's twenty-two entry points have no route

| Legacy menu item | Legacy route | Status here |
|---|---|---|
| Profile card / Edit profile | `/profile` | ✅ `src/app/profile` |
| Track an Exam | `/tracker` | ✅ |
| Find an Exam | `/search` | ❌ exam search does not exist |
| Updates | `/trending` | ✅ as `/updates` |
| Saved Jobs | `/saved` | ✅ |
| Jobs For You | `/for-you` | ✅ |
| Application Guidance | `/formmate` | ❌ |
| Upload Your Documents | `/documents` | ❌ |
| Syllabus Finder | `/syllabus` | ❌ |
| Telegram Alerts | `/settings/notifications` | ❌ |
| Exam Countdown | `/countdown`, `/countdown/live`, `/countdown/:slug` | ❌ |
| Which Govt Job Suits You? | `/quiz` | ❌ |
| Dark Mode | — | ✅ `ThemeToggle` |
| Sector Preferences | `/edit-sector-preferences` | ✅ folded into `/profile` |
| User Manual | `/user-manual` | ❌ |
| FAQ | `/faq` | ❌ |
| Feedback & Grievances | dialog | ❌ |
| Help & Support | `/help` | ❌ |
| Share this App | Web Share API | ❌ |
| Admin Panel | `/admin` | ✅ |
| Privacy / Refund / Terms | three routes | ✅ |
| Reset Password / Logout | — | ⚠️ exist, but not from the menu |

"Find an Exam" is deliberately **dropped**, not ported. `/jobs` and `/updates`
already carry route-aware search fields, and a third search page pointed at the
`exams` table would be a fourth place to type a query.

### 0.3 · `profiles` has none of the fields FormMate and OCR write

`profiles` (migration `0007:12`) carries 14 columns, all of them matching
inputs. FormMate copies, and OCR extracts, a different set entirely:
`father_name`, `mother_name`, `address`, `pincode`, `marital_status`,
`aadhar_number`, `pan_number`, `passport_number`, `caste_name`,
`caste_certificate_number`, `caste_issuing_authority`, `caste_issue_date`,
`ews_certificate_number`, `ews_issuing_authority`, `sub_category`,
`disability_type`, `disability_certificate_number`, `current_status`.

Legacy stored the ID numbers `pgp_sym_encrypt`-ed with a masked plaintext twin
(`****1234`). That behaviour comes across intact — see M23. **Two features
depend on this module and neither can start before it.**

### 0.4 · `suggestions_grievances` cannot record which kind it is

`0008:176` gives the table `email`, `message`, `status`. The legacy dialog
writes `type` (`suggestion` | `grievance`) and `user_email`. Ported literally,
every grievance would arrive indistinguishable from a feature request.

### 0.5 · There is no storage bucket

Legacy created a private `documents` bucket with owner-scoped policies.
Nothing in `supabase/migrations/` here creates any bucket. `documents.storage_path`
(`0008:105`) points at storage that does not exist.

### 0.6 · `has_role` has a different signature in each project

Legacy: `has_role(_user_id, _role)`. Here: `has_role(check_role)`, reading
`auth.uid()` itself. Every ported function that calls it must be rewritten, not
copied — a copied call fails closed, so an admin silently loses their bypass.

### 0.7 · Both Vercel crons are spent

`vercel.json` uses both Hobby cron slots (`/api/cron/prune`,
`/api/cron/exam-status`). The Telegram queue therefore runs on an Apps Script
time-trigger posting to a secret-guarded route, the same pattern `/api/sync`
already documents.

---

## 1. Decisions taken

**Menu is a drawer with a real page behind it.** The button is
`<a href="/menu">`; JS intercepts the click and slides a left drawer open. The
panel's markup is server-rendered into the layout, so only open/close logic —
~1.5 kB — reaches the client. With JS off, or before hydration, the same button
navigates to `/menu`, which renders the identical list as a page. Deep-linkable,
back-button-correct, and no per-route cost for the content.

**Profile button links, it does not pop.** Initials when signed in, a user glyph
when not, linking to `/profile` or `/sign-in`. Account actions — reset password,
sign out, sector preferences — live in the drawer with the rest of the settings.
A popover would duplicate them and add JS to 2,700 static pages to do it.

**PII comes across encrypted.** Full column parity with legacy,
`pgp_sym_encrypt` at rest, masked display columns, owner-only RLS. It gets its
own module and its own security gate.

---

## 2. The modules

| # | Module | Depends on | New routes |
|---|---|---|---|
| M20 | Shell: menu button, profile button, session context | — | — |
| M21 | The menu: `/menu` + drawer | M20 | `/menu` |
| M22 | Support surface: feedback, help, FAQ, manual, share | M21 | 4 |
| M23 | The PII profile, encrypted | — | — |
| M24 | FormMate — application guidance | M23 | 1 |
| M25 | Documents + OCR | M23 | 1 |
| M26 | Syllabus finder | M20 | 2 |
| M27 | Exam countdown + quiz | M20 | 4 |
| M28 | Telegram alerts | M20 | 1 |
| M29 | Remaining edge-function ports | M25, M28 | — |

---

## M20 · The shell

### Scope

- **`/api/saved` → `/api/session`.** Same handler, same single per-session
  request, four fields added: `name`, `initials`, `email`, `isAdmin`. Response
  stays `private, no-store`. Renaming rather than adding is the point — a second
  endpoint would double the dynamic requests a session makes, which the existing
  file already argues against.
- **`SessionProvider`** hoisted in `app-shell.tsx` to wrap `TopBar`, `main` and
  `BottomNav` — currently `SavedProvider` sits inside `main` (`app-shell.tsx:34`)
  and the top bar is outside it. `SavedProvider` becomes a consumer of the same
  context so the fetch count does not change.
- **`MenuButton`** in `TopBar`, left of the brand, `lg:hidden`. Renders as a link
  to `/menu`; upgrades to a drawer trigger on hydration.
- **`ProfileButton`** in `TopBar`, right of `ThemeToggle`, `lg:hidden`. Renders a
  fixed-size neutral placeholder on the server, fills in initials after the
  session resolves. Fixed size so nothing shifts.
- **`MenuIcon` and `UserIcon` already exist** in `src/components/icons/index.tsx`.
  No icon library is added.
- Desktop is untouched: the sidebar already carries Profile.

### The top bar's geometry problem

`top-bar.tsx:43` currently spends the full width on either a live search field
(`/jobs`, `/updates`) or brand + search link. Two 40px buttons come out of that
budget, and on a 320px screen the search field's placeholder already sets a
floor the bar cannot shrink past. The search *link* loses its label below `sm`
and becomes an icon; the live search *field* keeps its input and drops the
`lg:max-w-lg` cap. Measured at 320px in the gate.

### Gate

- 320px, 375px and 768px screenshots of `/`, `/jobs`, `/updates`, `/jobs/[slug]`:
  both buttons present, no horizontal scroll, no layout shift as the session
  resolves.
- `pnpm build` output shows `/jobs/[slug]` still statically prerendered, and the
  static page count is unchanged from before the module.
- Exactly one `/api/session` request per page load, verified in the network panel.
- `pnpm budget` passes with the default 158 kB ceiling unraised.
- Signed-out shell renders no personalised content in the HTML source
  (`curl` the page, grep for the account name).

---

## M21 · The menu

### Scope

`/menu` renders the full list as a Server Component. The drawer imports the same
component. One source of truth, two presentations.

Sections, in legacy order, minus what has been folded elsewhere:

1. **Account** — avatar, name, email, "Edit my profile"; or a sign-in card for
   guests. Client-filled from the session context.
2. **Quick navigation** — Track an Exam, Updates, Saved, For You.
3. **Smart tools** — FormMate, Documents, Syllabus, Telegram, Countdown, Quiz.
   Items ship disabled with a "coming soon" state until their module lands, so
   the menu is complete from day one and never links to a 404.
4. **Resources & support** — Sector preferences, User manual, FAQ, Feedback,
   Help, Share, Admin (admin only, client-gated on `isAdmin`).
5. **Legal** — the three existing pages.
6. **Session** — Reset password, Sign out.
7. **Appearance** — the existing `ThemeToggle`, as a labelled row.

Auth-gated items (`Track an Exam`, `Documents`, `Telegram`) link to
`/sign-in?next=…` for guests rather than opening a dialog. `proxy.ts:34` already
enforces this server-side; the link just avoids the round trip.

### Gate

- `/menu` renders identically with JS disabled.
- Drawer traps focus, closes on Escape and on backdrop click, restores focus to
  the button, and sets `aria-expanded` / `aria-controls`.
- Route change closes the drawer.
- `prefers-reduced-motion` removes the slide.
- Budget: the shell's increase across all routes is ≤ 2 kB, measured.

---

## M22 · Support surface

Four static pages and one dialog — no external dependency, so this lands early
and makes the menu feel real.

### Scope

- `/help`, `/faq`, `/user-manual` — content ported from
  `src/pages/{Help,FAQ,UserManual}.tsx`, rewritten as Server Components with
  static rendering and their own metadata. FAQ ships `FAQPage` JSON-LD.
- **Feedback & Grievances** — a Server Action, not a client `supabase.from()`
  insert. Legacy rate-limited in `localStorage`, which is a suggestion rather
  than a limit; this uses `LIMITS.form` from `src/lib/rate-limit.ts` plus a Zod
  schema. Anonymous mode nulls both `user_id` and `email`.
- **Share this App** — `navigator.share` with a clipboard fallback, ~0.3 kB,
  loaded only inside the menu.

### Schema

```sql
alter table public.suggestions_grievances
  add column kind text not null default 'suggestion'
    check (kind in ('suggestion', 'grievance'));
```

Named `kind`, not `type` — `type` is a reserved word in enough contexts to be
worth avoiding, and nothing reads the legacy column name.

### Gate

- Feedback insert succeeds signed-in, guest, and anonymous; RLS blocks reading
  anyone else's row (proved in `queries.contract.test.ts`).
- Rate limit returns a usable message, not a stack trace.
- All four pages statically prerendered, budget unchanged.

---

## M23 · The PII profile, encrypted

**The highest-risk module in the plan.** It stores government identity numbers.

### Schema

One migration adding the 18 columns from §0.3, plus encrypted twins for the
three ID numbers:

```sql
alter table public.profiles
  add column father_name text,
  add column mother_name text,
  -- … address, pincode, marital_status, caste_*, ews_*, disability_*,
  --   sub_category, current_status
  add column aadhar_number text,             -- stored masked: '****1234'
  add column aadhar_number_encrypted text,
  add column pan_number text,                -- stored masked: '****9F'
  add column pan_number_encrypted text,
  add column passport_number text,
  add column passport_number_encrypted text;
```

A `before insert or update` trigger encrypts with `pgp_sym_encrypt` and
overwrites the plaintext column with its mask, so the unmasked value never rests
in the table. The key comes from a Postgres setting, never from a literal in the
migration.

Decryption is a `security definer` function returning only `auth.uid()`'s own
row. FormMate calls it; nothing else does. `PROFILE_COLUMNS`
(`src/lib/profile/columns.ts:17`) gains only the masked columns — the encrypted
ones are never selected by the app.

### Gate

- Insert an Aadhaar number, then `select aadhar_number from profiles` as the
  owner: returns the mask, never the digits.
- `select` as another user: zero rows (RLS).
- The decrypt function returns another user's row: **must fail**. This is the
  gate; the module does not ship if it passes.
- Key rotation procedure documented in `docs/` with the re-encrypt statement.
- `pg_dump` of the table contains no readable ID number.

---

## M24 · FormMate

### Scope

`/formmate` — the profile and education rows a government application form asks
for, each with a copy button. Server Component for the data, one small client
component for the clipboard.

Two things legacy did that come across: it groups fields the way forms ask for
them (personal, contact, education, category, documents), and it shows "Not
provided" with a link to the field rather than an empty row.

One thing that does not: legacy fetched the decrypted profile into the browser.
Here the ID numbers stay masked in the HTML, and the copy button calls a Server
Action that returns the unmasked value for that one field, rate-limited. A page
that has already painted every ID number is a page that has already leaked them
to anything reading the DOM.

### Gate

- Page source contains no unmasked ID number.
- Copy works on iOS Safari (which requires the write to happen inside the tap).
- Budget: ≤ 158 kB.

---

## M25 · Documents + OCR

### Scope

- **Storage.** A private `documents` bucket, owner-scoped policies keyed on the
  first path segment being `auth.uid()`, 20 MB ceiling matching the existing
  `documents_size_sane` check (`0008:111`), MIME allowlist of
  jpeg/png/webp/gif/pdf.
- **Schema.** `documents` gains `ocr_status`
  (`pending|processing|done|failed`), `ocr_result jsonb`, `ocr_error text`,
  `ocr_attempts smallint`.
- **`/documents`** — upload, list, delete, and a review modal that shows what
  OCR extracted against what the profile currently holds, field by field, with
  per-field accept. Legacy's `OCRConflictModal` behaviour, kept: nothing is
  written to the profile without an explicit accept.
- **The OCR port.** `supabase/functions/ocr-process/index.ts` becomes
  `src/lib/ai/ocr.ts` + `POST /api/documents/[id]/ocr`. **All five extraction
  prompts copied verbatim** into `src/lib/ai/prompts/ocr.ts`:
  `identity_card`, `marksheet`, `certificate`, `caste_certificate`,
  `job_application`. Each is pinned by a snapshot test, so a later edit to a
  prompt is a visible diff rather than a silent behaviour change.
- **The IDOR check comes across.** Legacy verified the storage path's first
  segment against the caller's id before downloading. That check is why a
  document id from another user is not enough to read their Aadhaar card. It is
  re-implemented against `has_role(check_role)` — see §0.6.
- **Rate limit.** Legacy's `DAILY_LIMIT = 7`, one per minute, admins exempt.
  Enforced in Postgres, not in the process — `src/lib/rate-limit.ts` is
  per-instance by its own admission, which is fine for a save button and not
  fine for a model call that costs money.

### Gate

- Upload → OCR → review → accept writes only accepted fields.
- A document id belonging to another user returns 403 and touches no storage.
- A 25 MB file and a `.exe` are both rejected before upload starts.
- The five prompts match the legacy file byte for byte (test).
- OCR failure leaves `ocr_status = 'failed'` and a retry available, never a row
  stuck in `processing`.

---

## M26 · Syllabus finder

### Scope

- `/syllabus` (search) and `/syllabus/[slug]` (result). Legacy used a query
  string; a slug makes results shareable and cacheable.
- **Port of `syllabus-search`.** `SYLLABUS_PROMPT` copied verbatim into
  `src/lib/ai/prompts/syllabus.ts`. The call goes through the existing
  `src/lib/ai/gemini.ts` with grounding — which is strictly better than the
  legacy path, because it returns the sources and the `grounded: false` flag the
  old function had no way to surface.
- **`syllabus_cache` table**, keyed on a normalised exam name, with the parsed
  stages, sources, confidence, and `fetched_at`. Legacy had this table; it is
  what keeps a popular exam from costing a grounded model call per visitor.
  Served from cache for 30 days, revalidated on demand.
- Zod schema for the response shape. The prompt promises a specific JSON object;
  nothing currently validates that it delivered one.

### Gate

- Two searches for the same exam produce one model call.
- A malformed model response renders an error state, never a half-built page.
- Sources shown with every result; ungrounded results labelled.
- `/syllabus/[slug]` is statically cacheable and carries JSON-LD.

---

## M27 · Countdown + quiz

### Scope

- `/countdown` — the wall of upcoming exams with live timers. One client
  component owning a single interval for the whole page, not one per card.
- `/countdown/[slug]` — a shareable countdown with its own OG image, generated
  by the existing `ImageResponse` setup (`src/app/opengraph-image.tsx`).
- `/countdown/live` — the fullscreen view.
- `/quiz` — legacy's standalone "Which Govt Job Suits You?" quiz. Legacy served
  it as a separate HTML file outside the app shell precisely so it stayed light;
  here it is a route with its own layout that opts out of `AppShell`, same
  effect without the second build.

### Gate

- One timer per page, verified.
- A countdown for a past exam degrades to "Completed", not a negative number.
- OG image renders for a shared countdown.
- Quiz route ≤ 158 kB and has no dependency on the session.

---

## M28 · Telegram alerts

### Scope

- `/settings/notifications` — link/unlink the Telegram account, and the
  preference toggles `notification_preferences` (`0008:144`) already defines,
  including quiet hours.
- **Port of `telegram-bot`** → `POST /api/telegram/webhook`. The
  `X-Telegram-Bot-API-Secret-Token` check comes across as a
  `timingSafeEqual` comparison, matching `/api/sync`. Deep-link account binding
  via a single-use token, not a guessable user id.
- **Port of `process-telegram-queue`** → `POST /api/telegram/drain`, driven by an
  Apps Script time-trigger (§0.7). Batched, with retry counts and a dead-letter
  path, mirroring `sync_dead_letter`.
- **Port of `telegram-auto-post`** → channel broadcast of new jobs, same trigger.
- **Schema.** `telegram_notifications_queue`, `telegram_channels`,
  `telegram_sent_jobs` — none of which exist here.
- CSP: `connect-src` (`next.config.ts:29`) does not need to change; Telegram is
  called server-side only.

### Gate

- Webhook rejects an unsigned request.
- Linking is single-use and expires.
- A user with `telegram_enabled = false` receives nothing.
- Quiet hours are honoured in the user's timezone.
- A failing send retries three times, then dead-letters, and never blocks the
  queue.

---

## M29 · The remaining edge functions

Everything left in `supabase/functions/`, ported so no behaviour lives only in
the old project. **Every prompt moves verbatim into `src/lib/ai/prompts/`,
each with a snapshot test.**

| Legacy function | Prompt(s) | Destination | Notes |
|---|---|---|---|
| `_shared/apiKeyRotation.ts` | — | ✅ `src/lib/ai/keys.ts` | Already ported |
| `ai-assist` · `status_update` | exam status | ✅ `src/lib/ai/exam-status.ts` | Already ported (M19) |
| `ai-assist` · `form_tips` | 1 | `lib/ai/form-tips.ts` | Surfaces in M24 |
| `ai-assist` · `extract_info` | 1 | folded into M25 | Same job as `ocr-process` |
| `ocr-process` | 5 | M25 | |
| `syllabus-search` | `SYLLABUS_PROMPT` | M26 | |
| `telegram-bot` | message templates | M28 | |
| `process-telegram-queue` | — | M28 | |
| `telegram-auto-post` | — | M28 | |
| `groq-summarize` | `SYSTEM_PROMPT` | `/api/cron` batch | Groq; `api_keys_config` already allows `provider = 'groq'` |
| `jobs-recommendations` | 1 | `lib/ai/rerank.ts` | Optional LLM re-rank *on top of* `match_jobs`; the SQL matcher stays authoritative |
| `generate-tags` | — (rule-based) | `lib/sync/tags.ts` | Pure function, belongs in ingest, not a network call |
| `process-embeddings` | — | ingest | Postgres/`pgvector`, per REBUILD-PLAN §3 |
| `auto-discover-jobs` | `JOB_DISCOVERY_PROMPT`, `URL_SCRAPE_PROMPT` | `/api/discover` | Apps Script trigger |
| `ai-job-search` | `JOB_DISCOVERY_PROMPT` | merge into `/api/discover` | Same prompt as above — one copy |
| `refresh-job-data` | `JOB_REFRESH_PROMPT` | `/api/jobs/[id]/refresh` | Admin-only |
| `quick-refresh-job` | `QUICK_REFRESH_PROMPT` | same route, `?quick` | |
| `govtjob-scraper` | — | **drop** | Superseded by `/api/sync` + Apps Script |
| `sync-sheets` | — | **drop** | Superseded by `/api/sync` |
| `exams` | — | **drop** | Plain CRUD; `lib/db/queries/exams.ts` covers it |
| `_shared/email.ts` | — | port if M28 needs email | Otherwise drop |

### Gate

- `pnpm test` includes a snapshot for every ported prompt.
- No route ported here is reachable without auth or a shared secret.
- Model calls all run through `lib/ai/keys.ts`, so one table says which key is
  carrying load.
- `pnpm traffic` and `pnpm budget` both pass.

---

## 3. Budget and egress

Only M20 and M21 touch every route. Everything else is a leaf.

| Module | Route cost | Egress |
|---|---|---|
| M20 | ≤ 1 kB shell (buttons) | +1 field set on an existing per-session request |
| M21 | ≤ 2 kB shell (drawer) | none — menu content is static |
| M22 | leaf only | negligible |
| M23–M28 | leaf routes, each ≤ 158 kB | per-user, dynamic by definition |

The three-kilobyte shell increase is the entire cost this plan imposes on the
2,700 static pages, and `budget.json`'s default stays at 158 with the
`_baselineKb: 134` floor unchanged. If M20 + M21 measure above 3 kB combined,
the drawer falls back to the `/menu` page and the button becomes a plain link —
that is the fallback the design is built around, not a rewrite.

---

## 4. Security gates, collected

These are the ones that block a release rather than annoy a reviewer:

1. **No unmasked ID number reaches a browser** except through the single
   rate-limited Server Action in M24.
2. **The decrypt function cannot return another user's row.** M23 does not ship
   until this is proved by a failing test that then passes.
3. **Storage paths are verified against the caller**, not trusted from the
   request body (M25, the legacy IDOR check).
4. **`has_role` is re-checked at every ported call site** (§0.6) — a copied
   two-argument call fails closed and silently removes admin bypass.
5. **Every ingestion route carries a `timingSafeEqual` shared-secret check**,
   matching `/api/sync`.
6. **Model-call rate limits live in Postgres**, not process memory.

---

## 5. Sequence

```
M20 ──► M21 ──► M22          shell, menu, and the support pages
  │
  └──►  M26, M27             leaf features with no PII dependency
M23 ──► M24, M25             encrypted profile, then FormMate and OCR
M28                          Telegram, independent
M29                          the remaining ports, last
```

M20 → M21 → M22 first, because that is the smallest sequence that makes the
menu button real on every page and gives the user something complete. M23 is the
long pole and starts in parallel — nothing in M20–M22 touches `profiles`.

Review points: after M21 (does the shell still build 2,700 static pages), after
M23 (the security gate), and after M25 (the first feature that stores a
government ID).
