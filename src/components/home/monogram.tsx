import { cn } from "@/lib/cn";

/**
 * An organisation's initials in a tile, standing in for a logo.
 *
 * The old app shipped a 13 kB client-side lookup table to map an organisation
 * to a logo file, and the job cards still fell back to text for most rows
 * because the table did not cover the long tail of state commissions. Initials
 * cover every organisation, cost nothing, and — being set in the condensed face
 * — fit four characters ("UPPSC") without shrinking.
 *
 * Monochrome on purpose. A per-organisation tint is the obvious next idea and
 * the wrong one: colour in this system means state — a deadline, an eligibility
 * verdict — and spending it on decoration is what makes a coloured deadline
 * stop registering.
 */
export function Monogram({
  name,
  className,
  tone = "soft",
}: {
  name: string | null | undefined;
  className?: string;
  /** `soft` for a tinted tile, `outline` for a hairline one on a filled ground. */
  tone?: "soft" | "outline";
}) {
  const initials = toInitials(name);
  if (!initials) return null;

  return (
    <span
      aria-hidden
      className={cn(
        "cond flex shrink-0 items-center justify-center rounded-lg border",
        "text-2xs font-bold tracking-wide",
        tone === "soft"
          ? "border-line bg-surface-2 text-ink-2"
          : "border-white/20 bg-white/10 text-white",
        "size-9",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/**
 * "Union Public Service Commission" → "UPSC"; "UPSC" → "UPSC".
 *
 * An already-abbreviated short_name is the common case and must survive
 * untouched, so an all-caps input is returned as-is rather than having its own
 * first letters taken — which would turn "UPSC" into "U".
 */
export function toInitials(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value) return null;

  if (/^[A-Z0-9&.\-/]+$/.test(value)) return value.replace(/[^A-Z0-9]/g, "").slice(0, 5);

  const letters = value
    .split(/\s+/)
    // Joining words carry no identity — "Board of Secondary Education" should
    // read BSE, not BOSE.
    .filter((word) => !STOPWORDS.has(word.toLowerCase()))
    .map((word) => word[0] ?? "")
    .filter((char) => /[A-Za-z0-9]/.test(char));

  return letters.join("").toUpperCase().slice(0, 4) || null;
}

const STOPWORDS = new Set(["of", "the", "and", "for", "in", "on", "at", "&"]);
