import { beforeAll, describe, expect, it, vi } from "vitest";

import type { User } from "@supabase/supabase-js";

// `session.ts` pulls in the Supabase clients and the profile columns at import
// time. `userHasPassword` touches neither — it is a pure read of the user
// object — so the module's dependencies are stubbed rather than the function
// being moved somewhere it does not belong.
vi.mock("@/lib/db/clients", () => ({ sessionDb: vi.fn() }));

let userHasPassword: (user: User) => boolean;

beforeAll(async () => {
  ({ userHasPassword } = await import("./session"));
});

/** Only the two fields the function reads; the rest of `User` is irrelevant. */
function userWith(
  app_metadata: Record<string, unknown>,
  user_metadata: Record<string, unknown> = {},
): User {
  return { app_metadata, user_metadata } as unknown as User;
}

describe("userHasPassword", () => {
  it("is true for an account that signed up with an address", () => {
    expect(userHasPassword(userWith({ provider: "email", providers: ["email"] }))).toBe(true);
  });

  it("is false for a Google account that has never set one", () => {
    // The case the wording exists for: nothing in this object says "no
    // password", so the absence of both signals has to be what decides it.
    expect(userHasPassword(userWith({ provider: "google", providers: ["google"] }))).toBe(
      false,
    );
  });

  it("is true once a password has been set on a Google account", () => {
    // Verified against the local stack: setting a password leaves `providers`
    // as `["google"]` and adds no identity, so this flag is the only trace of
    // it. If that ever stops being true, this test is where to notice.
    expect(
      userHasPassword(
        userWith({ provider: "google", providers: ["google"] }, { has_password: true }),
      ),
    ).toBe(true);
  });

  it("treats a linked account with both methods as having one", () => {
    expect(
      userHasPassword(userWith({ provider: "email", providers: ["email", "google"] })),
    ).toBe(true);
  });

  it("does not accept a truthy non-boolean as proof", () => {
    // `user_metadata` is user-writable. That is tolerable for a label, but it
    // should still take the exact value this app writes rather than anything
    // that happens to be truthy.
    expect(userHasPassword(userWith({ providers: ["google"] }, { has_password: "no" }))).toBe(
      false,
    );
    expect(userHasPassword(userWith({ providers: ["google"] }, { has_password: 1 }))).toBe(
      false,
    );
  });

  it("survives metadata that is missing the fields entirely", () => {
    expect(userHasPassword(userWith({}))).toBe(false);
  });
});
