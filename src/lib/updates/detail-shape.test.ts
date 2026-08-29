import { describe, expect, it } from "vitest";

import {
  datesFromOverview,
  datesFromSections,
  linkLabel,
  relationTerm,
  partitionUpdateDates,
  primaryLinks,
  splitDateNote,
  toRelatedArticles,
  toUpdateLinks,
  toUpdateOverview,
  toUpdateSections,
} from "./detail-shape";

/**
 * Fixtures are lifted verbatim from production rows, entity codes and adverts
 * included — the point of these tests is the shapes the scrapers actually send,
 * not the shapes they were supposed to.
 */

describe("toUpdateSections", () => {
  it("reads the stored `content` array, which the page used to miss entirely", () => {
    // 998 of 1,000 sampled rows are shaped like this. A reader looking for
    // `section.body` finds undefined and renders a bare heading.
    const stored = [
      {
        type: "list",
        level: "h2",
        heading: "Mizoram PSC LDE Admit Card 2026 - Quick Overview",
        content: [
          "Issuing Authority: Mizoram Public Service Commission",
          "Notification No.: A.12033/1/2026&ndash;MPSC(EA)",
        ],
      },
    ];

    expect(toUpdateSections(stored)).toEqual([
      {
        heading: "Mizoram PSC LDE Admit Card 2026 - Quick Overview",
        lines: [
          "Issuing Authority: Mizoram Public Service Commission",
          // Entities decoded: React escapes its output, so `&ndash;` stored
          // raw prints those seven characters mid-sentence.
          "Notification No.: A.12033/1/2026–MPSC(EA)",
        ],
      },
    ]);
  });

  it("reads the `body` string shape too, splitting it back into lines", () => {
    const sections = toUpdateSections([{ heading: "Documents", body: "Photo ID\nAdmit card" }]);
    expect(sections).toEqual([{ heading: "Documents", lines: ["Photo ID", "Admit card"] }]);
  });

  it("drops the source site's adverts", () => {
    const sections = toUpdateSections([
      {
        heading: "Important Dates",
        content: [
          "The hall ticket window differs for each post.",
          "⚡ Get Custom Govt Job Alerts by Your Qualification (10TH | 12TH | Diploma)",
          "Join WhatsApp Channel - Click Here",
        ],
      },
    ]);
    expect(sections).toEqual([
      { heading: "Important Dates", lines: ["The hall ticket window differs for each post."] },
    ]);
  });

  it("drops a section that has nothing left to say", () => {
    // 600 of 1,000 rows carry one of these — the heading is real, the content
    // lives in the overview table instead. Rendered, it is an empty panel.
    expect(toUpdateSections([{ heading: "Quick Overview", content: [] }])).toEqual([]);
    expect(
      toUpdateSections([{ heading: "Links", content: ["Join our Telegram channel"] }]),
    ).toEqual([]);
  });

  it("survives the shapes a scraper failure produces", () => {
    expect(toUpdateSections(null)).toEqual([]);
    expect(toUpdateSections("not json")).toEqual([]);
    expect(toUpdateSections({ heading: "x" })).toEqual([]);
    expect(toUpdateSections([null, "text", 7])).toEqual([]);
  });

  it("parses a JSON string, which backfilled rows sometimes hold", () => {
    const json = JSON.stringify([{ heading: "A", content: ["one"] }]);
    expect(toUpdateSections(json)).toEqual([{ heading: "A", lines: ["one"] }]);
  });
});

