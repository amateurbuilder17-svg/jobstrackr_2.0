import { describe, expect, it } from "vitest";

import { isPromotionalText, isUsableUrl, toUrl } from "./links";

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
