import type { JobDetail } from "@/lib/db/queries/jobs";

/**
 * schema.org JobPosting for a listing.
 *
 * This is what puts a job into Google Jobs, which for this audience is a
 * meaningful share of discovery. Google validates the shape strictly and drops
 * the whole record on a bad field, so several decisions here are about being
 * honest rather than complete:
 *
 *   - `validThrough` is omitted when the closing date is unknown, rather than
 *     invented. A wrong date gets the posting pulled on the day it is wrong.
 *   - `baseSalary` is omitted unless a real figure exists. Government pay is
 *     often quoted as a pay-matrix level, and the old scraper repeatedly read a
 *     level ("Level 7") as a salary — publishing that as ₹7 would be worse than
 *     saying nothing at all.
 *   - `hiringOrganization` is omitted rather than filled with a placeholder.
 */
export function jobPostingJsonLd(job: JobDetail, siteUrl: string): Record<string, unknown> {
  const url = `${siteUrl}/jobs/${job.slug}`;
  const description =
    job.detail?.description ??
    job.detail?.eligibility_text ??
    job.qualification_summary ??
    job.title;

  // Built in one expression with conditional spreads rather than by mutating an
  // object. An absent key and a key set to undefined are different things to
  // Google's validator, and spreading `{}` guarantees the key is simply not
  // there.
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description,
    url,
    identifier: { "@type": "PropertyValue", name: "JobsTrackr", value: job.slug },
    datePosted: job.published_at ?? job.created_at,
    employmentType: "FULL_TIME",
    industry: "Government",

    // End of day IST — the deadline is a calendar date in India, not an instant.
    ...(job.last_date ? { validThrough: `${job.last_date}T23:59:59+05:30` } : {}),

    ...(job.organization
      ? {
          hiringOrganization: {
            "@type": "Organization",
            name: job.organization.name,
            ...(job.organization.website ? { sameAs: job.organization.website } : {}),
          },
        }
      : {}),

    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: "IN",
        ...(job.state && job.state !== "All India" ? { addressRegion: job.state } : {}),
        ...(job.location && job.location !== "All India"
          ? { addressLocality: job.location }
          : {}),
      },
    },

    ...(job.salary_min !== null || job.salary_max !== null
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "INR",
            value: {
              "@type": "QuantitativeValue",
              ...(job.salary_min !== null ? { minValue: job.salary_min } : {}),
              ...(job.salary_max !== null ? { maxValue: job.salary_max } : {}),
              unitText: "MONTH",
            },
          },
        }
      : {}),

    ...(job.vacancies !== null && job.vacancies > 0 ? { totalJobOpenings: job.vacancies } : {}),

    ...(job.qualification_summary
      ? {
          educationRequirements: {
            "@type": "EducationalOccupationalCredential",
            credentialCategory: job.qualification_summary,
          },
        }
      : {}),
  };
}
