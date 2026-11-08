import { b, bb, bn } from '../dsl';

/**
 * The shared posting body, declared once.
 *
 * Every board takes the same nine facts about a job — they disagree only on field names,
 * which is what the manifest's `path`/`params` mapping is for. Writing them out per
 * vendor is how three boards come to advertise slightly different requisition shapes.
 */
export const POSTING_PARAMS = {
  title: b('Job title as candidates search for it — "Senior React Engineer", not "Engineer III"'),
  description: b('Full posting body. HTML is accepted by every board here; plain text is safest.'),
  location: b('City and country, or "Remote" plus the timezones or countries the role is open to'),
  employment_type: b('permanent | fixed-term | contract | part-time | internship'),
  seniority: b('Seniority as the posting states it — graduate | junior | mid | senior | lead | staff | principal'),
  salary_min: bn('Lower bound of the published band, in major units. Required in jurisdictions with pay-transparency law.'),
  salary_max: bn('Upper bound of the published band, in major units'),
  salary_currency: b('ISO-4217 code for the band, e.g. "EUR"'),
  remote: bb('True when the role can be done fully remotely'),
  apply_url: b('Where an applicant lands. Point this at the tenant careers page so the application is captured, not at an email address.'),
  external_id: b('The tenant-side posting id, echoed back on every application so a candidate can be attributed to the board that produced them'),
} as const;
