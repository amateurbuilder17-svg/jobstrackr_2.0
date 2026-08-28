import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pool's ordering, which is the whole of what rotation is.
 *
 * Gemini 3.5 Flash is free and therefore capped per minute and per day, both
 * enforced with a 429. Ten keys only help if they are tried in the right order:
 * a key that was rate-limited thirty seconds ago must go to the back of the
 * queue and must still be *in* it, because when every other key is spent it is
 * the only thing left to try.
 *
 * Asserted against the requests that actually reach PostgREST and Google rather
 * than by calling internals, for the same reason as the query contract test: a
 * refactor can move the sort and keep the unit test passing.
 */

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://keys.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_keys",
  NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in",
  SUPABASE_SECRET_KEY: "sb_secret_keys",
  REVALIDATE_SECRET: "r".repeat(64),
  CRON_SECRET: "c".repeat(64),
  GEMINI_MODEL: "gemini-2.5-flash",
};

const MINUTE = 60_000;

interface Row {
  id: string;
  provider: string;
  model_name: string;
  api_key: string | null;
  priority: number;
  label: string;
  last_error: string | null;
  total_calls: number;
  total_errors: number;
  updated_at: string | null;
}

function row(overrides: Partial<Row> & { label: string }): Row {
  return {
    id: `id-${overrides.label}`,
    provider: "gemini",
    model_name: "gemini-2.5-flash",
    api_key: `key-${overrides.label}`,
    priority: 0,
    last_error: null,
    total_calls: 0,
    total_errors: 0,
    updated_at: null,
    ...overrides,
  };
}

/** Rows the fake PostgREST will return for the pool query. */
let pool: Row[] = [];
/** Every URL the code under test requested, in order. */
let requests: string[] = [];

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

beforeEach(() => {
  pool = [];
  requests = [];
  vi.resetModules();

  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);

    const body = url.includes("decrypted_api_keys_config") ? pool : [];
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadApiKeys() {
  const mod = await import("./keys");
  return mod.loadApiKeys();
}

describe("the pool query", () => {
  it("asks for active Gemini keys, cheapest and healthiest first", async () => {
    await loadApiKeys();

    const query = requests.find((u) => u.includes("decrypted_api_keys_config"));
    expect(query, "the pool was never read").toBeDefined();

    const url = new URL(query ?? "");
    expect(url.searchParams.get("is_active")).toBe("eq.true");
    // A Groq or OpenAI key cannot carry Google Search grounding, and an
    // ungrounded answer about this week's admit card is the failure the whole
    // feature exists to avoid.
    expect(url.searchParams.get("provider")).toBe("eq.gemini");
    // PostgREST folds multiple .order() calls into one comma-separated param.
    expect(url.searchParams.get("order")).toBe("priority.asc,total_errors.asc");
    // Bounded, like every other query in this codebase.
    expect(url.searchParams.get("limit")).not.toBeNull();
    // Named columns, never `*`.
    expect(url.searchParams.get("select")).not.toBe("*");
  });
});

describe("ordering", () => {
  it("keeps the database's order when nothing is cooling down", async () => {
    pool = [row({ label: "a" }), row({ label: "b" }), row({ label: "c" })];

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.label)).toEqual(["a", "b", "c"]);
  });

  it("sorts a recently rate-limited key to the back, and keeps it", async () => {
    pool = [
      row({
        label: "spent",
        last_error: "429: rate limited",
        updated_at: new Date().toISOString(),
      }),
      row({ label: "fresh" }),
    ];

    const keys = await loadApiKeys();

    // Last, not gone. When "fresh" is spent too, "spent" is the only thing left
    // to try — and by then its minute may well have elapsed.
    expect(keys.map((k) => k.label)).toEqual(["fresh", "spent"]);
  });

  it("treats a key whose rate limit has expired as fresh again", async () => {
    pool = [
      row({
        label: "recovered",
        last_error: "429: rate limited",
        updated_at: new Date(Date.now() - 5 * MINUTE).toISOString(),
      }),
      row({ label: "other" }),
    ];

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.label)).toEqual(["recovered", "other"]);
  });

  it("does not treat a non-429 failure as a cooldown", async () => {
    // A 500 from Google says nothing about this key's quota. Demoting it would
    // hand the load to a key that may be closer to its own limit.
    pool = [
      row({
        label: "errored",
        last_error: "500: upstream",
        updated_at: new Date().toISOString(),
      }),
      row({ label: "other" }),
    ];

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.label)).toEqual(["errored", "other"]);
  });
});

describe("keys that cannot be used", () => {
  it("skips a key that did not decrypt rather than sending null to Google", async () => {
    // `decrypt_api_key` returns null to an unauthorised caller and to
    // ciphertext it cannot open. Either way the row is unusable, and passing it
    // on would spend an attempt and blame a healthy key.
    pool = [row({ label: "unreadable", api_key: null }), row({ label: "good" })];

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.label)).toEqual(["good"]);
  });

  it("carries each key's own model, so one key can be pinned elsewhere", async () => {
    pool = [row({ label: "pinned", model_name: "gemini-2.5-flash-lite" })];

    const keys = await loadApiKeys();
    expect(keys[0]?.model).toBe("gemini-2.5-flash-lite");
  });
});

describe("the environment fallback", () => {
  it("is used when the table is empty, so a bare deployment still works", async () => {
    vi.stubEnv("GEMINI_API_KEY", "env-single");

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.key)).toEqual(["env-single"]);
    // Marked so nothing tries to write stats to a row that does not exist.
    expect(keys[0]?.id.startsWith("env-")).toBe(true);

    vi.stubEnv("GEMINI_API_KEY", "");
  });

  it("reads the numbered pool the old project named", async () => {
    // These are the variable names the keys are already stored under. Reading
    // them means an existing setup pastes across without being renamed.
    vi.stubEnv("GEMINI_API_KEY", "k1");
    vi.stubEnv("GEMINI_API_KEY_2", "k2");
    vi.stubEnv("GEMINI_API_KEY_10", "k10");

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.key)).toEqual(["k1", "k2", "k10"]);

    for (const name of ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_10"]) {
      vi.stubEnv(name, "");
    }
  });

  it("reads a comma-separated pool, de-duplicated, with the named key first", async () => {
    // Precedence is deliberate: the single `GEMINI_API_KEY` is the one every
    // environment sets and the one an operator thinks of as "the" key, so it
    // is tried first. `two` appearing in both spellings is still one key.
    vi.stubEnv("GEMINI_API_KEY", "two");
    vi.stubEnv("GEMINI_API_KEYS", "one, two ,one");

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.key)).toEqual(["two", "one"]);

    vi.stubEnv("GEMINI_API_KEYS", "");
    vi.stubEnv("GEMINI_API_KEY", "");
  });

  it("is not used when the table has rows — the table is the source of truth", async () => {
    vi.stubEnv("GEMINI_API_KEY", "env-single");
    pool = [row({ label: "from-db" })];

    const keys = await loadApiKeys();
    expect(keys.map((k) => k.label)).toEqual(["from-db"]);

    vi.stubEnv("GEMINI_API_KEY", "");
  });
});