describe("partitionUpdateDates", () => {
  it("drops the table's own header row", () => {
    // Straight out of production: the header of an MPSC notification table.
    const { dates } = partitionUpdateDates([
      { event: "Sl. No.", date: "Related Notification No. & Date", status: "", link: "" },
      { event: "Admit card download", date: "20th – 28th August 2026", status: "", link: "" },
    ]);
    expect(dates).toEqual([
      {
        event: "Admit card download",
        date: "20th – 28th August 2026",
        note: "",
        status: "",
        link: "",
      },
    ]);
  });

  it("keeps a row whose label looks like a header when it carries a real date", () => {
    // The safety net: filtering must never be able to remove a date.
    const { dates } = partitionUpdateDates([{ event: "Last Date", date: "09/08/2026" }]);
    expect(dates).toEqual([
      { event: "Last Date", date: "09/08/2026", note: "", status: "", link: "" },
    ]);
  });

  it("drops a header pair only when both cells are headers", () => {
    const { dates } = partitionUpdateDates([{ event: "Event", date: "Date & Time" }]);
    expect(dates).toEqual([]);
  });

  it("rescues a link row instead of losing its URL", () => {
    const { dates, links } = partitionUpdateDates([
      {
        event: "Official Notification PDF",
        date: "Click here",
        link: "https://ssc.gov.in/notice.pdf",
      },
    ]);
    expect(dates).toEqual([]);
    expect(links).toEqual([
      { label: "Official Notification PDF", url: "https://ssc.gov.in/notice.pdf" },
    ]);
  });

  it("rescues a website row from its bare domain", () => {
    const { dates, links } = partitionUpdateDates([
      { event: "Official Website", date: "hckrecruitment.keralacourts.in" },
    ]);
    expect(dates).toEqual([]);
    // Prefixed with a scheme: a browser reads a bare domain as a relative path.
    expect(links).toEqual([
      { label: "Official Website", url: "https://hckrecruitment.keralacourts.in/" },
    ]);
  });

  it("never rescues a link into the blocklist", () => {
    const { links } = partitionUpdateDates([
      { event: "Join Channel", date: "Click here", link: "https://chat.whatsapp.com/abc" },
      { event: "Notification", date: "Click here", link: "https://t.me/somechannel" },
    ]);
    expect(links).toEqual([]);
  });

  it("drops the aggregator's own promo rows", () => {
    const { dates, links } = partitionUpdateDates([
      {
        event: "Join our Telegram Channel",
        date: "Click here",
        link: "https://example.com/go",
      },
      { event: "Sarkari Result", date: "01/09/2026" },
    ]);
    expect(dates).toEqual([]);
    expect(links).toEqual([]);
  });

  it("splits a sentence-length date into a date and a note", () => {
    const { dates } = partitionUpdateDates([
      {
        event: "Exam date",
        date: "15 September 2026 (tentative, subject to change as per commission notice)",
      },
    ]);
    expect(dates[0]).toMatchObject({
      date: "15 September 2026",
      note: "tentative, subject to change as per commission notice",
    });
  });

  it("de-duplicates rows two scrapers both sent", () => {
    const { dates } = partitionUpdateDates([
      { event: "Exam date", date: "01/09/2026" },
      { event: "exam date", date: "01/09/2026" },
    ]);
    expect(dates).toHaveLength(1);
  });

  it("preserves source order, which is chronological", () => {
    const { dates } = partitionUpdateDates([
      { event: "Application starts", date: "20/08/2026" },
      { event: "Application ends", date: "10/09/2026" },
      { event: "Exam date", date: "28/09/2026" },
    ]);
    expect(dates.map((d) => d.event)).toEqual([
      "Application starts",
      "Application ends",
      "Exam date",
    ]);
  });
});

describe("splitDateNote", () => {
  it("leaves a genuine multi-date value whole", () => {
    const value = "13th, 16th, 17th, 18th February 2026";
    expect(splitDateNote(value)).toEqual({ date: value, note: "" });
  });

  it("keeps long prose rather than truncating it when there is no break", () => {
    const value = "a".repeat(80);
    expect(splitDateNote(value)).toEqual({ date: value, note: "" });
  });
});

describe("toUpdateOverview", () => {
  it("reads the stored `{field, value}` shape and drops its header row", () => {
    // 956 of 1,000 rows use `field`/`value`; `jobs/detail-shape.ts` looks for
    // `label`/`key`/`name` and returns nothing for all of them.
    const rows = toUpdateOverview([
      { field: "Detail", value: "Information" },
      { field: "Exam Name", value: "Tier-2 Examination under Advt No. 01/2025" },
      { field: "Total Vacancies", value: "15,762 Posts" },
    ]);
    expect(rows).toEqual([
      { field: "Exam Name", value: "Tier-2 Examination under Advt No. 01/2025" },
      { field: "Total Vacancies", value: "15,762 Posts" },
    ]);
  });

  it("drops promos and blank cells", () => {
    expect(
      toUpdateOverview([
        { field: "Telegram Channel", value: "Join here" },
        { field: "Exam Mode", value: "" },
        { field: "", value: "CBT" },
      ]),
    ).toEqual([]);
  });
});

