import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a failed pool tells the caller.
 *
 * The pool has two failure modes that look identical from the outside and are
 * opposite in what should happen next. Every key rate-limited is "wait" — the
 * keys are fine, the minute is not. Every key refused is "this deployment
 * cannot answer" — waiting changes nothing, and each retry costs the person one
 * of ten daily refreshes to be told the same thing. `GeminiError.unusable` is
 * that distinction, and it is what the refresh route reads to pick between
 * "try again shortly" and "not configured".
 *
 * Asserted through `generate` rather than by calling the walk directly, because
 * the second half of the fix is that an unusable pool is not walked twice.
 */

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://gemini.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_gemini",
  NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in",
  SUPABASE_SECRET_KEY: "sb_secret_gemini",
  REVALIDATE_SECRET: "r".repeat(64),
  CRON_SECRET: "c".repeat(64),
  GEMINI_MODEL: "gemini-2.5-flash",
  // Two keys, so "every key" means more than one.
  GEMINI_API_KEY: "first",
  GEMINI_API_KEY_2: "second",
};

const REFUSED = JSON.stringify({
  error: { code: 400, message: "API key not valid. Please pass a valid API key." },
});

/** Every Gemini call the walk made, as `{ key, grounded }`. */
let calls: { key: string; grounded: boolean }[] = [];

function stubGemini(reply: (call: { key: string; grounded: boolean }) => Response) {
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // The empty pool table, so the environment fallback is what gets walked.
    if (!url.includes("generativelanguage")) {
      return Promise.resolve(
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }

    const raw = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(raw) as { tools?: unknown[] };
    // Read from the header, and assert the key is nowhere in the URL — a
    // secret in a query string is a secret in every proxy log it passes.
    expect(url).not.toContain("key=");
    const headers = new Headers(init?.headers);
    const call = {
      key: headers.get("x-goog-api-key") ?? "",
      grounded: body.tools !== undefined,
    };
    calls.push(call);
    return Promise.resolve(reply(call));
  });
}

async function generate() {
  const mod = await import("./gemini");
  return mod.generate({ system: "s", prompt: "p" });
}

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

beforeEach(() => {
  calls = [];
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a pool Google refuses", () => {
  it("reports itself as unusable rather than as a bad moment", async () => {
    stubGemini(() => new Response(REFUSED, { status: 400 }));

    await expect(generate()).rejects.toMatchObject({ unusable: true, exhausted: false });
  });

  it("is walked once, not once grounded and once without", async () => {
    // The key is checked before the tools are, so dropping grounding cannot
    // rescue a refused key — it only doubles the wait for a decided failure.
    stubGemini(() => new Response(REFUSED, { status: 400 }));

    await expect(generate()).rejects.toThrow();
    expect(calls.map((c) => c.key)).toEqual(["first", "second"]);
  });
});

describe("a pool that is merely spent", () => {
  it("is exhausted, not unusable, and does get the ungrounded retry", async () => {
    // Grounding carries its own quota, so a 429 on the grounded call is one of
    // the strongest reasons to try the same keys without the tool.
    stubGemini(() => new Response("{}", { status: 429 }));

    await expect(generate()).rejects.toMatchObject({ unusable: false, exhausted: true });
    expect(calls.map((c) => c.grounded)).toEqual([true, true, false, false]);
  });
});

describe("a key refused the model", () => {
  const REFUSED_MODEL = JSON.stringify({
    error: {
      code: 404,
      message:
        "This model models/gemini-2.5-flash is no longer available to new users. " +
        "Please update your code to use models/gemini-3.6-flash.",
    },
  });

  const answer = JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });

  it("is skipped on the next call instead of costing an attempt every time", async () => {
    // The live case: a key created after gemini-2.5-flash closed to new
    // projects. The key is fine; the pairing is not. Before this it was a
    // generic error — recorded, never disabled, retried forever.
    stubGemini((call) =>
      call.key === "first"
        ? new Response(REFUSED_MODEL, { status: 404 })
        : new Response(answer, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
    );

    const mod = await import("./gemini");
    const req = { system: "s", prompt: "p" };

    expect((await mod.generate(req)).text).toBe("ok");
    expect(calls.map((c) => c.key)).toEqual(["first", "second"]);

    calls = [];
    expect((await mod.generate(req)).text).toBe("ok");
    // "first" is not asked again. Its model is what was refused, not the key.
    expect(calls.map((c) => c.key)).toEqual(["second"]);
  });

  it("reports a pool that no key may serve as unusable, not as a bad moment", async () => {
    // A model name that is simply wrong lands here too, and "the deployment is
    // misconfigured" is the honest thing to say about it.
    stubGemini(() => new Response(REFUSED_MODEL, { status: 404 }));

    await expect(generate()).rejects.toMatchObject({ unusable: true, exhausted: false });
  });
});

describe("a pool with one good key", () => {
  it("answers, and does not report the pool as unusable", async () => {
    stubGemini((call) =>
      call.key === "first"
        ? new Response(REFUSED, { status: 400 })
        : new Response(
            JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
    );

    const result = await generate();
    expect(result.text).toBe("ok");
    expect(result.grounded).toBe(true);
  });
});
