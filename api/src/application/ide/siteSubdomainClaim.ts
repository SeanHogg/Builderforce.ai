/**
 * Subdomain claiming for a publish — which label a publish lands on, and what a
 * lost race for it means. Split out of `publishStaticSite` so the decision is
 * one tested unit rather than branches buried in the upload pipeline.
 *
 * Two different situations, two different answers:
 *   - the label was CHOSEN (the request named it, or the project already holds
 *     it): a collision is the creator's to resolve, so it answers 409 naming the
 *     taken address;
 *   - the label was DERIVED from the project name on a first publish: nobody
 *     chose it, so a collision is suffixed past (`my-app` → `my-app-2`) instead
 *     of refusing a publish over a name the creator never typed.
 *
 * The pre-check is advisory; the global unique index `project_sites_subdomain_key`
 * is the arbiter. `claimSiteRow` handles the insert losing that race.
 */

import type { Db } from '../../infrastructure/database/connection';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { checkSubdomainAvailability } from './siteHosting';

/** The GLOBAL unique index on `project_sites.subdomain` (apps database). */
export const PROJECT_SITES_SUBDOMAIN_CONSTRAINT = 'project_sites_subdomain_key';

/** How many `-N` suffixes a derived label tries before giving up. */
const MAX_DERIVED_SUFFIX = 20;

export interface SubdomainClaimFailure {
  ok: false;
  status: 400 | 409;
  error: string;
}

export type SubdomainChoice = { ok: true; subdomain: string } | SubdomainClaimFailure;

export interface ChooseSubdomainInput {
  projectId: number;
  projectName: string;
  /** Explicit subdomain from the request, if any. */
  requestedSubdomain?: string | null;
  /** The subdomain this project's site currently holds, if it has one. */
  currentSubdomain?: string | null;
}

const takenError = (label: string): SubdomainClaimFailure => ({
  ok: false,
  status: 409,
  error: `Subdomain "${label}" is taken. Choose another address.`,
});

/**
 * Pick the label a publish will claim. Explicit or held labels must be free (or
 * already ours); a label derived from the project name is suffixed until free.
 */
export async function choosePublishSubdomain(db: Db, input: ChooseSubdomainInput): Promise<SubdomainChoice> {
  const { projectId, projectName, requestedSubdomain, currentSubdomain } = input;
  const chosen = requestedSubdomain?.trim() || currentSubdomain || null;
  const requested = chosen || projectName || `app-${projectId}`;

  // ONE uniqueness rule, shared with the availability endpoint and the
  // conversion path (`checkSubdomainAvailability`).
  const availability = await checkSubdomainAvailability(db, requested, projectId);
  if (!availability.label) {
    return {
      ok: false,
      status: 400,
      error: availability.reason === 'reserved'
        ? `"${requested}" is reserved by the platform. Choose another address.`
        : 'Invalid subdomain. Use lowercase letters, numbers and hyphens.',
    };
  }
  if (availability.available) return { ok: true, subdomain: availability.label };
  if (chosen) return takenError(availability.label);

  // Derived from the project name — nobody chose it, so suffix past the collision.
  const base = availability.label.slice(0, 63 - `-${MAX_DERIVED_SUFFIX}`.length).replace(/-+$/g, '');
  for (let n = 2; n <= MAX_DERIVED_SUFFIX; n++) {
    const candidate = await checkSubdomainAvailability(db, `${base}-${n}`, projectId);
    if (candidate.label && candidate.available) return { ok: true, subdomain: candidate.label };
  }
  return takenError(availability.label);
}

/**
 * Run the `project_sites` upsert, translating a lost race on the subdomain index.
 *
 * The upsert's conflict target is `project_id`, so a concurrent publish that
 * claimed the same label first raises the SUBDOMAIN violation instead. Re-check
 * who holds it: if it is THIS project (two publishes of one project racing), the
 * row now exists and a second upsert resolves as an update; if it is another
 * project, the address is genuinely taken and the caller answers 409.
 */
export async function claimSiteRow<T>(
  db: Db,
  subdomain: string,
  projectId: number,
  upsert: () => Promise<T>,
): Promise<{ ok: true; row: T } | SubdomainClaimFailure> {
  try {
    return { ok: true, row: await upsert() };
  } catch (error) {
    if (!isUniqueViolation(error, PROJECT_SITES_SUBDOMAIN_CONSTRAINT)) throw error;
    const recheck = await checkSubdomainAvailability(db, subdomain, projectId);
    if (!recheck.available) return takenError(subdomain);
    return { ok: true, row: await upsert() };
  }
}
