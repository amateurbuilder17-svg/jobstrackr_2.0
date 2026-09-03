import { describe, expect, it } from "vitest";

import { SECTORS } from "@/lib/vocab";
import { sectorLabel, sectorTagsOf, type SectorSubject } from "./sectors";

const tags = (title: string, organization?: string, shortName?: string) =>
  sectorTagsOf({ title, organization, shortName } satisfies SectorSubject);

describe("sectorTagsOf", () => {
  it("only ever emits values from the SECTORS vocabulary", () => {
    const allowed = new Set<string>(SECTORS.map((s) => s.value));
    const subjects: SectorSubject[] = [
      {
        title: "BPSC Civil Judge Recruitment 2026",
        organization: "Bihar Public Service Commission",
      },
      { title: "RRB NTPC Undergraduate 2025", organization: "Railway Recruitment Board" },
      { title: "SSC CGL 2025", organization: "Staff Selection Commission" },
      {
        title: "AIIMS Delhi Senior Resident",
        organization: "All India Institute of Medical Sciences",
      },
    ];
    for (const subject of subjects) {
      for (const tag of sectorTagsOf(subject)) expect(allowed.has(tag)).toBe(true);
    }
  });

  /* ── The bugs this module was written to fix ───────────────────────────
     Each case is a row that carried the wrong tag in production, and the
     substring that put it there. */

  describe("the substring matches that produced the old tags", () => {
    it("does not read 'lic' out of public, police or application", () => {
      expect(
        tags("BPSC Stenographer Vacancy 2026", "Bihar Public Service Commission"),
      ).not.toContain("banking");
      expect(
        tags("Rajasthan Police Constable Recruitment 2025", "Rajasthan Police"),
      ).not.toContain("banking");
      expect(
        tags("UP Anganwadi Recruitment 2025", "Department of Child Development"),
      ).not.toContain("banking");
    });

    it("does not read 'nda' out of secondary, standard or mandatory", () => {
      expect(
        tags("Guest Faculty, Higher Secondary School", "Govt Women's Higher Secondary School"),
      ).not.toContain("defence");
    });

    it("does not read 'psc' out of upsc", () => {
      expect(tags("UPSC CDS (I) Exam 2026", "Union Public Service Commission")).not.toContain(
        "state-govt",
      );
    });

    it("does not read 'bel' out of below", () => {
      expect(tags("Junior Assistant, pay below Level 4", "Panjab University")).not.toContain(
        "psu",
      );
    });

    it("does not read 'bed' out of described", () => {
      expect(tags("Consultant as described in the notification", "NITI Aayog")).not.toContain(
        "teaching",
      );
    });
  });

  describe("acronyms that mean two different things", () => {
    it("reads RRB as Regional Rural Bank next to a banking word", () => {
      const t = tags("IBPS RRB PO 2025", "Institute of Banking Personnel Selection");
      expect(t).toContain("banking");
      expect(t).not.toContain("railway");
    });

    it("reads a bare RRB as the Railway Recruitment Board", () => {
      const t = tags("RRB NTPC (Undergraduate) 2025", "Railway Recruitment Board");
      expect(t).toContain("railway");
      expect(t).not.toContain("banking");
    });

    it("reads NTPC as Non-Technical Popular Categories inside a railway exam", () => {
      expect(tags("RRB NTPC Graduate Posts", "Railway Recruitment Board")).not.toContain("psu");
    });

    it("still reads NTPC as the power PSU on its own", () => {
      expect(tags("NTPC Executive Recruitment 2026", "NTPC Limited")).toContain("psu");
    });

    it("reads SSC as Short Service Commission in an army posting", () => {
      const t = tags("Indian Army SSC Technical 67th Men Course", "Indian Army");
      expect(t).toContain("defence");
      expect(t).not.toContain("central-govt");
    });

    it("reads SSC as the Staff Selection Commission otherwise", () => {
      expect(tags("SSC CGL 2025", "Staff Selection Commission")).toContain("central-govt");
    });

    it("does not read an infosec post as a security post", () => {
      expect(
        tags("IHMCL Chief Information Security Officer", "Indian Highways Management Company"),
      ).not.toContain("police");
    });

    it("still reads a real security post as one", () => {
      expect(tags("Security Guard Recruitment 2026", "One Stop Centre Mayabunder")).toContain(
        "police",
      );
    });
  });

  describe("central versus state", () => {
    it("files a state commission under state government", () => {
      expect(
        tags("WBPSC Clerkship Recruitment 2026", "West Bengal Public Service Commission"),
      ).toContain("state-govt");
      expect(
        tags("BPSC Sugar Cane Officer Recruitment 2026", "Bihar Public Service Commission"),
      ).toContain("state-govt");
    });

    it("files the Union commission under central government", () => {
      const t = tags("UPSC Civil Services Exam 2026", "Union Public Service Commission");
      expect(t).toContain("central-govt");
      expect(t).not.toContain("state-govt");
    });

    /* A state name is where the employer sits, not who the employer is. */
    it("does not file a central institute under its host state", () => {
      expect(
        tags("IIT Delhi Junior Assistant Recruitment", "Indian Institute of Technology Delhi"),
      ).not.toContain("state-govt");
      expect(
        tags(
          "AIIMS Jodhpur Research Officer",
          "All India Institute of Medical Sciences Jodhpur",
        ),
      ).not.toContain("state-govt");
    });

    /* Regression: "Assam Rifles" is a central force, and the employer string
       "Staff Selection Commission" put a state name and the word "commission"
       in the same text. Adjacency is what separates them. */
    it("does not file Assam Rifles under Assam", () => {
      expect(
        tags(
          "SSC GD Constable 2026 (General Duty Constable in CAPFs, SSF, and Rifleman (GD) in Assam Rifles)",
          "Staff Selection Commission",
        ),
      ).not.toContain("state-govt");
    });

    it("files a state name next to a governmental word under state government", () => {
      expect(
        tags("Maharashtra Police Legal Director Recruitment 2026", "Maharashtra Police"),
      ).toContain("state-govt");
      expect(
        tags(
          "WCD Odisha Anganwadi Helper Recruitment 2026",
          "Women and Child Development Department Odisha",
        ),
      ).toContain("state-govt");
    });
  });

  describe("the sector of the post and of the employer", () => {
    it("tags a judicial post as judiciary", () => {
      expect(
        tags("BPSC Civil Judge Recruitment 2026", "Bihar Public Service Commission"),
      ).toContain("judiciary");
    });

    it("tags an education-sector employer as teaching", () => {
      expect(
        tags("IIT Guwahati Technical Assistant", "Indian Institute of Technology Guwahati"),
      ).toContain("teaching");
    });

    it("carries every sector a posting genuinely belongs to", () => {
      expect(tags("RRB Junior Engineer (JE) 2025", "Railway Recruitment Board")).toEqual(
        expect.arrayContaining(["railway", "engineering"]),
      );
      expect(
        tags("RBI Bank Medical Consultant Recruitment 2026", "Reserve Bank of India"),
      ).toEqual(expect.arrayContaining(["banking", "medical"]));
    });

    it("returns nothing rather than guessing", () => {
      expect(tags("Recruitment 2026 - Apply Online", "Repco Home Finance Limited")).toEqual([]);
    });
  });

  it("returns tags in SECTORS order, so a re-run hashes identically", () => {
    const order = SECTORS.map((s) => s.value);
    const result = tags("SSC GD Constable 2026", "Staff Selection Commission");
    const positions = result.map((t) => order.indexOf(t));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("sectorLabel", () => {
  it("gives the chip label for a known tag", () => {
    expect(sectorLabel("railway")).toBe("Railways");
    expect(sectorLabel("state-govt")).toBe("State government");
  });

  it("passes an unknown tag through, so a legacy row still renders", () => {
    expect(sectorLabel("12th_pass")).toBe("12th_pass");
  });
});
