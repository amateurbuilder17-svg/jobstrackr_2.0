/**
 * Full option vocabularies for profile preferences.
 *
 * Deliberately not shared with the filter chips on /jobs. Those are a curated
 * shortlist of the six filters people actually use, tuned for scanning; these
 * are the complete sets, because a preference the user cannot express is a
 * match they will never be offered. Same subject, different jobs — merging them
 * would make both worse.
 */

/** All 28 states and 8 union territories, alphabetical. */
export const INDIAN_STATES = [
  "All India",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/**
 * Sectors, keyed by the slug stored in `profiles.preferred_sectors` and matched
 * against `jobs.tags` in M8. The value is the contract; the label is free to
 * change without a migration.
 */
export const SECTORS = [
  { value: "banking", label: "Banking & insurance" },
  { value: "railway", label: "Railways" },
  { value: "defence", label: "Defence & paramilitary" },
  { value: "teaching", label: "Teaching & education" },
  { value: "engineering", label: "Engineering & technical" },
  { value: "medical", label: "Medical & health" },
  { value: "police", label: "Police & security" },
  { value: "clerical", label: "Clerical & administrative" },
  { value: "central-govt", label: "Central government" },
  { value: "state-govt", label: "State government" },
  { value: "psu", label: "Public sector undertakings" },
  { value: "judiciary", label: "Judiciary & legal" },
] as const;
