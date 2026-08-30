/**
 * The two letters that stand in for a person in the top bar.
 *
 * Nothing here imports anything, deliberately — the same reason `enums.ts` is
 * separate from `schemas.ts`. This runs on the server to build the session
 * payload, and a Client Component reaching into a module with Zod behind it is
 * how /profile went 58 kB over budget once already.
 *
 * The rules, in order, and each exists because the one above it produced a bad
 * avatar for a real account shape:
 *
 *   1. Two or more words → first letter of the first and last word. "Prithwish
 *      Das" is PD, and "Ram Kumar Verma" is RV rather than RK, because the
 *      family name is the half people recognise.
 *   2. Lone initials are not words. "Ram K Verma" is RV, not RK.
 *   3. One word → its first two letters. "Prithwish" is PR, not P, so the
 *      circle is not three-quarters empty.
 *   4. No name → the email's local part, by the same rules. `ram.kumar@…` is
 *      RK, because a dot in an address is where the space would have been.
 *   5. Nothing usable → null, and the caller draws a glyph. An empty circle
 *      reads as a broken avatar; an icon admits there is no name yet.
 *
 * Non-letters are dropped before any of this. An account named "!!" is not a
 * name, and rendering it uppercased produces an avatar that looks like a bug.
 */
export function initialsFrom(name?: string | null, email?: string | null): string | null {
  // A name that is an address is treated as one. Plenty of profiles have an
  // email in `full_name` — some OAuth providers put it there, and people type
  // it into the wrong field — and the general rules read the domain as the
  // family name: "prithwish@gmail.com" came out PC, the P of the local part and
  // the C of "com". Taking the local part first gives PR.
  const cleaned = name?.includes("@") ? localPart(name) : name;
  return fromName(cleaned) ?? fromName(localPart(email));
}

/** The part of an address before the `@`. */
function localPart(email?: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

function fromName(value?: string | null): string | null {
  if (!value) return null;

  // Split on anything that is neither a letter nor a combining mark: spaces,
  // but also the dots and underscores separating the words in `ram.kumar@…`,
  // which is a name written in the only punctuation an address allows.
  //
  // `\p{M}` is load-bearing and was missing at first. A Devanagari vowel sign
  // is a mark, not a letter, so a letters-only split shattered "पृथ्वीश दास"
  // into six one-character fragments and returned the first and last of those
  // — पस, two letters from two different syllables of two different words.
  const all = value.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  if (all.length === 0) return null;

  // Lone initials are dropped — unless that is all there is, in which case a
  // middle initial is better than no avatar.
  const multi = all.filter((word) => letters(word).length > 1);
  const words = multi.length > 0 ? multi : all;

  // Destructured rather than indexed: `noUncheckedIndexedAccess` is on, and it
  // is right to be — `words` is non-empty by the guard above, but the compiler
  // cannot see that through a length check.
  const [head] = words;
  const tail = words[words.length - 1];
  if (!head || !tail) return null;

  if (words.length === 1) {
    return letters(head).slice(0, 2).join("").toUpperCase();
  }

  const first = letters(head)[0] ?? "";
  const last = letters(tail)[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Graphemes, not characters.
 *
 * `slice(0, 2)` on UTF-16 units cuts a surrogate pair in half and renders a
 * replacement character; `Array.from` fixes that but still separates a
 * Devanagari consonant from its vowel sign, so "दास" would contribute a bare
 * द where the letter a reader sees is दा. `Intl.Segmenter` is the built-in
 * that gets both right, and it costs nothing — this only ever runs on the
 * server, building the session payload.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function letters(word: string): string[] {
  return [...segmenter.segment(word)].map((piece) => piece.segment);
}
