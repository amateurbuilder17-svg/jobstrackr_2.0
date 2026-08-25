import { beforeEach, describe, expect, it, vi } from "vitest";

import { consume, resetRateLimits } from "./rate-limit";

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
