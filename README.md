# JobsTrackr

Rebuild of the government-jobs tracker, designed so that Supabase egress and
Vercel usage stay decoupled from traffic.

**Start here:** [`docs/REBUILD-PLAN.md`](docs/REBUILD-PLAN.md) — the architecture,
the module sequence, and the gate each module has to pass.

---

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill it in — every key is annotated
pnpm dev
```

The app will not start on an incomplete `.env.local`. That is deliberate: it
fails at boot with the missing key's name rather than at the first query.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, type-aware |
| `pnpm test` | Vitest |
| `pnpm budget` | Fails if a route exceeds its first-load JS budget |
| `pnpm verify` | Everything above, in the order CI runs it |

Run `pnpm verify` before pushing. It is the same gate CI applies.

## The rules that matter

1. **No `select("*")`.** Every query names the columns the screen renders. ESLint
   enforces this. It is the habit that caused the outage this rebuild recovers from.
2. **Every query has a `LIMIT`.** No unbounded reads, anywhere, ever.
3. **Static by default.** A page that renders per request needs a written reason.
   Traffic must not drive database reads.
4. **Budgets are gates, not guidance.** Raising one in `budget.json` is a
   deliberate act that someone reviews.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 (strict) · Tailwind 4 ·
Supabase · deployed on Vercel, region `bom1`, beside the database in `ap-south-1`.

Local Node is pinned to 24 via `.nvmrc` to match the Vercel runtime.
