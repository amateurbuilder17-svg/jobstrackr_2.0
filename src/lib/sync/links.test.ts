import { describe, expect, it } from "vitest";

import { hasBlockedWord, isPromotionalText, isUsableUrl, toUrl } from "./links";

describe("toUrl", () => {
  it("adds a protocol to a bare domain", () => {
    // Without this the browser reads it as a relative path and navigates to
    // jobstrackr.in/www.ukmssb.org.
    expect(toUrl("www.ukmssb.org")).toBe("https://www.ukmssb.org/");
  });

  it("salvages a URL embedded in prose", () => {
    expect(toUrl("Apply at ssc.gov.in before the last date")).toBe("https://ssc.gov.in/");
  });

  it("rejects text that merely looks like a value", () => {
    expect(toUrl("Online only")).toBeNull();
    expect(toUrl("05.08.2026")).toBeNull();
    expect(toUrl("N/A")).toBeNull();
  });

  it("blocks aggregator and messaging links", () => {
    expect(toUrl("https://www.freejobalert.com/ssc-cgl/")).toBeNull();
    expect(toUrl("https://t.me/somechannel")).toBeNull();
    expect(toUrl("https://chat.whatsapp.com/ABC")).toBeNull();
    expect(toUrl("tg://join?invite=abc")).toBeNull();
  });

  it("blocks a subdomain of a blocked host", () => {
    expect(toUrl("https://jobs.freejobalert.com/x")).toBeNull();
  });

  // The word, not only the host: a redirector, a mirror or a tracking
  // parameter carries the aggregator just as well.
  it("blocks freejobalert anywhere in the address, encoded or not", () => {
    expect(toUrl("https://freejobalert.in/ssc")).toBeNull();
    expect(toUrl("https://example.org/out?url=https://www.freejobalert.com/x")).toBeNull();
    expect(toUrl("https://example.org/out?url=https%3A%2F%2FFreeJobAlert.com%2Fx")).toBeNull();
    expect(toUrl("https://ssc.gov.in/notice?ref=freejobalert")).toBeNull();
  });

  it("does not block a real site that merely mentions one in a parameter", () => {
    // The old check was a substring test against the whole URL, which took out
    // legitimate pages carrying a share parameter.
    expect(toUrl("https://ssc.gov.in/notice?utm_source=t.me")).toBe(
      "https://ssc.gov.in/notice?utm_source=t.me",
    );
  });

  it("refuses script and data schemes", () => {
    expect(toUrl("javascript:alert(1)")).toBeNull();
    expect(toUrl("data:text/html,<script>")).toBeNull();
  });

  it("strips trailing punctuation left by a sentence", () => {
    expect(toUrl("https://ssc.gov.in.")).toBe("https://ssc.gov.in/");
  });
});

describe("hasBlockedWord", () => {
  it("catches the word in a URL or a label, in any case", () => {
    expect(hasBlockedWord("https://www.freejobalert.com/")).toBe(true);
    expect(hasBlockedWord("Visit FreeJobAlert")).toBe(true);
    expect(hasBlockedWord("free%6Aobalert.com")).toBe(true);
  });

  it("passes everything else, and nothing at all", () => {
    expect(hasBlockedWord("https://ssc.gov.in/")).toBe(false);
    expect(hasBlockedWord("Official website")).toBe(false);
    expect(hasBlockedWord(null)).toBe(false);
    expect(hasBlockedWord("%E0%A4%A")).toBe(false);
  });
});

describe("isUsableUrl", () => {
  it("agrees with toUrl", () => {
    expect(isUsableUrl("https://ssc.gov.in")).toBe(true);
    expect(isUsableUrl("Not available")).toBe(false);
  });
});

describe("isPromotionalText", () => {
  it("catches an advert whose href is on the source site's own domain", () => {
    expect(isPromotionalText("Join our WhatsApp group")).toBe(true);
    expect(isPromotionalText("Telegram Channel")).toBe(true);
    expect(isPromotionalText("Download Notification PDF")).toBe(false);
  });
});
