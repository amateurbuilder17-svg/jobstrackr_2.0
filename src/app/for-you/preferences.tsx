import type { ProfileRow } from "@/lib/profile/columns";
import { updateMatchPreferencesAction } from "@/lib/profile/actions";
import { GRADES, SALARY_BANDS, SKILL_GROUPS, salaryBandOf } from "@/lib/match/vocab";
import { INDIAN_STATES, SECTORS } from "@/lib/vocab";

/**
 * The old wizard, as one panel.
 *
 * Six screens in the old app — age, qualification, skills, sectors, salary,
 * location, grade — asked once and then effectively unreachable, because
 * re-running the wizard meant clearing `localStorage`. Two of those questions
 * are now the completer above; the other five are here, always editable,
 * directly above the feed they change.
 *
 * ── No JavaScript ─────────────────────────────────────────────────────────
 * Every control is a native checkbox or radio inside a plain `<form>` posting
 * to a Server Action, and the selected state is drawn by `has-[:checked]:` —
 * CSS, not React. Sixty checkboxes as a Client Component would be about two
 * kilobytes of code plus every label string in the RSC payload, against a route
 * budget with roughly one kilobyte spare. This ships as HTML.
 *
 * `<details>` for the same reason: a disclosure that works before hydration,
 * costs nothing, and keeps a long form out of the way of the answer the reader
 * came for. It reopens after a save because the redirect carries `?prefs=`.
 */
export function MatchPreferences({
  profile,
  open,
  notice,
}: {
  profile: ProfileRow;
  open: boolean;
  notice: "saved" | "slow" | null;
}) {
  const summary = describePreferences(profile);

  return (
    <details open={open} className="mt-6 rounded-lg border border-line bg-surface">
      <summary
        className={
          "flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 " +
          "text-sm font-semibold text-ink transition-colors duration-(--duration-fast) " +
          "hover:bg-surface-2"
        }
      >
        <span>What you are matched on</span>
        <span className="cond truncate text-xs font-medium text-ink-3">{summary}</span>
      </summary>

      <form action={updateMatchPreferencesAction} className="border-t border-line px-4 py-4">
        {notice ? (
          <p
            className={
              "mb-4 rounded-md border px-3 py-2 text-sm " +
              (notice === "saved"
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-warn/30 bg-warn-soft text-warn")
            }
            role="status"
          >
            {notice === "saved"
              ? "Saved. The feed below is rebuilt."
              : "Too many changes at once. Give it a moment and try again."}
          </p>
        ) : null}

        <p className="text-sm text-ink-2">
          None of this is required. Each answer narrows or reorders the feed —
          <strong className="font-medium text-ink"> skills do the most work</strong>, because a
          posting asking for one you have not claimed sits under &ldquo;one skill away&rdquo;
          rather than under your matches.
        </p>

        {/* ── Skills ────────────────────────────────────────────────────── */}
        {SKILL_GROUPS.map((group) => (
          <Group key={group.title} title={group.title} hint={group.hint}>
            {group.skills.map((skill) => (
              <Chip
                key={skill.value}
                name="skills"
                value={skill.value}
                label={skill.label}
                checked={profile.skills.includes(skill.value)}
              />
            ))}
          </Group>
        ))}

        {/* ── Sectors ───────────────────────────────────────────────────── */}
        <Group title="Sectors" hint="Matching postings are ranked higher, never filtered out.">
          {SECTORS.map((sector) => (
            <Chip
              key={sector.value}
              name="preferredSectors"
              value={sector.value}
              label={sector.label}
              checked={profile.preferred_sectors.includes(sector.value)}
            />
          ))}
        </Group>

        {/* ── Post classification ───────────────────────────────────────── */}
        <Group
          title="Post classification"
          hint="A posting whose class cannot be read from its title is never hidden by this."
        >
          {GRADES.map((grade) => (
            <Chip
              key={grade.value}
              name="preferredGrades"
              value={grade.value}
              label={grade.label}
              checked={profile.preferred_grades.includes(grade.value)}
            />
          ))}
        </Group>

        {/* ── Salary ────────────────────────────────────────────────────── */}
        <Group
          title="Expected pay"
          hint="A posting that states no salary is shown regardless — silence is not a mismatch."
        >
          <Chip
            name="salaryBand"
            value=""
            label="No preference"
            checked={
              profile.preferred_salary_min === null && profile.preferred_salary_max === null
            }
            type="radio"
          />
          {SALARY_BANDS.map((band) => (
            <Chip
              key={band.value}
              name="salaryBand"
              value={band.value}
              label={band.label}
              checked={
                salaryBandOf(profile.preferred_salary_min, profile.preferred_salary_max) ===
                band.value
              }
              type="radio"
            />
          ))}
        </Group>

        {/* ── States ────────────────────────────────────────────────────── */}
        <Group
          title="Where you would work"
          hint="Nothing is excluded by this. Matches in these states are ranked first, and all-India postings stay visible."
        >
          {INDIAN_STATES.filter((state) => state !== "All India").map((state) => (
            <Chip
              key={state}
              name="preferredStates"
              value={state}
              label={state}
              checked={profile.preferred_states.includes(state)}
            />
          ))}
        </Group>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            className={
              "inline-flex h-9.5 items-center rounded-md bg-accent px-4 text-sm font-semibold " +
              "text-on-accent transition-colors duration-(--duration-fast) hover:bg-accent-hover"
            }
          >
            Save and rebuild my feed
          </button>
          <p className="text-xs text-ink-3">Age and qualification live on your profile.</p>
        </div>
      </form>
    </details>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mt-5 border-t border-line pt-4 first-of-type:mt-6">
      <legend className="sr-only">{title}</legend>
      <p className="cond text-2xs font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
      <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

/**
 * One toggle.
 *
 * The input is visually hidden but still focusable and still the accessible
 * control — `sr-only`, not `display: none`, which would take it out of the tab
 * order and out of the form. `has-[:checked]:` reads the input's state from the
 * label, so selection is drawn by the browser rather than by React.
 */
function Chip({
  name,
  value,
  label,
  checked,
  type = "checkbox",
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  type?: "checkbox" | "radio";
}) {
  return (
    <label
      className={
        "inline-flex cursor-pointer items-center rounded-full border border-line bg-surface " +
        "px-2.5 py-1 text-xs font-medium text-ink-2 " +
        "transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-2 " +
        "has-[:checked]:border-accent-line has-[:checked]:bg-accent-soft has-[:checked]:text-accent " +
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 " +
        "has-[:focus-visible]:outline-accent"
      }
    >
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={checked}
        className="sr-only"
      />
      {label}
    </label>
  );
}

/** The one-line summary on the collapsed row, so it says something when shut. */
function describePreferences(profile: ProfileRow): string {
  const parts: string[] = [];
  const count = (n: number, one: string, many: string) =>
    `${String(n)} ${n === 1 ? one : many}`;

  if (profile.skills.length > 0) parts.push(count(profile.skills.length, "skill", "skills"));
  if (profile.preferred_sectors.length > 0) {
    parts.push(count(profile.preferred_sectors.length, "sector", "sectors"));
  }
  if (profile.preferred_states.length > 0) {
    parts.push(count(profile.preferred_states.length, "state", "states"));
  }
  if (profile.preferred_grades.length > 0) parts.push(profile.preferred_grades.join(", "));
  return parts.length > 0 ? parts.join(" · ") : "Nothing set yet";
}
