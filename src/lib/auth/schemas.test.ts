import { describe, expect, it } from "vitest";

import {
  educationSchema,
  fieldErrors,
  profileSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "./schemas";

/**
 * The Module 6 validation gate.
 *
 * These schemas are the single agreement between the form, the server action
 * and the CHECK constraints in the migrations. The tests that matter here are
 * the ones covering the gap between "what an HTML form posts" and "what the
 * column accepts" — empty strings, numeric strings, and bounds that mirror a
 * constraint rather than a preference.
 */

/** Every optional profile field left untouched by the user. */
const BLANK_PROFILE = {
  fullName: "Asha Menon",
  phone: "",
  dateOfBirth: "",
  gender: null,
  category: null,
  state: "",
  district: "",
  highestQualification: null,
  experienceYears: "",
  preferredSectors: [],
  preferredStates: [],
};

describe("email handling", () => {
  it("lowercases and trims, so the same person is one account", () => {
    const parsed = signInSchema.parse({
      email: "  Asha.Menon@Example.COM ",
      password: "whatever",
    });
    expect(parsed.email).toBe("asha.menon@example.com");
  });

  it("rejects a malformed address", () => {
    expect(signInSchema.safeParse({ email: "asha@", password: "x" }).success).toBe(false);
  });
});

describe("passwords", () => {
  it("requires 8 characters when creating one", () => {
    const short = signUpSchema.safeParse({
      email: "a@b.com",
      password: "short12",
      fullName: "Asha Menon",
    });
    expect(short.success).toBe(false);
  });

  it("imposes no length floor when signing in", () => {
    // A floor here would lock out anyone whose password predates the rule, and
    // would leak that a short guess was "invalid" rather than merely wrong.
    expect(signInSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });

  it("rejects a mismatched confirmation, reported on the confirm field", () => {
    const result = updatePasswordSchema.safeParse({
      password: "correcthorse",
      confirmPassword: "correcthorsx",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toHaveProperty("confirmPassword");
    }
  });
});

describe("profile — empty form fields", () => {
  it("stores null rather than empty string for every untouched field", () => {
    const parsed = profileSchema.parse(BLANK_PROFILE);

    // `""` and `null` look identical to a person and behave differently in a
    // query. Only one of them may reach a nullable column.
    expect(parsed.phone).toBeNull();
    expect(parsed.dateOfBirth).toBeNull();
    expect(parsed.state).toBeNull();
    expect(parsed.district).toBeNull();
    expect(parsed.experienceYears).toBeNull();
  });

  it("defaults the multi-selects to empty arrays, matching the column default", () => {
    const parsed = profileSchema.parse(BLANK_PROFILE);
    expect(parsed.preferredSectors).toEqual([]);
    expect(parsed.preferredStates).toEqual([]);
  });
});

describe("profile — phone", () => {
  it.each(["9876543210", "6000000000"])("accepts %s", (phone) => {
    expect(profileSchema.safeParse({ ...BLANK_PROFILE, phone }).success).toBe(true);
  });

  it.each([
    ["5876543210", "leading digit below 6"],
    ["987654321", "nine digits"],
    ["98765432100", "eleven digits"],
    ["+919876543210", "country code"],
  ])("rejects %s (%s)", (phone) => {
    expect(profileSchema.safeParse({ ...BLANK_PROFILE, phone }).success).toBe(false);
  });
});

describe("profile — bounds mirroring the CHECK constraints", () => {
  it("rejects a date of birth before the 1940 floor", () => {
    const result = profileSchema.safeParse({
      ...BLANK_PROFILE,
      dateOfBirth: "1939-12-31",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a date of birth in the future", () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const result = profileSchema.safeParse({
      ...BLANK_PROFILE,
      dateOfBirth: nextYear.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });

  it("accepts experience at both ends of 0–60 and rejects beyond", () => {
    for (const years of ["0", "60"]) {
      expect(
        profileSchema.safeParse({ ...BLANK_PROFILE, experienceYears: years }).success,
      ).toBe(true);
    }
    expect(profileSchema.safeParse({ ...BLANK_PROFILE, experienceYears: "61" }).success).toBe(
      false,
    );
  });

  it("rejects fractional years, because the column is a smallint", () => {
    expect(profileSchema.safeParse({ ...BLANK_PROFILE, experienceYears: "2.5" }).success).toBe(
      false,
    );
  });
});

describe("education", () => {
  const BASE = {
    level: "bachelor",
    discipline: "",
    institution: "",
    boardUniversity: "",
    yearOfPassing: "",
    percentage: "",
  };

  it("accepts a future passing year within the six-year window", () => {
    // Someone in year one of a five-year integrated course has a real future
    // passing year — this mirrors `education_year_sane`.
    const inFive = new Date().getFullYear() + 5;
    expect(educationSchema.safeParse({ ...BASE, yearOfPassing: String(inFive) }).success).toBe(
      true,
    );
  });

  it("rejects a passing year beyond that window", () => {
    const inTen = new Date().getFullYear() + 10;
    expect(educationSchema.safeParse({ ...BASE, yearOfPassing: String(inTen) }).success).toBe(
      false,
    );
  });

  it("rejects a year before 1950", () => {
    expect(educationSchema.safeParse({ ...BASE, yearOfPassing: "1949" }).success).toBe(false);
  });

  it.each(["0", "100", "62.75"])("accepts percentage %s", (percentage) => {
    expect(educationSchema.safeParse({ ...BASE, percentage }).success).toBe(true);
  });

  it.each(["-1", "101"])("rejects percentage %s", (percentage) => {
    expect(educationSchema.safeParse({ ...BASE, percentage }).success).toBe(false);
  });

  it("rejects a level outside the enum", () => {
    expect(educationSchema.safeParse({ ...BASE, level: "postdoc" }).success).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("keys messages by field and keeps the first per field", () => {
    const result = signUpSchema.safeParse({
      email: "not-an-email",
      password: "short",
      fullName: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["email", "fullName", "password"]);
      expect(typeof errors.email).toBe("string");
    }
  });
});