describe("toUpdateLinks", () => {
  it("strips the aggregator, WhatsApp and Telegram links stored in production", () => {
    const links = toUpdateLinks([
      {
        url: "https://www.whatsapp.com/channel/0029VaA1ECQ1noz2PrjLsF3v",
        text: "Join WhatsApp Channel - Click Here",
      },
      {
        url: "https://www.freejobalert.com/some-article",
        text: "Read more",
      },
      {
        url: "https://sbi.bank.in/documents/notification.pdf",
        text: "Download SBI Apprentice Recruitment 2026 Official Notification PDF",
      },
    ]);
    expect(links).toEqual([
      {
        label: "Download SBI Apprentice Recruitment 2026 Official Notification PDF",
        url: "https://sbi.bank.in/documents/notification.pdf",
      },
    ]);
  });

  it("names a link the source called 'Click here'", () => {
    expect(
      toUpdateLinks([{ url: "https://ssc.gov.in/admit-card/login", text: "Click Here" }]),
    ).toEqual([{ label: "Admit card", url: "https://ssc.gov.in/admit-card/login" }]);
  });

  it("keeps a real label, minus the trailing 'Click here'", () => {
    expect(
      toUpdateLinks([
        { url: "https://ibpsonline.ibps.in/x/", text: "Apply Online - Click Here" },
      ]),
    ).toEqual([{ label: "Apply Online", url: "https://ibpsonline.ibps.in/x/" }]);
  });

  it("merges the rescued date-table links after the download list, without duplicates", () => {
    const links = toUpdateLinks(
      [{ url: "https://ssc.gov.in/a.pdf", text: "Notification" }],
      [
        { label: "Official Notification PDF", url: "https://ssc.gov.in/a.pdf" },
        { label: "Result", url: "https://ssc.gov.in/result" },
      ],
    );
    expect(links).toEqual([
      { label: "Notification", url: "https://ssc.gov.in/a.pdf" },
      { label: "Result", url: "https://ssc.gov.in/result" },
    ]);
  });

  it("calls a URL with no path what it is, rather than naming its host", () => {
    // This used to render as "mpsc.mizoram.gov.in". A third of the 12,514
    // stored links reached that fallback, so a links list read as a column of
    // domains — which names the site rather than the document behind it.
    expect(toUpdateLinks([{ url: "https://www.mpsc.mizoram.gov.in/", text: "here" }])).toEqual([
      { label: "Official website", url: "https://www.mpsc.mizoram.gov.in/" },
    ]);
  });

  it("names the document when a file host has no keyword in its path", () => {
    // Google Drive is where a third of the notification PDFs are stored, and
    // its share URLs carry a file id and nothing else to read a label from.
    expect(
      toUpdateLinks(
        [{ url: "https://drive.google.com/file/d/1GkA/view", text: "" }],
        [],
        "result",
      ),
    ).toEqual([{ label: "Result PDF", url: "https://drive.google.com/file/d/1GkA/view" }]);
  });

  it("still falls back to the host for a deep link it cannot read", () => {
    expect(
      toUpdateLinks([{ url: "https://www.mpsc.mizoram.gov.in/x/y", text: "here" }]),
    ).toEqual([{ label: "mpsc.mizoram.gov.in", url: "https://www.mpsc.mizoram.gov.in/x/y" }]);
  });

  it("prefers the label that names the destination, whichever list it came from", () => {
    // `download_links` is read first and labels this URL "Click here"; the date
    // table calls the same URL "Application Form". Keeping the first-seen label
    // meant the useless one always won and the good one was dropped as a
    // duplicate — the VNIT page rendered it as "drive.google.com".
    const links = toUpdateLinks(
      [{ url: "https://drive.google.com/file/d/1tq5/view", text: "Click here" }],
      [{ label: "Application Form", url: "https://drive.google.com/file/d/1tq5/view" }],
    );
    expect(links).toEqual([
      { label: "Application Form", url: "https://drive.google.com/file/d/1tq5/view" },
    ]);
  });
});

describe("datesFromOverview", () => {
  /**
   * The bug this exists for: `important_dates` survives cleaning empty on
   * 1,515 of the 5,374 stored rows, so those pages showed no schedule at all.
   * 947 of them carry the dates in the overview table instead.
   */
  it("moves a dated overview row into the schedule, and out of the facts table", () => {
    const { dates, rest } = datesFromOverview([
      { field: "Post Name", value: "Project Assistant (PA)" },
      { field: "Walk-in Date", value: "02 September 2026" },
      { field: "Job Type", value: "Contractual" },
    ]);

    expect(dates).toEqual([
      { event: "Walk-in Date", date: "02 September 2026", note: "", status: "", link: "" },
    ]);
    // Moved, not copied — the page must not state the same date twice.
    expect(rest.map((row) => row.field)).toEqual(["Post Name", "Job Type"]);
  });

  it("leaves a date-named row alone when its value is not a date", () => {
    const { dates, rest } = datesFromOverview([
      { field: "Exam Date", value: "As per schedule" },
    ]);
    expect(dates).toEqual([]);
    expect(rest).toHaveLength(1);
  });

  it("drops a date the table above already shows, whatever it calls it", () => {
    // Sources word the same day two ways across the two tables. De-duplicating
    // on the label would keep both and read as two separate events.
    const existing = [
      {
        event: "Date of Examination",
        date: "10 December 2025",
        note: "",
        status: "",
        link: "",
      },
    ];
    const { dates, rest } = datesFromOverview(
      [{ field: "Exam Date", value: "10 December 2025" }],
      existing,
    );
    expect(dates).toEqual([]);
    expect(rest).toEqual([]);
  });

  it("splits a qualifier off a long value, as the date table does", () => {
    const { dates } = datesFromOverview([
      {
        field: "Online Application Last Date",
        value: "2 July 2026 (up to 5:00 PM, no applications after this)",
      },
    ]);
    expect(dates[0]).toMatchObject({
      date: "2 July 2026",
      note: "up to 5:00 PM, no applications after this",
    });
  });
});

