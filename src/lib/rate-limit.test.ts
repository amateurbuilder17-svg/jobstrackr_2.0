import { beforeEach, describe, expect, it, vi } from "vitest";

import { consume, LIMITS, resetRateLimits } from "./rate-limit";

beforeEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

const limit = { limit: 3, windowMs: 1000 };

describe("token bucket", () => {
  it("allows up to the limit then refuses", () => {
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(false);
  });

  it("keeps callers separate", () => {
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(false);
    // b has its own allowance; a's exhaustion must not spill over.
    expect(consume("b", limit)).toBe(true);
  });

  it("refills over time", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(false);

    vi.advanceTimersByTime(400); // 40% of a window ≈ 1.2 tokens
    expect(consume("a", limit)).toBe(true);
    expect(consume("a", limit)).toBe(false);
  });

  it("does not let a refused caller reset their own window", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) consume("a", limit);

    // Hammering while refused must not advance the clock the bucket refills
    // against — otherwise the punishment for abuse is a fresh allowance.
    for (let i = 0; i < 50; i++) expect(consume("a", limit)).toBe(false);

    vi.advanceTimersByTime(340);
    expect(consume("a", limit)).toBe(true);
  });
});

describe("sign-in brute-force floor", () => {
  it("absorbs a real person mistyping, then refuses a run of guesses", () => {
    const key = "signin:asha@example.com";

    // Someone fumbling their own password. Five wrong attempts in a row is
    // already unusual; none of them may be turned away.
    for (let i = 0; i < 5; i++) {
      expect(consume(key, LIMITS.signIn)).toBe(true);
    }

    // A password list keeps going. The remaining allowance runs out and the
    // rest of the run is refused.
    for (let i = 5; i < LIMITS.signIn.limit; i++) {
      expect(consume(key, LIMITS.signIn)).toBe(true);
    }
    expect(consume(key, LIMITS.signIn)).toBe(false);
  });

  it("limits per address, so one account under attack cannot lock out another", () => {
    const target = "signin:victim@example.com";
    for (let i = 0; i < LIMITS.signIn.limit; i++) consume(target, LIMITS.signIn);
    expect(consume(target, LIMITS.signIn)).toBe(false);

    expect(consume("signin:someone-else@example.com", LIMITS.signIn)).toBe(true);
  });
});
