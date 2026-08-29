import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in" } }));

let originForHost: (host: string | null) => string;

beforeAll(async () => {
  ({ originForHost } = await import("./callback-origin"));
});

describe("originForHost", () => {
  it("follows whatever port the dev server actually answered on", () => {
    // The bug this exists to prevent: the app on :3200 telling Google to send
    // the browser back to :3100, where nothing is listening.
    expect(originForHost("localhost:3200")).toBe("http://localhost:3200");
    expect(originForHost("localhost:3100")).toBe("http://localhost:3100");
    expect(originForHost("127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
    expect(originForHost("[::1]:3100")).toBe("http://[::1]:3100");
  });

  it("ignores the header everywhere else", () => {
    // `Host` is caller-controlled. Off loopback it decides nothing, so a forged
    // one cannot aim a real sign-in link at another origin.
    expect(originForHost("jobstrackr.in")).toBe("https://jobstrackr.in");
    expect(originForHost("evil.example.com")).toBe("https://jobstrackr.in");
    expect(originForHost("localhost.evil.example.com")).toBe("https://jobstrackr.in");
    expect(originForHost("notlocalhost")).toBe("https://jobstrackr.in");
    expect(originForHost(null)).toBe("https://jobstrackr.in");
  });

  it("reads a loopback host whatever its casing or port", () => {
    expect(originForHost("LOCALHOST:3100")).toBe("http://LOCALHOST:3100");
    expect(originForHost("localhost")).toBe("http://localhost");
  });
});
