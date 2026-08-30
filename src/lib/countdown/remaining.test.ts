import { describe, expect, it } from "vitest";

import {
  absolute,
  endOfDayIst,
  formatParts,
  formatRemaining,
  remainingUntil,
  tickInterval,
} from "./remaining";

const now = new Date("2026-08-29T12:00:00.000Z");
const inMs = (ms: number) => new Date(now.getTime() + ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("remainingUntil", () => {
  it("breaks the gap into parts that add back up", () => {
    const r = remainingUntil(inMs(3 * DAY + 4 * HOUR + 5 * MINUTE + 6 * SECOND), now);
    expect(r).toMatchObject({ days: 3, hours: 4, minutes: 5, seconds: 6, passed: false });
  });

  it("knows when a deadline has gone", () => {
    expect(remainingUntil(inMs(-1), now).passed).toBe(true);
    // Exactly on the instant counts as passed: at 00:00:00 left, the window
    // is shut, and rendering "0s left" implies it is not.
    expect(remainingUntil(now, now).passed).toBe(true);
  });

  it("flags the last day and nothing wider", () => {
    expect(remainingUntil(inMs(23 * HOUR), now).urgent).toBe(true);
    expect(remainingUntil(inMs(25 * HOUR), now).urgent).toBe(false);
    // A passed deadline is not urgent — it is over, and the two states want
    // different colours.
    expect(remainingUntil(inMs(-HOUR), now).urgent).toBe(false);
  });

  it("treats an unreadable date as passed rather than as expiring now", () => {
    // The alarming failure would be rendering "0s left" for a date we cannot
    // parse — that reads as "it just closed".
    const r = remainingUntil("not a date", now);
    expect(r.passed).toBe(true);
    expect(r.urgent).toBe(false);
  });

  it("accepts an ISO string, which is what the database returns", () => {
    const r = remainingUntil("2026-08-30T12:00:00.000Z", now);
    expect(r.days).toBe(1);
  });
});

describe("formatRemaining", () => {
  it("drops precision as the deadline gets further away", () => {
    // Seconds three weeks out are noise that repaints every tick.
    expect(formatRemaining(remainingUntil(inMs(21 * DAY), now))).toBe("3 weeks left");
    expect(formatRemaining(remainingUntil(inMs(9 * DAY), now))).toBe("1w 2d left");
    expect(formatRemaining(remainingUntil(inMs(2 * DAY + 3 * HOUR), now))).toBe("2d 3h left");
    expect(formatRemaining(remainingUntil(inMs(5 * HOUR + 2 * MINUTE), now))).toBe(
      "5h 2m left",
    );
    expect(formatRemaining(remainingUntil(inMs(3 * MINUTE + 9 * SECOND), now))).toBe(
      "3m 9s left",
    );
    expect(formatRemaining(remainingUntil(inMs(42 * SECOND), now))).toBe("42s left");
  });

  it("says one week, not 1 weeks", () => {
    expect(formatRemaining(remainingUntil(inMs(7 * DAY), now))).toBe("1 week left");
  });

  it("says Closed rather than a negative number", () => {
    expect(formatRemaining(remainingUntil(inMs(-5 * DAY), now))).toBe("Closed");
  });
});

describe("formatParts", () => {
  it("pads so the digits do not jump as they change", () => {
    const parts = formatParts(
      remainingUntil(inMs(DAY + 2 * HOUR + 3 * MINUTE + 4 * SECOND), now),
    );
    expect(parts.map((p) => p.value)).toEqual(["1", "02", "03", "04"]);
  });

  it("singularises the day label", () => {
    expect(formatParts(remainingUntil(inMs(DAY), now))[0]?.label).toBe("day");
    expect(formatParts(remainingUntil(inMs(2 * DAY), now))[0]?.label).toBe("days");
  });
});

describe("tickInterval", () => {
  it("repaints once a minute when the deadline is far off", () => {
    // 86,400 renders a day saved on a tab somebody left open.
    expect(tickInterval(remainingUntil(inMs(30 * DAY), now))).toBe(60_000);
  });

  it("repaints every second inside the last day", () => {
    expect(tickInterval(remainingUntil(inMs(6 * HOUR), now))).toBe(1000);
  });

  it("stops entirely once it has passed", () => {
    expect(tickInterval(remainingUntil(inMs(-1), now))).toBe(0);
  });
});

describe("endOfDayIst", () => {
  it("puts a closing date at the end of that day, not the start", () => {
    // 23:59:59.999 IST is 18:29:59.999 UTC. Getting this wrong shows the
    // deadline as passed for the entire last day people can still apply.
    expect(endOfDayIst("2026-09-15")).toBe("2026-09-15T18:29:59.999Z");
  });

  it("leaves the whole final day open", () => {
    const deadline = endOfDayIst("2026-09-15");
    // Midday IST on the closing day — 06:30 UTC — is still open.
    const middayIst = new Date("2026-09-15T06:30:00.000Z");
    expect(remainingUntil(deadline, middayIst).passed).toBe(false);
    // And one second after the deadline is not.
    expect(remainingUntil(deadline, new Date("2026-09-15T18:30:01.000Z")).passed).toBe(true);
  });

  it("crosses a month boundary correctly", () => {
    expect(endOfDayIst("2026-01-31")).toBe("2026-01-31T18:29:59.999Z");
    expect(endOfDayIst("2026-12-31")).toBe("2026-12-31T18:29:59.999Z");
  });
});

describe("absolute", () => {
  it("resolves the day in Indian time, not the reader's", () => {
    // The point of the function, and the only thing worth asserting exactly.
    // 18:29:59.999Z on the 15th is 23:59 IST the same day; two minutes later
    // it is already the 16th in India. A formatter using the viewer's own zone
    // would show two readers two different closing dates for one deadline.
    //
    // The day and year are asserted, the month's spelling is not: `en-IN`
    // renders September as "Sept" on this ICU build and "Sep" on others, and a
    // test pinned to either is a test that fails when Node is upgraded.
    expect(absolute("2026-09-15T18:29:59.999Z")).toMatch(/^15 \S+ 2026$/);
    expect(absolute("2026-09-15T18:31:00.000Z")).toMatch(/^16 \S+ 2026$/);
  });

  it("renders the closing day of a deadline as that day", () => {
    // The pairing that matters: whatever `endOfDayIst` produces must read back
    // as the date somebody typed into the notification.
    expect(absolute(endOfDayIst("2026-01-31"))).toMatch(/^31 \S+ 2026$/);
    expect(absolute(endOfDayIst("2026-12-31"))).toMatch(/^31 \S+ 2026$/);
  });
});
