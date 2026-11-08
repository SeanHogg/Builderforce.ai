/**
 * The shared posting body every board's `create_posting` takes (`POSTING_PARAMS` in
 * `connectors/defaults/hiring/shared.ts`), filled from the record and the card.
 *
 * Split from `distributePosting.ts` (which publishes): this is a pure mapping, asserted
 * directly, and it was the part of that file that had nothing to do with calls or rows.
 */

import type { DistributionListing } from './distributePosting';
import type { DistributablePosting } from './postingDistributionSupport';

const text = (value: string | null | undefined): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
};

/**
 * The RECORD supplies what it owns: the title, the body (summary plus the acceptance
 * bar — a board listing with no requirements is an advert with no job in it), the
 * seniority, and the posting id as `external_id`, which every board echoes back on
 * the applications it delivers. The CARD supplies what the record has no column for.
 * No salary is sent: `job_postings` holds a per-unit rate band whose meaning depends
 * on the engagement shape, and a published band nobody stated is the worst thing a
 * pay-transparency jurisdiction can find on a posting.
 */
export function postingInputFor(posting: DistributablePosting, listing: DistributionListing = {}): Record<string, unknown> {
  const description = [text(posting.description), text(posting.requirements)].filter(Boolean).join('\n\n');
  const input: Record<string, unknown> = {
    title: posting.title,
    description: description || posting.title,
    external_id: posting.id,
  };
  const optional: Record<string, string | undefined> = {
    location: text(listing.location),
    employment_type: text(listing.employmentType),
    seniority: text(listing.seniority) ?? text(posting.experienceLevel),
    apply_url: text(listing.applyUrl),
  };
  for (const [key, value] of Object.entries(optional)) if (value) input[key] = value;
  if (typeof listing.remote === 'boolean') input.remote = listing.remote;
  return input;
}
