import { describe, expect, it } from "vitest";

import { initialsFrom } from "./initials";

describe("initialsFrom", () => {
  it("takes the first and last word, which is the pair people recognise", () => {
    expect(initialsFrom("Prithwish Das")).toBe("PD");
    // RV, not RK — the family name is the half that identifies someone.
    expect(initialsFrom("Ram Kumar Verma")).toBe("RV");
  });

  it("skips lone middle initials", () => {
    expect(initialsFrom("Ram K Verma")).toBe("RV");
    expect(initialsFrom("A. P. J. Abdul Kalam")).toBe("AK");
  });

  it("gives a single name two letters rather than leaving the circle empty", () => {
    expect(initialsFrom("Prithwish")).toBe("PR");
    // All that exists is one initial, so it beats drawing nothing.
    expect(initialsFrom("R")).toBe("R");
  });

  it("falls back to the address when there is no name", () => {
    // A dot in a local part is where the space would have been.
    expect(initialsFrom(null, "ram.kumar@example.com")).toBe("RK");
    expect(initialsFrom(null, "impdas17@gmail.com")).toBe("IM");
    expect(initialsFrom("", "prithwish@example.com")).toBe("PR");
  });

  it("prefers the name over the address when it has both", () => {
    expect(initialsFrom("Prithwish Das", "someone.else@example.com")).toBe("PD");
  });

  it("treats a name that is an address as an address", () => {
    // Real data: this profile's full_name is an email. The general rules read
    // the domain as a family name and returned PC — P, then the C of "com".
    expect(initialsFrom("Prithwishdas17@gmail.com", "Prithwishdas17@gmail.com")).toBe("PR");
    expect(initialsFrom("ram.kumar@example.com", null)).toBe("RK");
  });

  it("returns null when there is nothing to work with, so the caller draws a glyph", () => {
    expect(initialsFrom(null, null)).toBeNull();
    expect(initialsFrom("   ", null)).toBeNull();
    // Punctuation is not a name; uppercasing it renders as a bug.
    expect(initialsFrom("!!", null)).toBeNull();
    expect(initialsFrom(null, "!!@example.com")).toBeNull();
  });

  it("keeps a consonant and its vowel sign together", () => {
    // A vowel sign is a combining mark, not a letter. Splitting on letters
    // alone shatters this into six fragments and returns पस — two letters from
    // two different syllables. The initial a reader sees is पृ, then दा.
    expect(initialsFrom("पृथ्वीश दास")).toBe("पृदा");
    expect(initialsFrom("Ananya")).toBe("AN");
  });

  it("does not split a surrogate pair down the middle", () => {
    // Deseret capital long I — one code point, two UTF-16 units. A naive
    // slice(0, 2) here yields a replacement character.
    const initials = initialsFrom("\u{10400}");
    expect(initials).toBe("\u{10400}");
  });

  it("strips the digits and punctuation an address local part carries", () => {
    expect(initialsFrom(null, "user_2024@example.com")).toBe("US");
    expect(initialsFrom(null, "a.b@example.com")).toBe("AB");
  });
});
