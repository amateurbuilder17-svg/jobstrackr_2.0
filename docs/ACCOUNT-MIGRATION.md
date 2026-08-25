# Bringing the accounts across

99 people have an account on the old project. The goal is that every one of
them signs in to the new app **with the password they already have**, and finds
their saved jobs, tracked exams and education where they left them.

That splits into two jobs with a hard ordering between them.

| | What | Tool |
|---|---|---|
| **1** | `auth.users` + `auth.identities` | `pg_dump`, by hand — below |
| **2** | The thirteen public tables that hang off them | `scripts/migrate-users.mjs` |

And one prerequisite before either: **content first.** `saved_jobs` and
`exam_attempts` point at jobs and exams, and the script remaps those ids by
matching against rows that must already exist in the new project. Run
`scripts/backfill-from-old-project.mjs --apply` first.

---

## Step 1 — the accounts

Not scriptable through the API. `auth.users` is not exposed over PostgREST, and
the admin API's `createUser` cannot accept an existing bcrypt hash — going that
route means every one of those 99 people resets their password. A direct dump
avoids that entirely.

```bash
pg_dump "postgresql://postgres.OLDREF:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" \
  --data-only --no-owner --no-privileges \
  -t auth.users -t auth.identities \
  -f accounts.sql
```

Then, against the new project's connection string:

```bash
psql "postgresql://postgres.NEWREF:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 -f accounts.sql
```

This preserves the two things that matter more than anything else in the
migration: each user's **uuid**, so every `user_id` foreign key in Step 2 lands
without a mapping table, and their **`encrypted_password`**, which GoTrue on the
new project verifies exactly as the old one did.

### Four things that go wrong here

1. **`auth.identities` is not optional.** Modern GoTrue resolves an email
   sign-in through `identities`, not `users`. Import `users` alone and all 99
   accounts exist and none of them can log in. Each row needs
   `provider = 'email'`, `provider_id = id::text`, and an `identity_data` JSON
   carrying `sub` and `email`. If the dump's identities table is empty — some
   older projects predate it — build them:

   ```sql
   insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
   select gen_random_uuid(), u.id, u.id::text, 'email',
          jsonb_build_object('sub', u.id::text, 'email', u.email),
          now(), now()
   from auth.users u
   where not exists (select 1 from auth.identities i where i.user_id = u.id);
   ```

2. **Do not import `auth.sessions` or `auth.refresh_tokens`.** Everyone signs in
   once more; carrying live sessions across projects carries their JWT secret
   assumptions with them.

3. **`email_confirmed_at` must survive**, or 99 people are asked to re-confirm
   an address they confirmed a year ago. It is in the dump — just don't filter
   it out.

4. **The `on_auth_user_created` trigger fires on insert** and creates a
   `profiles` row for every account. That is wanted, not a problem — but it is
   why Step 2 upserts profiles rather than inserting them.

### If the old database is unreachable

The 402 restriction is applied at Supabase's API gateway; direct Postgres
connections usually keep working. Try the dump before assuming otherwise — and
if the password was never saved, reset it from the dashboard, which is a
platform-level operation that works on a restricted project.

Only if that genuinely fails: create the accounts with `admin.createUser` and
send a password-reset email to each. It works, and it costs every user a reset.

---

## Step 2 — their data

```bash
node scripts/migrate-users.mjs            # dry run: counts, and what needs a decision
node scripts/migrate-users.mjs --apply
```

The dry run is the deliverable here, not a formality. It prints what would move
and, separately, everything it refused to guess at. Read that second list before
applying.

### What is deliberately not migrated

**All of the identity documents.** Aadhaar, PAN, passport, their encrypted
twins, caste and EWS certificate numbers, disability certificates, thumb
impressions and signature images. The new schema has no columns for any of it.
That data was the old project's largest liability and the least used part of the
product; it does not come across, and the dry run counts the rows it dropped so
the decision is visible rather than implied.

**`documents`.** Twelve rows pointing at Storage objects that the 402 also
blocks. Twelve people re-uploading is cheaper than engineering around it.

### The mappings that are not one-to-one

| Table | What happens |
|---|---|
| `profiles` | Old `user_id` becomes the new `id`. `phone` is dropped unless it is a 10-digit Indian mobile, which is what the new schema's constraint requires. `category` maps onto the reservation enum. |
| `education_qualifications` | `qualification_type` is free text on one side and an enum on the other, **and it feeds a hard filter in `match_jobs`** — so an unrecognised value is reported, never approximated. `qualification_name` becomes `discipline`, which is what `stream_of` reads. |
| `exam_attempts` | `exam_id` is remapped by normalised exam name; an exam with no counterpart keeps its name in `custom_name` rather than vanishing. `year` has no column in the new schema and goes into `notes` as "2025 attempt" — fabricating an `applied_at` from it would be inventing a date nobody gave. |
| `saved_jobs` | `job_id` is remapped by recomputing the ingest worker's `dedupe_key` from the old row, with the slug as a fallback. Unmappable rows are listed by job title. |
| `user_roles` | The old `app_role` enum becomes the new text column. Check the admins against `/admin` before the old project goes away. |

---

## The gate

- The dry run reports zero unmapped rows, or a list somebody has read and accepted.
- A second `--apply` run writes the same rows and changes nothing.
- On a preview deploy, a real migrated account signs in **with its original
  password** and sees its saved jobs, its tracked exams and its education.
- `select count(*) from auth.users` matches the old project.
- No aadhaar, PAN or passport value exists anywhere in the new database —
  checked with a query, not assumed.
