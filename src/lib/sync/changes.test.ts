import { describe, expect, it } from "vitest";

import { diffWatched } from "./changes";

/**
 * The differ decides what people get told about a listing they are counting on.
 * Over-reporting trains them to ignore it; under-reporting is the deadline they
 * miss. Both directions are tested.
 */

const base = {
  last_date: "2026-08-31",
  application_start_date: "2026-08-01",
  vacancies: 10,
  vacancies_display: "10 Posts",
  application_fee: 500,
  status: "published",
};

const key = "abc123";

describe("diffWatched", () => {
  it("reports nothing when nothing watched changed", () => {
    expect(diffWatched(key, base, { ...base })).toEqual([]);
  });

  it("reports an extended closing date, with both values", () => {
    const changes = diffWatched(key, base, { ...base, last_date: "2026-09-15" });
    expect(changes).toEqual([
      { dedupeKey: key, field: "last_date", oldValue: "2026-08-31", newValue: "2026-09-15" },
    ]);
  });

  it("reports a revised vacancy count once, not twice", () => {
    // Both columns move together — they are two spellings of one fact, and a
    // reader must not be told about it twice.
    const changes = diffWatched(key, base, {
      ...base,
      vacancies: 12,
      vacancies_display: "12 Posts",
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "vacancies",
      oldValue: "10 Posts",
      newValue: "12 Posts",
    });
  });

  it("says nothing when only the typed count moves behind an unchanged display string", () => {
    // A parser correction that leaves the printed answer identical is not news.
    expect(diffWatched(key, base, { ...base, vacancies: 11 })).toEqual([]);
  });

  it("reports a listing closing", () => {
    const changes = diffWatched(key, base, { ...base, status: "closed" });
    expect(changes).toEqual([
      { dedupeKey: key, field: "status", oldValue: "published", newValue: "closed" },
    ]);
  });

  it("reports several fields independently", () => {
    const changes = diffWatched(key, base, {
      ...base,
      last_date: "2026-09-15",
      application_fee: 0,
    });
    expect(changes.map((c) => c.field).sort()).toEqual(["application_fee", "last_date"]);
  });

  it("distinguishes a value being set from a value being cleared", () => {
    const set = diffWatched(key, { ...base, application_fee: null }, base);
    expect(set[0]).toMatchObject({ field: "application_fee", oldValue: null, newValue: "500" });

    const cleared = diffWatched(key, base, { ...base, application_fee: null });
    expect(cleared[0]).toMatchObject({
      field: "application_fee",
      oldValue: "500",
      newValue: null,
    });
  });

  it("does not treat a fee of zero as an absent fee", () => {
    // "No fee" and "fee not stated" are different answers, and a candidate
    // budgeting for an application needs them kept apart.
    const changes = diffWatched(key, { ...base, application_fee: 0 }, base);
    expect(changes[0]).toMatchObject({ oldValue: "0", newValue: "500" });
  });
});
