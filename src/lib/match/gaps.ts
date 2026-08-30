import { QUALIFICATION_LABELS, type QUALIFICATION_LEVELS } from "@/lib/profile/enums";
import { skillLabel } from "./vocab";

/**
 * Turning a gap code into a sentence.
 *
 * `match_feed` returns `kind:value` codes rather than prose, for the reason
 * migration 0022 gave when it did the same for `blocker_value`: the labels
 * already exist in TypeScript — `QUALIFICATION_LABELS` is what the profile form
 * renders, `skillLabel` is what the preferences form renders — and a second
 * copy of them in SQL is two lists that disagree the first time one is edited.
 *
 * ── Why the kind matters as much as the sentence ───────────────────────────
 * Four of these mean "the notification did not say", and the reader can do
 * nothing about those but open the notification. The rest mean "you have not
 * told us", and those are one form away from being resolved. Rendering both in
 * the same grey chip wastes the distinction — the whole reason the old app's
 * For You page was trusted is that it said which kind of unknown it had hit.
 */
export type GapKind =
  /** The posting asks for a skill the profile does not claim. Acquirable. */
  | "skill"
  /** A standard or registration that cannot be acquired before a deadline. */
  | "gate"
  /** The profile has not answered. One form away from resolved. */
  | "profile"
  /** The notification's own wording could not be read. Nothing to fix here. */
  | "notification"
  /** A stated requirement definitely not met. */
  | "blocked";

export interface Gap {
  code: string;
  label: string;
  kind: GapKind;
}

const STREAM_LABELS: Record<string, string> = {
  engineering: "an engineering",
  medical: "a medical",
  nursing: "a nursing",
  pharmacy: "a pharmacy",
  teaching: "a teaching",
  law: "a law",
  commerce: "a commerce",
  computer: "a computing",
  agriculture: "an agriculture",
};

/** `"21-30|35"` → `"21–30, you are 35"`. */
function describeAge(value: string): string {
  const [range = "", age = ""] = value.split("|");
  const [min, max] = range.split("-");
  const window = min && max ? `${min}–${max}` : min ? `${min} and over` : `up to ${max ?? ""}`;
  return age ? `Age limit ${window}, you are ${age}` : `Age limit ${window}`;
}

export function describeGap(code: string): Gap {
  // Split on the first colon only: an age value is `21-30|35` and a skill tag
  // is `typing_hindi`, neither of which contains one, but composing the rule
  // this way means a future value may.
  const separator = code.indexOf(":");
  const kind = separator === -1 ? code : code.slice(0, separator);
  const value = separator === -1 ? "" : code.slice(separator + 1);

  switch (kind) {
    case "skill":
      return { code, kind: "skill", label: skillLabel(value) };

    case "gate":
      return { code, kind: "gate", label: skillLabel(value) };

    // ── The profile has not answered ────────────────────────────────────────
    case "unknown":
      switch (value) {
        case "age":
          return {
            code,
            kind: "profile",
            label: "Add your date of birth to check the age limit",
          };
        case "level":
          return { code, kind: "profile", label: "Add your highest qualification" };
        case "stream":
          return { code, kind: "profile", label: "Add your subject or discipline" };
        case "gender":
          return {
            code,
            kind: "profile",
            label: "This post is restricted by gender — add yours",
          };
        case "experience":
          return { code, kind: "profile", label: "Add your years of experience" };
        default:
          return { code, kind: "profile", label: "Your profile is missing something" };
      }

    // ── The notification did not say ────────────────────────────────────────
    case "unstated":
      return {
        code,
        kind: "notification",
        label:
          value === "stream"
            ? "Discipline not stated — read the notification"
            : "Qualification not stated — read the notification",
      };

    // ── A stated requirement, definitely not met ────────────────────────────
    case "age":
      return { code, kind: "blocked", label: describeAge(value) };

    case "qualification": {
      const label = QUALIFICATION_LABELS[value as (typeof QUALIFICATION_LEVELS)[number]] as
        string | undefined;
      return {
        code,
        kind: "blocked",
        label: label ? `Requires ${label}` : "Requires a higher qualification",
      };
    }

    case "stream": {
      const label = STREAM_LABELS[value];
      return {
        code,
        kind: "blocked",
        label: label ? `Requires ${label} discipline` : "Requires a different discipline",
      };
    }

    case "gender":
      return {
        code,
        kind: "blocked",
        label: value === "female" ? "Open to women only" : "Open to men only",
      };

    case "experience":
      return {
        code,
        kind: "blocked",
        label: value ? `Needs ${value} years of experience` : "Needs more experience",
      };

    default:
      // Not reachable from the current function, and deliberately not a throw:
      // a tag added in SQL ahead of this file should render as itself rather
      // than take the page down.
      return { code, kind: "notification", label: code };
  }
}

/**
 * The `Badge` tone a gap should carry.
 *
 * Semantic colour is reserved for genuine state in this palette, and a gap is
 * one — but only the definite failures earn the loud end of it. An unanswered
 * profile field is not a warning, it is a to-do.
 */
export function gapTone(kind: GapKind): "neutral" | "warn" | "accent" {
  switch (kind) {
    case "blocked":
    case "gate":
      return "warn";
    case "profile":
      return "accent";
    default:
      return "neutral";
  }
}
