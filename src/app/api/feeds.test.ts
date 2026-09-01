import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET as getJobs } from "@/app/api/jobs/route";
import { GET as getUpdates } from "@/app/api/updates/route";

vi.mock("@/lib/db/queries/jobs", () => ({
  listJobs: vi.fn().mockResolvedValue({
    items: [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        slug: "ssc-cgl-2026",
        title: "SSC CGL 2026",
      },
    ],
    nextCursor: "eyJhbGciOi...",
  }),
  toJobSort: (v: string | undefined) => (v === "newest" ? "newest" : "closing"),
}));

vi.mock("@/lib/db/queries/exam-updates", () => ({
  listExamUpdates: vi.fn().mockResolvedValue({
    items: [
      {
        id: "123e4567-e89b-12d3-a456-426614174001",
        slug: "ssc-cgl-admit-card",
        title: "SSC CGL Admit Card",
        category: "admit_card",
      },
    ],
    nextCursor: "eyJhbGciOi...",
  }),
  toUpdateSort: (v: string | undefined) => (v === "oldest" ? "oldest" : "newest"),
}));

describe("API feeds for infinite scrolling", () => {
  it("serves /api/jobs with edge CDN cache headers and parsed pagination", async () => {
    const req = new NextRequest(
      "https://jobstrackr.in/api/jobs?level=bachelor&sort=newest&after=cursor123",
    );
    const res = await getJobs(req);
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("Cache-Control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=300");

    const data = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(data.items).toHaveLength(1);
    expect(data.nextCursor).toBe("eyJhbGciOi...");
  });

  it("serves /api/updates with edge CDN cache headers and parsed category", async () => {
    const req = new NextRequest(
      "https://jobstrackr.in/api/updates?category=admit_card&sort=oldest",
    );
    const res = await getUpdates(req);
    expect(res.status).toBe(200);

    const cacheHeader = res.headers.get("Cache-Control");
    expect(cacheHeader).toContain("public");
    expect(cacheHeader).toContain("s-maxage=300");

    const data = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(data.items).toHaveLength(1);
    expect(data.nextCursor).toBe("eyJhbGciOi...");
  });
});
