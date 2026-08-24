import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * These tests exist because the failure mode they guard against is expensive:
 * an app that boots with a missing key and only discovers it at the first
 * query, in production, under load. The contract is that a bad environment
 * fails immediately and names the key.
 */

const VALID_CLIENT = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  NEXT_PUBLIC_SITE_URL: "https://example.com",
};

const VALID_SERVER = {
  SUPABASE_SECRET_KEY: "secret-key",
  REVALIDATE_SECRET: "a".repeat(64),
  CRON_SECRET: "b".repeat(64),
};

function stub(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    vi.stubEnv(key, value);
  }
}

/** Fresh module instance per test — env.ts caches and throws at import time. */
async function loadEnv() {
  vi.resetModules();
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("client environment", () => {
  it("parses a complete environment", async () => {
    stub(VALID_CLIENT);
    const { env } = await loadEnv();
    expect(env.NEXT_PUBLIC_SITE_URL).toBe("https://example.com");
  });

  it("refuses to load when a key is missing, and names it", async () => {
    stub({ ...VALID_CLIENT, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined });
    await expect(loadEnv()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("rejects a malformed URL rather than accepting a typo", async () => {
    stub({ ...VALID_CLIENT, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" });
    await expect(loadEnv()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("server environment", () => {
  it("parses a complete environment", async () => {
    stub({ ...VALID_CLIENT, ...VALID_SERVER });
    const { getServerEnv } = await loadEnv();
    expect(getServerEnv().SUPABASE_SECRET_KEY).toBe("secret-key");
  });

  it("rejects a short REVALIDATE_SECRET", async () => {
    stub({ ...VALID_CLIENT, ...VALID_SERVER, REVALIDATE_SECRET: "too-short" });
    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow(/REVALIDATE_SECRET/);
  });

  it("does not throw at import time, so client builds are unaffected", async () => {
    stub(VALID_CLIENT);
    await expect(loadEnv()).resolves.toBeDefined();
  });
});
