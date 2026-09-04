import { describe, expect, it } from "vitest";

import { officialUrls } from "./syllabus-sources";

/**
 * Which addresses end up under "Official Sources".
 *
 * Worth its own module because the two lists this chooses between are not
 * equally good and not equally trustworthy, and the rule that picks one is the
 * only thing standing between a syllabus page and a column of Google redirect
 * URLs — or worse, a mangled one presented as a conducting body's website.
 *
 * Every string here is shaped like something the live API actually returned
 * while this was being built; the RRB NTPC case in particular is copied from a
 * real answer, typo and all.
 */

const chunk = (url: string) => ({ title: "Source", url });

describe("officialUrls", () => {
  it("prefers the addresses the search pass wrote down", () => {
    // The grounded call visited these, and they are the ones a reader can
    // recognise as the conducting body.
    const notes = "…\n\nSources:\nhttps://ssc.gov.in/\nhttps://ssc.nic.in/notice";
    expect(officialUrls(notes, [chunk("https://example.com/wrapped")])).toEqual([
      "https://ssc.gov.in/",
      "https://ssc.nic.in/notice",
    ]);
  });

  it("falls back to grounding when the notes name no addresses", () => {
    // Common: the model answers the syllabus fully and skips the Sources list.
    // A real redirect beats no attribution at all.
    const grounding = [chunk("https://a.example/1"), chunk("https://b.example/2")];
    expect(officialUrls("The SBI Clerk exam has two stages.", grounding)).toEqual([
      "https://a.example/1",
      "https://b.example/2",
    ]);
  });

  it("rejects a grounding redirect the model echoed into its prose", () => {
    // Straight from a live RRB NTPC answer: Google's wrapper, with the
    // hostname mistyped as "vertexaisaisearch". Matching the host would miss
    // it, which is why the path segment is what gets matched.
    const notes =
      "Sources:\nhttps://vertexaisaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH4toNLiqIgoK4T";
    expect(officialUrls(notes, [chunk("https://real.example/page")])).toEqual([
      "https://real.example/page",
    ]);
  });

  it("rejects a correctly spelled wrapper too", () => {
    const notes =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF7OUESO-dXrnW9";
    expect(officialUrls(notes, [])).toEqual([]);
  });

  it("rejects an address too long to be a syllabus page", () => {
    // The second guard on a wrapper, for a variant that mangles the path as
    // well as the host. No conducting body publishes at 200-plus characters.
    const notes = `https://example.gov.in/${"a".repeat(220)}`;
    expect(officialUrls(notes, [chunk("https://fallback.example/")])).toEqual([
      "https://fallback.example/",
    ]);
  });

  it("does not keep the punctuation that ended the sentence", () => {
    const notes = "See https://ssc.gov.in/notice, and also (https://upsc.gov.in/).";
    expect(officialUrls(notes, [])).toEqual([
      "https://ssc.gov.in/notice",
      "https://upsc.gov.in/",
    ]);
  });

  it("lists an address once however often the notes repeat it", () => {
    const notes = "https://ssc.gov.in/ … https://ssc.gov.in/ … https://ssc.gov.in/";
    expect(officialUrls(notes, [])).toEqual(["https://ssc.gov.in/"]);
  });

  it("stops at six, from either list", () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://e${String(i)}.gov.in/`);
    expect(officialUrls(many.join("\n"), [])).toHaveLength(6);
    expect(officialUrls("no addresses here", many.map(chunk))).toHaveLength(6);
  });

  it("ignores plain http, which the page links to as official", () => {
    // The regex is https-only on purpose: these are rendered as links a reader
    // is told came from the conducting body.
    expect(officialUrls("http://ssc.gov.in/insecure", [])).toEqual([]);
  });
});