describe("datesFromSections", () => {
  it("reads a dates table that was scraped as prose, and stops repeating it", () => {
    const { dates, rest } = datesFromSections([
      {
        heading: "Bank of India Recruitment 2025 Important Dates",
        lines: [
          "Starting Date for register Online: 08-03-2025",
          // The rewriter's lead-in, which is most of the label's width in a
          // two-column table — see `stripFiller`.
          "As per the official update, Closing date for submit Online: 23-03-2025",
        ],
      },
    ]);

    expect(dates).toEqual([
      {
        event: "Starting Date for register Online",
        date: "08-03-2025",
        note: "",
        status: "",
        link: "",
      },
      {
        event: "Closing date for submit Online",
        date: "23-03-2025",
        note: "",
        status: "",
        link: "",
      },
    ]);
    // Every line became a row, so the panel has nothing left to say.
    expect(rest).toEqual([]);
  });

  it("keeps the lines it could not read as dates", () => {
    const { dates, rest } = datesFromSections([
      {
        heading: "Important Dates",
        lines: ["Exam Date: 10 May 2026", "Dates may be revised by the commission."],
      },
    ]);
    expect(dates).toHaveLength(1);
    expect(rest).toEqual([
      { heading: "Important Dates", lines: ["Dates may be revised by the commission."] },
    ]);
  });

  it("does not mine an ordinary section for dates", () => {
    // Only a section that announces itself as a schedule is parsed. Every other
    // heading is prose, and prose with a colon in it is not a table row.
    const sections = [
      {
        heading: "Eligibility Criteria",
        lines: ["Age Limit: 21 to 40 years as on 01.01.2026"],
      },
    ];
    const { dates, rest } = datesFromSections(sections);
    expect(dates).toEqual([]);
    expect(rest).toEqual(sections);
  });
});

describe("linkLabel", () => {
  it("uses the category when the URL says nothing", () => {
    expect(linkLabel("Click here", "https://example.gov.in/x", "admit_card")).toBe(
      "Admit card link",
    );
  });
});

describe("primaryLinks", () => {
  it("leads with the document and pairs it with the official site", () => {
    const { action, official } = primaryLinks([
      { label: "Official Website", url: "https://kvsangathan.nic.in" },
      { label: "Download Admit Card Now", url: "https://cdn3.digialm.com/login.html" },
    ]);
    expect(action?.label).toBe("Download Admit Card Now");
    expect(official?.label).toBe("Official Website");
  });

  it("returns nulls rather than throwing when there are no links", () => {
    expect(primaryLinks([])).toEqual({ action: null, official: null });
  });
});

describe("toRelatedArticles", () => {
  it("keeps titled links and drops the rest", () => {
    expect(
      toRelatedArticles([
        { title: "SSC CGL 2026 notification", url: "https://ssc.gov.in/cgl" },
        { title: "Join our WhatsApp group", url: "https://example.com/x" },
        { title: "", url: "https://ssc.gov.in/other" },
      ]),
    ).toEqual([{ label: "SSC CGL 2026 notification", url: "https://ssc.gov.in/cgl" }]);
  });
});

describe("relationTerm", () => {
  it("takes the leading acronym, which is the exam family", () => {
    // Real titles from production.
    expect(relationTerm("UPSSSC Forensic Science Laboratory Result 2026 Out")).toBe("UPSSSC");
    expect(relationTerm("RRB Group D PET Entry pass 2026 - verify Zone-Wise")).toBe("RRB");
    expect(relationTerm("RBI Non CSG Various Post Score Card 2026")).toBe("RBI");
  });

  it("keeps both acronyms when two bodies run one exam", () => {
    expect(relationTerm("KVS NVS Tier 2 Entry pass 2026 OUT - collect Hall Ticket")).toBe(
      "KVS NVS",
    );
  });

  it("falls back to two ordinary words when there is no acronym", () => {
    expect(relationTerm("Kashmir University Assistant Professor Recruitment 2026")).toBe(
      "Kashmir University",
    );
    expect(relationTerm("Bharathidasan University Recruitment 2026")).toBe(
      "Bharathidasan University",
    );
  });

  it("refuses a term that would relate an update to the whole table", () => {
    // Leading with the event, not the body: relating on "Result" would match
    // every result in the table.
    expect(relationTerm("Result 2026 declared")).toBeNull();
    expect(relationTerm("Admit Card")).toBeNull();
    expect(relationTerm("")).toBeNull();
  });

  it("does not run past the acronym into the rest of the title", () => {
    expect(relationTerm("MPSC Merit List 2026 - Associate Professor")).toBe("MPSC");
  });
});
