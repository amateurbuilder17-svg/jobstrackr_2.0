import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addApiKeyAction, deleteApiKeyAction, toggleApiKeyAction } from "@/lib/admin/actions";
import { getAiUsage } from "@/lib/db/queries/admin-people";
import { listApiKeys } from "@/lib/db/queries/admin-ops";
import { ActionForm, RowAction } from "../action-form";
import { Empty, Section, since, Stat, StatRow, Td, TableFrame, Th, THead } from "../ui";

/**
 * The AI key pool, and what it is being spent on.
 *
 * Gemini's free tier is capped per minute and per day, and both caps arrive as
 * a 429 — so the pool is not an optimisation, it is the thing that decides
 * whether the feature answers at all at 9am. Keys are tried in priority order
 * and rotated past the moment one says no; a 429 sends a key to the back for 65
 * seconds, a 401 retires it. See `lib/ai/keys.ts`.
 *
 * What this page is *for* is the two questions that pool raises: which key is
 * carrying the load, and which one has quietly stopped working. A pool nobody
 * can see degrades to one working key and the first anyone hears of it is the
 * feature going quiet.
 */
export default function AdminApiPage() {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <Keys />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <Usage />
      </Suspense>

      <AddKey />
    </div>
  );
}

async function Keys() {
  const keys = await listApiKeys();

  const active = keys.filter((key) => key.isActive).length;
  const calls = keys.reduce((sum, key) => sum + key.totalCalls, 0);
  const errors = keys.reduce((sum, key) => sum + key.totalErrors, 0);

  return (
    <Section
      title="Rotation pool"
      hint="Tried in priority order, lowest first. A 429 rotates to the next key; a 401 retires one."
    >
      <StatRow>
        <Stat label="Keys" value={keys.length} />
        <Stat
          label="Active"
          value={active}
          tone={active === 0 ? "critical" : undefined}
          hint={active === 0 ? "nothing will answer" : undefined}
        />
        <Stat label="Calls" value={calls} />
        <Stat label="Errors" value={errors} tone="warn" />
        <Stat
          label="Error rate"
          value={calls === 0 ? "—" : `${String(Math.round((errors / calls) * 100))}%`}
        />
      </StatRow>

      {keys.length === 0 ? (
        <Empty>
          No keys configured. The pool falls back to `GEMINI_API_KEY` from the environment,
          which works but cannot rotate and reports nothing.
        </Empty>
      ) : (
        <TableFrame minWidth="54rem">
          <THead>
            <Th width="3rem">#</Th>
            <Th width="6rem">Provider</Th>
            <Th>Model</Th>
            <Th width="8rem">Key</Th>
            <Th align="right" width="5rem">
              Calls
            </Th>
            <Th align="right" width="5rem">
              Errors
            </Th>
            <Th width="7rem">Last used</Th>
            <Th width="11rem">Status</Th>
            <Th width="9rem">
              <span className="sr-only">Actions</span>
            </Th>
          </THead>
          <tbody>
            {keys.map((key) => (
              <tr
                key={key.id}
                className={`border-t border-line/60 ${key.isActive ? "" : "opacity-55"}`}
              >
                <Td className="text-ink-3">{key.priority}</Td>
                <Td>
                  <Badge>{key.provider}</Badge>
                </Td>
                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate text-ink">{key.model}</span>
                  {key.label ? (
                    <span className="block truncate text-2xs text-ink-3">{key.label}</span>
                  ) : null}
                </td>
                {/*
                  A six-character prefix, and no way to reveal more. The old
                  admin selected the decrypted key into the browser behind an
                  eye icon and a copy button — ten production keys sitting in
                  the DOM of a page, readable by any extension with page
                  access. The prefix is enough to tell two rows apart against
                  the provider's console, which is the only thing an operator
                  needs it for.
                */}
                <Td className="font-mono text-2xs text-ink-3">{key.hint}</Td>
                <Td align="right">{key.totalCalls.toLocaleString("en-IN")}</Td>
                <Td align="right" className={key.totalErrors > 0 ? "text-warn" : "text-ink-3"}>
                  {key.totalErrors.toLocaleString("en-IN")}
                </Td>
                <Td className="whitespace-nowrap text-ink-3">{since(key.lastUsedAt)}</Td>
                <Td>
                  {!key.isActive ? (
                    <Badge tone="neutral">disabled</Badge>
                  ) : key.lastError ? (
                    <span
                      className="block truncate text-2xs text-critical"
                      title={key.lastError}
                    >
                      {key.lastError}
                    </span>
                  ) : key.totalCalls > 0 ? (
                    <Badge tone="good">ok</Badge>
                  ) : (
                    <span className="text-2xs text-ink-3">unused</span>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <RowAction
                      action={toggleApiKeyAction}
                      fields={{ id: key.id, isActive: String(key.isActive) }}
                      label={key.isActive ? "Disable" : "Enable"}
                    />
                    <RowAction
                      action={deleteApiKeyAction}
                      fields={{ id: key.id }}
                      label="Delete"
                      variant="danger"
                      confirm="Remove this key from the pool? Revoke it in the provider's console too."
                    />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
}

async function Usage() {
  const usage = await getAiUsage(14);

  if (usage.length === 0) {
    return (
      <Section title="AI usage" hint="Daily calls per feature, from the `ai_usage` rollup.">
        <Empty>Nothing recorded in the last fourteen days.</Empty>
      </Section>
    );
  }

  const days = [...new Set(usage.map((row) => row.day))];
  const kinds = [...new Set(usage.map((row) => row.kind))].sort();
  const byCell = new Map(usage.map((row) => [`${row.day}|${row.kind}`, row]));

  return (
    <Section
      title="AI usage"
      hint="Daily calls per feature. A rollup keyed on (user, day, feature), so this table grows with accounts rather than with requests — and the queries people type are never stored."
    >
      <TableFrame minWidth={`${String(12 + kinds.length * 7)}rem`}>
        <THead>
          <Th width="8rem">Day</Th>
          {kinds.map((kind) => (
            <Th key={kind} align="right">
              {kind}
            </Th>
          ))}
          <Th align="right" width="6rem">
            People
          </Th>
        </THead>
        <tbody>
          {days.map((day) => {
            const rows = kinds.map((kind) => byCell.get(`${day}|${kind}`));
            // Distinct people per feature cannot simply be added — the same
            // person may use two — so the day's figure is the largest single
            // feature's count: a floor, and honest about being one.
            const people = Math.max(0, ...rows.map((row) => row?.users ?? 0));

            return (
              <tr key={day} className="border-t border-line/60">
                <Td className="whitespace-nowrap text-ink-2">{day}</Td>
                {rows.map((row, index) => (
                  <Td
                    key={kinds[index]}
                    align="right"
                    className={row ? "text-ink" : "text-ink-3"}
                  >
                    {row ? row.calls.toLocaleString("en-IN") : "—"}
                  </Td>
                ))}
                <Td align="right" className="text-ink-3">
                  ≥{people}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableFrame>
    </Section>
  );
}

function AddKey() {
  return (
    <Section
      title="Add a key"
      hint="Encrypted at rest by a trigger before it lands. Nothing but the secret key can read it back, and this page never does."
    >
      <ActionForm
        action={addApiKeyAction}
        submitLabel="Add to pool"
        pendingLabel="Adding…"
        variant="primary"
        className="mt-3"
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Provider">
            <select name="provider" defaultValue="gemini" className={INPUT}>
              <option value="gemini">gemini</option>
              <option value="groq">groq</option>
              <option value="openai">openai</option>
              <option value="openrouter">openrouter</option>
            </select>
          </Field>

          <Field label="Model">
            <input name="model" defaultValue="gemini-3.5-flash" required className={INPUT} />
          </Field>

          <Field label="Priority" hint="Lowest is tried first.">
            <input
              name="priority"
              type="number"
              min={0}
              max={999}
              defaultValue={0}
              className={INPUT}
            />
          </Field>

          <Field label="Label" hint="Optional. Which account this key belongs to.">
            <input name="label" placeholder="project-2 · personal" className={INPUT} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="API key">
              <input
                name="apiKey"
                type="password"
                required
                autoComplete="off"
                placeholder="AIza…"
                className={INPUT}
              />
            </Field>
          </div>
        </div>
      </ActionForm>
    </Section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-2xs font-medium tracking-wide text-ink-3 uppercase">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-2xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

const INPUT =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink " +
  "placeholder:text-ink-3 focus:border-line-strong focus:outline-none";
